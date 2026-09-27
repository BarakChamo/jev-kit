// Expense-line policy review map for Jev (TypeSafe System One).
//
// Design notes:
// - Currency conversion and all numeric comparisons happen in code (exact
//   arithmetic), never as a Jev question — Jev is asked only to read prose
//   facts (which cities count as high-cost, what limits/thresholds the
//   policy states, whether the category is alcohol/entertainment).
// - Policy dollar limits are read as a bucketed `choice` (a lookup, not a
//   comparison) so Jev never has to compare two numbers itself.
// - "Exceeds its limit" and "missing receipt" always resolve to
//   needs_approval, never reject, per the policy's own escalation rule.
// - Only alcohol/entertainment (confirmed against the policy text) can
//   reject; anything ambiguous falls back to needs_approval, never approve.

const LIMIT_BUCKETS = [
  20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 100,
  110, 120, 125, 135, 150, 160, 175, 200, 225, 250, 275, 300,
  350, 400, 450, 500, 600, 700, 750, 800, 900, 1000, 1200, 1500, 2000,
];

function limitCriteria(subject) {
  const criteria = { none_stated: `the policy does not state ${subject}` };
  for (const n of LIMIT_BUCKETS) {
    criteria[String(n)] = `the policy states USD ${n} as ${subject}`;
  }
  return criteria;
}

function parseLimitChoice(answer) {
  if (!answer || answer.choice === "none_stated") return null;
  const n = Number(answer.choice);
  return Number.isFinite(n) ? n : null;
}

function normalizeCategory(rawCategory) {
  const c = String(rawCategory || "").toLowerCase().trim();
  if (["meal", "meals", "food", "dining"].includes(c)) return "meal";
  if (["hotel", "hotels", "lodging", "accommodation"].includes(c)) return "hotel";
  if (["ground_transport", "transport", "transportation", "taxi", "rideshare", "train"].includes(c)) return "transport";
  if (["alcohol", "entertainment"].includes(c)) return "forbidden";
  return "other";
}

export function buildState(input) {
  const { policy_text, expense, fx_to_usd } = input;
  const rate = fx_to_usd ? fx_to_usd[expense?.currency] : undefined;
  const amount_usd =
    typeof expense?.amount === "number" && Number.isFinite(rate)
      ? Math.round(expense.amount * rate * 100) / 100
      : null;
  return { policy_text, expense, amount_usd };
}

export function questions(input) {
  const expense = input.expense || {};
  const category = normalizeCategory(expense.category);

  const q = {
    is_alcohol_or_entertainment: {
      type: "noul",
      instructions:
        "Based on `expense.category` and `expense.description`, is this expense for alcohol or entertainment (e.g. bar tabs, drinks, shows, sporting or social events) rather than an ordinary meal, hotel stay or ground transport trip?",
      criteria: {
        true: "the expense is alcohol and/or entertainment spending",
        false: "the expense is not alcohol or entertainment spending",
      },
    },
    policy_forbids_alcohol_entertainment: {
      type: "noul",
      instructions:
        "Does `policy_text` state that alcohol and/or entertainment expenses are never reimbursable, regardless of amount?",
      criteria: {
        true: "`policy_text` states alcohol and/or entertainment are never reimbursable",
        false: "`policy_text` does not state that",
      },
    },
    receipt_threshold: {
      type: "choice",
      instructions:
        "What USD amount does `policy_text` state as the threshold above which a single expense requires an itemised receipt?",
      criteria: limitCriteria("the itemised-receipt threshold for a single expense"),
    },
  };

  if (category === "meal" || category === "hotel") {
    const label = category === "meal" ? "meals" : "hotels";
    const per = category === "meal" ? "day" : "night";

    if (expense.city) {
      q.city_tier = {
        type: "choice",
        instructions:
          "Is `expense.city` one of the high-cost cities that `policy_text` explicitly names (accept close name variants, e.g. 'NYC' for 'New York', 'SF' for 'San Francisco'), or a standard city?",
        criteria: {
          standard: "`expense.city` is not one of the policy's named high-cost cities",
          high_cost: "`expense.city` is one of the policy's named high-cost cities",
        },
      };
    }

    q[`${category}_limit_standard`] = {
      type: "choice",
      instructions: `What per-${per} USD limit does \`policy_text\` state for ${label} in standard-cost cities?`,
      criteria: limitCriteria(`the per-${per} ${label} limit for standard-cost cities`),
    };
    q[`${category}_limit_high_cost`] = {
      type: "choice",
      instructions: `What per-${per} USD limit does \`policy_text\` state for ${label} in high-cost cities?`,
      criteria: limitCriteria(`the per-${per} ${label} limit for high-cost cities`),
    };
  } else if (category === "transport") {
    q.transport_limit = {
      type: "choice",
      instructions:
        "What USD limit per trip does `policy_text` state for ground transport (taxi, rideshare, train)?",
      criteria: limitCriteria("the per-trip ground transport limit"),
    };
  }

  return q;
}

export function decide(answers, input) {
  const expense = input.expense || {};
  const fx_to_usd = input.fx_to_usd || {};
  const rate = fx_to_usd[expense.currency];
  const amount = expense.amount;

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || !Number.isFinite(rate)) {
    return { decision: "abstain" };
  }
  const amount_usd = Math.round(amount * rate * 100) / 100;
  const category = normalizeCategory(expense.category);

  const isAlcoholP = category === "forbidden" ? 1 : answers.is_alcohol_or_entertainment?.noul ?? 0;
  const forbidsP = answers.policy_forbids_alcohol_entertainment?.noul ?? 0;
  const pForbidden = isAlcoholP * forbidsP;

  if (pForbidden >= 0.55) {
    return { decision: "reject" };
  }
  if (pForbidden >= 0.25) {
    return { decision: "needs_approval" };
  }

  if (category === "other") {
    // Policy has no stated numeric rule for this category: let a manager decide.
    return { decision: "needs_approval" };
  }

  let limit;
  if (category === "transport") {
    limit = parseLimitChoice(answers.transport_limit);
  } else {
    const tierAnswer = answers.city_tier;
    let tier = "standard";
    if (tierAnswer) {
      const probs = tierAnswer.probabilities || {};
      const pHigh = probs.high_cost ?? (tierAnswer.choice === "high_cost" ? tierAnswer.confidence : 0);
      tier = pHigh >= 0.6 ? "high_cost" : "standard";
    }
    const limitStandard = parseLimitChoice(answers[`${category}_limit_standard`]);
    const limitHighCost = parseLimitChoice(answers[`${category}_limit_high_cost`]);
    limit = tier === "high_cost" ? limitHighCost ?? limitStandard : limitStandard ?? limitHighCost;
  }

  if (limit == null) {
    // Couldn't establish the applicable limit from the policy text: escalate.
    return { decision: "needs_approval" };
  }
  if (amount_usd > limit) {
    return { decision: "needs_approval" };
  }

  const receiptThreshold = parseLimitChoice(answers.receipt_threshold);
  if (receiptThreshold != null && amount_usd > receiptThreshold && !expense.receipt_attached) {
    return { decision: "needs_approval" };
  }

  return { decision: "approve" };
}
