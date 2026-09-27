// Expense-line triage on Jev: approve / needs_approval / reject / abstain.

function clauseContaining(lines, re) {
  return lines.find((l) => re.test(l)) || "";
}

function extractAmounts(text) {
  const out = [];
  const re = /USD\s*([\d,]+(?:\.\d+)?)/gi;
  let m;
  while ((m = re.exec(text))) out.push(parseFloat(m[1].replace(/,/g, "")));
  return out;
}

function parseTierLimits(clause) {
  const nums = extractAmounts(clause);
  if (nums.length === 0) return { standard: null, high: null };
  if (nums.length === 1) return { standard: nums[0], high: nums[0] };
  return { standard: nums[0], high: nums[1] };
}

// "none" = policy doesn't address this at all; "unknown" = it does, but the
// stated consequence isn't recognized (check manager-approval before the
// generic reject match, since a clause can contain the word "rejected"
// inside a phrase like "it is not rejected").
function clauseConsequence(clause) {
  if (!clause) return "none";
  if (/never reimbursable|not reimbursable|no reimbursement/i.test(clause)) return "reject";
  if (/manager approval/i.test(clause)) return "needs_approval";
  if (/reject/i.test(clause)) return "reject";
  return "unknown";
}

function parsePolicy(policyText) {
  const lines = String(policyText || "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const mealClause = clauseContaining(lines, /\bmeals?\b/i);
  const hotelClause = clauseContaining(lines, /\bhotels?\b/i);
  const groundClause = clauseContaining(lines, /ground transport|taxi|rideshare/i);
  const receiptClause = clauseContaining(lines, /itemi[sz]ed receipt/i);
  const overLimitClause = clauseContaining(lines, /above its limit|over its limit|exceeds its limit/i);
  const alcoholClause = clauseContaining(lines, /alcohol/i);

  const meal = parseTierLimits(mealClause);
  const hotel = parseTierLimits(hotelClause);
  const groundAmounts = extractAmounts(groundClause);
  const receiptAmounts = extractAmounts(receiptClause);

  return {
    mealStandard: meal.standard,
    mealHigh: meal.high,
    hotelStandard: hotel.standard,
    hotelHigh: hotel.high,
    groundTransportLimit: groundAmounts[0] ?? null,
    receiptThreshold: receiptAmounts[0] ?? null,
    receiptConsequence: clauseConsequence(receiptClause),
    overLimitConsequence: clauseConsequence(overLimitClause),
    alcoholConsequence: clauseConsequence(alcoholClause),
  };
}

export function buildState(input) {
  const { policy_text, fx_to_usd, expense } = input;
  return {
    policy_text,
    fx_to_usd,
    expense_category: expense.category,
    expense_description: expense.description,
    expense_city: expense.city,
    expense_amount: expense.amount,
    expense_currency: expense.currency,
    expense_receipt_attached: expense.receipt_attached,
  };
}

export function questions(_input) {
  return {
    category: {
      type: "choice",
      instructions:
        "Which of the travel-expense categories described in `policy_text` does the expense line named by `expense_category` and `expense_description` belong to? Choose `other` if it does not clearly belong to a category the policy gives its own numeric limit for.",
      criteria: {
        meal: "meals, food, dining, snacks, coffee, or room service",
        hotel: "hotel, lodging, or accommodation stays",
        ground_transport: "taxi, rideshare, train, bus, or other short ground transport between locations",
        other: "anything else, e.g. airfare, conference fees, office supplies, or a category with no stated numeric limit",
      },
    },
    high_cost_city: {
      type: "noul",
      instructions:
        "Per the list of high-cost cities stated in `policy_text`, does the city named in `expense_city` refer to one of those high-cost cities (allow for common alternate names, abbreviations, or metro-area references)?",
      criteria: {
        true: "expense_city names or clearly refers to one of the high-cost cities listed in policy_text",
        false: "expense_city is not one of the listed high-cost cities",
      },
    },
    includes_alcohol_or_entertainment: {
      type: "noul",
      instructions:
        "Does the expense described in `expense_description` (category: `expense_category`) include any alcohol or entertainment, even as only part of a larger purchase, such as a meal that includes wine or beer, or a ticket to a show or event?",
      criteria: {
        true: "expense_description includes alcohol and/or entertainment as any part of the purchase",
        false: "expense_description includes no alcohol and no entertainment",
      },
    },
    unit_count: {
      type: "choice",
      instructions:
        "For the expense in `expense_description`, how many people (if it's a meal), nights (if it's a hotel stay), or trips (if it's ground transport) does the single stated amount cover? Read only what is stated or clearly implied.",
      criteria: {
        one: "covers exactly one person, night, or trip",
        two: "covers exactly two",
        three: "covers exactly three",
        four: "covers exactly four",
        five_or_more: "covers five or more",
        not_stated: "the count is not stated or implied anywhere in expense_description",
      },
    },
  };
}

const UNIT_COUNT = { one: 1, two: 2, three: 3, four: 4, five_or_more: 5, not_stated: 1 };

export function decide(answers, input) {
  const { fx_to_usd, expense } = input;
  const policy = parsePolicy(input.policy_text);

  if (policy.receiptThreshold == null) return { decision: "abstain" };

  const rate = fx_to_usd?.[expense.currency];
  if (rate == null) return { decision: "abstain" };
  const usdAmount = expense.amount * rate;

  const categoryAns = answers.category;
  if (!categoryAns || categoryAns.confidence < 0.55) return { decision: "abstain" };
  const category = categoryAns.choice;

  // Alcohol/entertainment: an explicit policy exclusion overrides everything else.
  if (policy.alcoholConsequence !== "none") {
    const p = answers.includes_alcohol_or_entertainment?.noul ?? 0;
    if (p >= 0.7) {
      if (policy.alcoholConsequence === "unknown") return { decision: "abstain" };
      return { decision: policy.alcoholConsequence };
    }
    if (p > 0.3) return { decision: "needs_approval" }; // doubt on an excluded category: escalate, never approve
  }

  const highCost = (answers.high_cost_city?.noul ?? 0) >= 0.5;
  const units = UNIT_COUNT[answers.unit_count?.choice] ?? 1;

  let categoryLimit = null;
  if (category === "meal") categoryLimit = highCost ? policy.mealHigh : policy.mealStandard;
  else if (category === "hotel") categoryLimit = highCost ? policy.hotelHigh : policy.hotelStandard;
  else if (category === "ground_transport") categoryLimit = policy.groundTransportLimit;

  if (["meal", "hotel", "ground_transport"].includes(category) && categoryLimit == null) {
    return { decision: "abstain" };
  }

  const overLimit = categoryLimit != null && usdAmount / units > categoryLimit;
  if (overLimit) {
    if (policy.overLimitConsequence === "reject" || policy.overLimitConsequence === "needs_approval") {
      return { decision: policy.overLimitConsequence };
    }
    return { decision: "abstain" };
  }

  const receiptMissing = usdAmount > policy.receiptThreshold && !expense.receipt_attached;
  if (receiptMissing) {
    if (policy.receiptConsequence === "reject" || policy.receiptConsequence === "needs_approval") {
      return { decision: policy.receiptConsequence };
    }
    return { decision: "abstain" };
  }

  return { decision: "approve" };
}
