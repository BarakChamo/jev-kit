// Expense-line policy review map for Jev.
//
// Design notes:
// - Currency conversion and every USD comparison happen in code (rule: derive what
//   code can settle completely). Jev is only asked to *read* facts from the policy
//   prose and the expense that code cannot know: which cities count as high-cost,
//   what numeric limits the policy states, whether the description hides alcohol/
//   entertainment, and whether the policy is "strict" (reject) instead of the usual
//   "needs manager approval" for over-limit/missing-receipt cases.
// - Numeric limits are read as a bucketed `choice` (rounded dollar figures) rather
//   than compared directly by Jev, per the "compare in code" rule: asking Jev to
//   itself judge "is $X within the limit" is the failure mode this avoids.
// - Category is derived from the structured `category` field in code, not asked.

const BANDS = [
  15, 20, 25, 30, 35, 40, 45, 50, 60, 65, 70, 75, 80, 90, 100, 110, 120, 125,
  135, 150, 160, 175, 200, 225, 250, 275, 300, 350, 400, 450, 500, 600, 750, 1000,
];

function bandCriteria(subject) {
  const criteria = {
    under_min: `the policy's stated ${subject} is less than USD ${BANDS[0]}`,
    over_max: `the policy's stated ${subject} is more than USD ${BANDS[BANDS.length - 1]}`,
    not_specified: `policy_text does not state a numeric ${subject} at all`,
  };
  for (const v of BANDS) {
    criteria[String(v)] = `USD ${v} is the policy's stated ${subject}, or the closest listed amount not exceeding it`;
  }
  return criteria;
}

function bandValue(answer) {
  if (!answer || answer.type !== "choice") return null;
  const c = answer.choice;
  if (c === "not_specified") return null;
  if (c === "under_min") return 0;
  if (c === "over_max") return Infinity;
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
}

function classifyCategory(rawCategory) {
  const c = String(rawCategory || "").toLowerCase();
  if (/alcohol|liquor|wine|beer|bar\b|entertainment|show|concert|club/.test(c)) return "alcohol_entertainment";
  if (/meal|food|lunch|dinner|breakfast|restaurant/.test(c)) return "meal";
  if (/hotel|lodging|accommodation/.test(c)) return "hotel";
  if (/taxi|rideshare|uber|lyft|train|transit|transport|parking/.test(c)) return "ground_transport";
  return "other";
}

export function buildState(input) {
  const { expense } = input;
  return {
    policy_text: input.policy_text,
    category: expense.category,
    city: expense.city,
    description: expense.description,
    receipt_attached: expense.receipt_attached,
    currency: expense.currency,
    original_amount: expense.amount,
  };
}

export function questions(input) {
  const category = classifyCategory(input.expense.category);
  const q = {};

  q.hidden_alcohol_or_entertainment = {
    type: "noul",
    instructions:
      "Does the text in `description` indicate the expense is, or includes, alcohol or entertainment (e.g. bar tab, wine, drinks, show/event tickets, client entertainment)?",
    criteria: {
      true: "description indicates alcohol or entertainment content",
      false: "description does not indicate alcohol or entertainment",
    },
  };

  q.strict_no_approval_path = {
    type: "noul",
    instructions:
      "Does `policy_text` state that expenses exceeding a category limit, or missing a required itemised receipt, are rejected outright rather than sent for manager approval?",
    criteria: {
      true: "policy_text says such expenses are rejected outright",
      false: "policy_text says, or does not say otherwise, that such expenses go to manager approval instead",
    },
  };

  q.receipt_threshold_band = {
    type: "choice",
    instructions:
      "In `policy_text`, above what USD amount does a single expense require an itemised receipt?",
    criteria: bandCriteria("itemised-receipt requirement threshold"),
  };

  if (category === "meal" || category === "hotel") {
    q.city_tier = {
      type: "choice",
      instructions:
        "Under the high-cost-city rules in `policy_text`, is the city named in `city` classified as a high-cost city or a standard city?",
      criteria: {
        high_cost: "`city` is one of the policy's named high-cost cities",
        standard: "`city` is not listed among the policy's high-cost cities",
      },
    };
  }

  if (category === "meal") {
    q.meal_limit_standard_band = {
      type: "choice",
      instructions: "In `policy_text`, what is the per-person, per-day meal limit for standard-cost cities?",
      criteria: bandCriteria("per-day meal limit for standard-cost cities"),
    };
    q.meal_limit_highcost_band = {
      type: "choice",
      instructions: "In `policy_text`, what is the per-person, per-day meal limit for high-cost cities?",
      criteria: bandCriteria("per-day meal limit for high-cost cities"),
    };
  } else if (category === "hotel") {
    q.hotel_limit_standard_band = {
      type: "choice",
      instructions: "In `policy_text`, what is the per-night hotel limit for standard-cost cities?",
      criteria: bandCriteria("per-night hotel limit for standard-cost cities"),
    };
    q.hotel_limit_highcost_band = {
      type: "choice",
      instructions: "In `policy_text`, what is the per-night hotel limit for high-cost cities?",
      criteria: bandCriteria("per-night hotel limit for high-cost cities"),
    };
  } else if (category === "ground_transport") {
    q.ground_transport_limit_band = {
      type: "choice",
      instructions: "In `policy_text`, what is the per-trip ground transport (taxi/rideshare/train) limit?",
      criteria: bandCriteria("per-trip ground transport limit"),
    };
  }

  return q;
}

export function decide(answers, input) {
  const { expense, fx_to_usd, policy_text } = input;
  if (!policy_text || !expense) return { decision: "abstain" };

  const rate = fx_to_usd ? fx_to_usd[expense.currency] : undefined;
  const amount = Number(expense.amount);
  if (typeof rate !== "number" || !Number.isFinite(rate) || !Number.isFinite(amount)) {
    return { decision: "abstain" };
  }
  const amountUsd = amount * rate;

  const alcoholP = answers.hidden_alcohol_or_entertainment?.noul ?? 0;
  const category = classifyCategory(expense.category);
  if (category === "alcohol_entertainment" || alcoholP >= 0.5) {
    return { decision: "reject" };
  }

  const strict = (answers.strict_no_approval_path?.noul ?? 0) >= 0.6;
  const overLimitDecision = strict ? "reject" : "needs_approval";

  const receiptThreshold = bandValue(answers.receipt_threshold_band);
  const receiptRequired = receiptThreshold !== null && amountUsd > receiptThreshold;
  if (receiptRequired && !expense.receipt_attached) {
    return { decision: overLimitDecision };
  }

  let limit = null;
  if (category === "meal" || category === "hotel") {
    const tier = answers.city_tier?.choice;
    const prefix = category === "meal" ? "meal_limit" : "hotel_limit";
    limit = bandValue(answers[tier === "high_cost" ? `${prefix}_highcost_band` : `${prefix}_standard_band`]);
  } else if (category === "ground_transport") {
    limit = bandValue(answers.ground_transport_limit_band);
  } else {
    return { decision: "needs_approval" };
  }

  if (limit === null) return { decision: "needs_approval" };
  return { decision: amountUsd <= limit ? "approve" : overLimitDecision };
}
