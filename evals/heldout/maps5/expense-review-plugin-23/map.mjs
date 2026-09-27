// Expense-line triage against a written T&E policy, on Jev.
//
// Numbers are never compared by Jev: every USD amount stated in the policy text is
// extracted verbatim as a `choice` over the amounts that actually appear in the text,
// and all arithmetic (currency conversion, limit/threshold comparison) happens in code.

function extractAmountCandidates(policyText) {
  const re = /(?:USD|US\$|\$)\s*([\d]{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)/gi;
  const set = new Set();
  let m;
  while ((m = re.exec(policyText))) {
    const n = parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isNaN(n)) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

function amountCriteria(candidates, extraOptions) {
  const criteria = {};
  for (const n of candidates) {
    criteria[String(n)] = `the amount ${n} USD, exactly as it appears in \`policy\``;
  }
  Object.assign(criteria, extraOptions);
  return criteria;
}

export function buildState(input) {
  return {
    policy: input.policy_text,
    expense: input.expense,
    amount_candidates_usd: extractAmountCandidates(input.policy_text),
  };
}

export function questions(input) {
  const candidates = extractAmountCandidates(input.policy_text);
  const limitCriteria = amountCriteria(candidates, {
    not_stated: "`policy` states no dollar limit for this category/tier",
  });
  const highCostLimitCriteria = amountCriteria(candidates, {
    not_stated: "`policy` states no dollar limit for this category in high-cost cities",
    same_as_standard: "`policy` gives one limit for this category with no high-cost tier",
  });
  const receiptCriteria = amountCriteria(candidates, {
    not_stated: "`policy` states no itemised-receipt threshold",
  });

  return {
    city_high_cost: {
      type: "noul",
      instructions:
        "Does `policy` explicitly name the city in `expense.city` as one of its high-cost cities (the ones that get a higher meal/hotel limit)?",
      criteria: {
        true: "`policy` lists `expense.city` by name as high-cost",
        false: "`policy` does not list `expense.city` as high-cost, or names no high-cost cities at all",
      },
    },
    includes_alcohol: {
      type: "noul",
      instructions:
        "Does the purchase described in `expense.description` (category `expense.category`) include any alcohol or entertainment component, even as part of a larger purchase such as a meal?",
      criteria: {
        true: "alcohol or entertainment is part of what was purchased, even if not the whole purchase",
        false: "nothing alcohol- or entertainment-related is part of the purchase",
      },
    },
    alcohol_never_reimbursable: {
      type: "noul",
      instructions:
        "Does `policy` state that alcohol and/or entertainment expenses are never reimbursable, with no approval path?",
      criteria: {
        true: "`policy` bans reimbursement of alcohol/entertainment outright",
        false: "`policy` allows alcohol/entertainment under some condition, or says nothing about it",
      },
    },
    category_recognized: {
      type: "choice",
      instructions:
        "Which category defined in `policy` does the purchase in `expense.category` / `expense.description` belong to?",
      criteria: {
        meal: "a meal / food and drink purchase",
        hotel: "a hotel / lodging stay",
        ground_transport: "taxi, rideshare, or train travel",
        other: "none of `policy`'s defined categories clearly covers this purchase",
      },
    },
    standard_limit: {
      type: "choice",
      instructions:
        "What per-unit dollar limit does `policy` state for the category of the purchase in `expense.category` / `expense.description`, in standard-cost cities (i.e. not the high-cost tier)?",
      criteria: limitCriteria,
    },
    highcost_limit: {
      type: "choice",
      instructions:
        "What per-unit dollar limit does `policy` state for the category of the purchase in `expense.category` / `expense.description`, specifically in high-cost cities?",
      criteria: highCostLimitCriteria,
    },
    receipt_threshold: {
      type: "choice",
      instructions:
        "Above what single-expense dollar amount does `policy` require an itemised receipt (regardless of category)?",
      criteria: receiptCriteria,
    },
    over_limit_consequence: {
      type: "choice",
      instructions:
        "According to `policy`, what happens to an expense that exceeds its category's dollar limit?",
      criteria: {
        needs_approval: "`policy` says it needs manager approval, and is not rejected outright",
        rejected: "`policy` says it is rejected outright",
        not_specified: "`policy` does not say what happens",
      },
    },
    missing_receipt_consequence: {
      type: "choice",
      instructions:
        "According to `policy`, what happens when an expense is above the itemised-receipt threshold but has no itemised receipt attached?",
      criteria: {
        needs_approval: "`policy` says it needs manager approval, and is not rejected outright",
        rejected: "`policy` says it is rejected outright",
        not_specified: "`policy` does not say what happens",
      },
    },
  };
}

function classifyNoul(p, trueAt = 0.65, falseAt = 0.35) {
  if (p >= trueAt) return "true";
  if (p <= falseAt) return "false";
  return "unsure";
}

function readAmountChoice(ans, minConfidence = 0.55) {
  if (!ans || ans.confidence < minConfidence) return { ok: false };
  if (ans.choice === "not_stated" || ans.choice === "same_as_standard") {
    return { ok: true, value: null };
  }
  const value = parseFloat(ans.choice);
  return Number.isNaN(value) ? { ok: false } : { ok: true, value };
}

export function decide(answers, input) {
  const ABSTAIN = { decision: "abstain" };

  const rate = input.fx_to_usd?.[input.expense.currency];
  if (typeof rate !== "number") return ABSTAIN;
  const amountUsd = input.expense.amount * rate;

  const alcohol = classifyNoul(answers.includes_alcohol.noul);
  if (alcohol === "unsure") return ABSTAIN;

  if (alcohol === "true") {
    const banned = classifyNoul(answers.alcohol_never_reimbursable.noul, 0.6, 0.4);
    if (banned === "true") return { decision: "reject" };
  }

  if (!answers.category_recognized || answers.category_recognized.confidence < 0.55) return ABSTAIN;
  const category = answers.category_recognized.choice;
  if (!["meal", "hotel", "ground_transport"].includes(category)) return ABSTAIN;

  const cityHigh = classifyNoul(answers.city_high_cost.noul);
  if (cityHigh === "unsure") return ABSTAIN;

  const std = readAmountChoice(answers.standard_limit);
  if (!std.ok) return ABSTAIN;
  const high = readAmountChoice(answers.highcost_limit);
  if (!high.ok) return ABSTAIN;
  const limit = cityHigh === "true" && high.value !== null ? high.value : std.value;

  const receipt = readAmountChoice(answers.receipt_threshold);
  if (!receipt.ok) return ABSTAIN;

  const overLimitConsequence =
    answers.over_limit_consequence?.confidence >= 0.5 ? answers.over_limit_consequence.choice : "not_specified";
  const missingReceiptConsequence =
    answers.missing_receipt_consequence?.confidence >= 0.5
      ? answers.missing_receipt_consequence.choice
      : "not_specified";

  const overLimit = limit !== null && amountUsd > limit;
  const receiptMissing =
    receipt.value !== null && amountUsd > receipt.value && !input.expense.receipt_attached;

  let decision = "approve";

  if (overLimit) {
    decision = overLimitConsequence === "rejected" ? "reject" : "needs_approval";
  }
  if (decision !== "reject" && receiptMissing) {
    decision = missingReceiptConsequence === "rejected" ? "reject" : "needs_approval";
  }
  if (decision === "approve" && alcohol === "true") {
    // Alcohol/entertainment present but policy didn't say it's an outright ban;
    // don't let it slip through as a clean auto-approve.
    decision = "needs_approval";
  }

  return { decision };
}
