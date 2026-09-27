// Expense-line triage against a written T&E policy.
// approve | needs_approval | reject | abstain

const CONF_HIGH = 0.75; // noul probability treated as a confident "true"
const CONF_LOW = 0.25; // noul probability treated as a confident "false"
const CONF_CHOICE = 0.6; // top choice probability treated as reliable
const EPS = 0.005; // USD slack against float/rounding noise at the boundary

function extractAmounts(policyText) {
  const found = new Set();
  const re = /(?:USD|US\$|\$)\s*([0-9][0-9,]*(?:\.[0-9]+)?)/gi;
  let m;
  while ((m = re.exec(policyText || "")) !== null) {
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n)) found.add(n);
  }
  return [...found].sort((a, b) => a - b);
}

function amountUsd(input) {
  const { amount, currency } = input.expense || {};
  const rate = input.fx_to_usd ? input.fx_to_usd[currency] : undefined;
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  if (typeof rate !== "number" || !Number.isFinite(rate)) return null;
  return amount * rate;
}

function limitChoiceOptions(amounts) {
  const criteria = {
    no_limit_stated: "the policy text does not state a specific USD figure that applies here",
  };
  for (const n of amounts) {
    criteria[String(n)] = `the policy text states USD ${n} as a relevant limit or threshold`;
  }
  return criteria;
}

export function buildState(input) {
  const { policy_text, expense } = input;
  return {
    policy_text,
    category: expense.category,
    city: expense.city,
    description: expense.description,
    amount_original: expense.amount,
    currency: expense.currency,
    amount_usd: amountUsd(input),
    receipt_attached: !!expense.receipt_attached,
  };
}

export function questions(input) {
  const amounts = extractAmounts(input.policy_text);
  const limitCriteria = limitChoiceOptions(amounts);
  const category = input.expense.category;
  const city = input.expense.city;

  return {
    high_cost_city: {
      type: "noul",
      instructions: `Does policy_text list the city named in "city" (${city}) as one of the cities that get a higher per-diem/hotel limit ("high-cost" city)?`,
      criteria: {
        true: `${city} is explicitly named among the higher-limit cities in policy_text`,
        false: `${city} is not named among the higher-limit cities, or policy_text names no such city list`,
      },
    },
    category_never_reimbursable: {
      type: "noul",
      instructions: `Does policy_text say that the expense category named in "category" (${category}), or the activity described in "description", belongs to a kind of expense that is never reimbursable regardless of amount (for example alcohol or entertainment)?`,
      criteria: {
        true: "policy_text names this kind of expense as never reimbursable",
        false: "policy_text does not name this kind of expense as never reimbursable",
      },
    },
    category_has_stated_limit: {
      type: "noul",
      instructions: `Does policy_text state a specific USD limit that applies to an expense in the category named in "category" (${category})?`,
      criteria: {
        true: "policy_text gives a specific USD limit for this category",
        false: "policy_text gives no specific USD limit for this category",
      },
    },
    limit_standard_city: {
      type: "choice",
      instructions: `What USD amount does policy_text state as the limit for an expense in the category named in "category" (${category}) when the city is NOT one of the higher-limit ("high-cost") cities?`,
      criteria: limitCriteria,
    },
    limit_high_cost_city: {
      type: "choice",
      instructions: `What USD amount does policy_text state as the limit for an expense in the category named in "category" (${category}) when the city IS one of the higher-limit ("high-cost") cities? If policy_text states only one limit regardless of city, choose that same amount here too.`,
      criteria: limitCriteria,
    },
    receipt_threshold: {
      type: "choice",
      instructions: `What USD amount does policy_text state as the threshold above which a single expense requires an itemised receipt?`,
      criteria: limitCriteria,
    },
    over_limit_is_approval_not_reject: {
      type: "noul",
      instructions: `Does policy_text say that an expense exceeding its applicable limit is sent for manager approval rather than being rejected outright?`,
      criteria: {
        true: "policy_text routes over-limit expenses to manager approval",
        false: "policy_text does not say over-limit expenses go to manager approval (e.g. it says reject, or says nothing)",
      },
    },
    missing_receipt_is_approval: {
      type: "noul",
      instructions: `Does policy_text say that a single expense above the itemised-receipt threshold, lacking that receipt, is sent for manager approval?`,
      criteria: {
        true: "policy_text routes such expenses to manager approval",
        false: "policy_text does not say this, or says something else (e.g. reject)",
      },
    },
  };
}

function noulTrue(a) {
  return a && typeof a.noul === "number" && a.noul >= CONF_HIGH;
}
function noulFalse(a) {
  return a && typeof a.noul === "number" && a.noul <= CONF_LOW;
}

function readChoiceAmount(a) {
  if (!a || a.type !== "choice") return { ok: false };
  const top = a.probabilities ? a.probabilities[a.choice] : undefined;
  if (typeof top !== "number" || top < CONF_CHOICE) return { ok: false };
  if (a.choice === "no_limit_stated") return { ok: true, value: null };
  const n = Number(a.choice);
  if (!Number.isFinite(n)) return { ok: false };
  return { ok: true, value: n };
}

export function decide(answers, input) {
  const usd = amountUsd(input);
  if (usd === null) return { decision: "abstain" };
  if (!input.policy_text || !input.expense) return { decision: "abstain" };

  const {
    high_cost_city,
    category_never_reimbursable,
    category_has_stated_limit,
    limit_standard_city,
    limit_high_cost_city,
    receipt_threshold,
    over_limit_is_approval_not_reject,
    missing_receipt_is_approval,
  } = answers || {};

  if (
    !high_cost_city ||
    !category_never_reimbursable ||
    !category_has_stated_limit ||
    !limit_standard_city ||
    !limit_high_cost_city ||
    !receipt_threshold ||
    !over_limit_is_approval_not_reject ||
    !missing_receipt_is_approval
  ) {
    return { decision: "abstain" };
  }

  if (noulTrue(category_never_reimbursable)) return { decision: "reject" };

  const receiptAttached = !!input.expense.receipt_attached;
  const receiptThresholdRead = readChoiceAmount(receipt_threshold);
  if (receiptThresholdRead.ok) {
    if (receiptThresholdRead.value !== null) {
      const receiptRequired = usd > receiptThresholdRead.value + EPS;
      if (receiptRequired && !receiptAttached) {
        if (noulTrue(missing_receipt_is_approval)) return { decision: "needs_approval" };
        if (noulFalse(missing_receipt_is_approval)) return { decision: "reject" };
        return { decision: "needs_approval" };
      }
    }
    // value === null: policy confidently states no such receipt rule; nothing to enforce.
  } else if (!receiptAttached) {
    // Can't read the receipt threshold confidently, so its requirement is unresolved.
    return { decision: "needs_approval" };
  }

  if (noulFalse(category_has_stated_limit)) {
    // No numeric limit governs this category; can't auto-clear it.
    return { decision: "needs_approval" };
  }

  let cityIsHighCost;
  if (noulTrue(high_cost_city)) cityIsHighCost = true;
  else if (noulFalse(high_cost_city)) cityIsHighCost = false;
  else return { decision: "needs_approval" };

  const limitRead = readChoiceAmount(cityIsHighCost ? limit_high_cost_city : limit_standard_city);
  if (!limitRead.ok || limitRead.value === null) {
    return { decision: "needs_approval" };
  }

  const exceedsLimit = usd > limitRead.value + EPS;
  if (exceedsLimit) {
    if (noulTrue(over_limit_is_approval_not_reject)) return { decision: "needs_approval" };
    if (noulFalse(over_limit_is_approval_not_reject)) return { decision: "reject" };
    return { decision: "needs_approval" };
  }

  return { decision: "approve" };
}
