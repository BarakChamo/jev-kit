// Expense line review against a written T&E policy.
// Code: currency conversion, policy-number extraction, and all comparisons (rule 5/12).
// Jev: only the genuine semantic judgments text extraction/regex can't settle.

const CATEGORY_SYNONYMS = {
  meal: "meal", meals: "meal", food: "meal",
  hotel: "hotel", hotels: "hotel", lodging: "hotel", accommodation: "hotel",
  ground_transport: "ground_transport", taxi: "ground_transport", rideshare: "ground_transport",
  train: "ground_transport", transport: "ground_transport", transportation: "ground_transport",
  alcohol: "alcohol", entertainment: "entertainment",
};

function normalizeCategory(raw) {
  const key = String(raw || "").trim().toLowerCase().replace(/\s+/g, "_");
  return CATEGORY_SYNONYMS[key] || null;
}

function num(text, re) {
  const m = text.match(re);
  return m ? parseFloat(m[1]) : null;
}

function parsePolicy(text) {
  const meal = text.match(
    /meals?[^.]*?USD\s*([0-9]+(?:\.[0-9]+)?)[^.]*?standard[^.]*?USD\s*([0-9]+(?:\.[0-9]+)?)[^.]*?high-cost/is
  );
  const hotel = text.match(
    /hotels?[^.]*?USD\s*([0-9]+(?:\.[0-9]+)?)[^.]*?standard[^.]*?USD\s*([0-9]+(?:\.[0-9]+)?)[^.]*?high-cost/is
  );
  const groundLimit = num(text, /ground transport[^.]*?USD\s*([0-9]+(?:\.[0-9]+)?)/is);
  const receiptThreshold = num(
    text,
    /above USD\s*([0-9]+(?:\.[0-9]+)?)[^.]*?itemi[sz]ed receipt/is
  );
  const cityList = text.match(/high-cost cities\s*\(([^)]*)\)/i);
  const highCostCities = cityList
    ? cityList[1].split(",").map((c) => c.trim().toLowerCase()).filter(Boolean)
    : [];
  const forbiddenMatch = text.match(/([A-Za-z0-9,\s]+?)\s+(?:is|are)\s+never reimbursable/i);
  const forbiddenCategories = forbiddenMatch
    ? forbiddenMatch[1]
        .split(/,|\band\b/i)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  return {
    mealStandard: meal ? parseFloat(meal[1]) : null,
    mealHighCost: meal ? parseFloat(meal[2]) : null,
    hotelStandard: hotel ? parseFloat(hotel[1]) : null,
    hotelHighCost: hotel ? parseFloat(hotel[2]) : null,
    groundLimit,
    receiptThreshold,
    highCostCities,
    forbiddenCategories,
  };
}

function convertToUsd(amount, currency, fx) {
  if (typeof amount !== "number" || !isFinite(amount) || amount < 0) return null;
  const rate = fx && fx[currency];
  if (typeof rate !== "number") return null;
  return amount * rate;
}

export function buildState(input) {
  const { policy_text, fx_to_usd, expense } = input;
  const policy = parsePolicy(policy_text || "");
  const amountUsd = convertToUsd(expense.amount, expense.currency, fx_to_usd);
  const category = normalizeCategory(expense.category);
  const cityLower = String(expense.city || "").trim().toLowerCase();
  const cityListed = policy.highCostCities.includes(cityLower);

  let standardLimit = null;
  let highCostLimit = null;
  if (category === "meal") {
    standardLimit = policy.mealStandard;
    highCostLimit = policy.mealHighCost;
  } else if (category === "hotel") {
    standardLimit = policy.hotelStandard;
    highCostLimit = policy.hotelHighCost;
  } else if (category === "ground_transport") {
    standardLimit = policy.groundLimit;
    highCostLimit = policy.groundLimit;
  }

  // City classification only matters when it changes the outcome: amount falls strictly
  // between the standard and high-cost limits, city isn't in the policy's explicit list,
  // and the category actually has two tiers.
  const cityClassificationNeeded =
    !cityListed &&
    amountUsd != null &&
    standardLimit != null &&
    highCostLimit != null &&
    standardLimit !== highCostLimit &&
    amountUsd > standardLimit &&
    amountUsd <= highCostLimit;

  return {
    policy_excerpt: policy_text,
    category_raw: expense.category,
    category_normalized: category,
    city: expense.city,
    high_cost_city_examples: policy.highCostCities,
    city_explicitly_listed: cityListed,
    amount_original: expense.amount,
    currency: expense.currency,
    amount_usd: amountUsd,
    receipt_attached: !!expense.receipt_attached,
    description: expense.description,
    forbidden_categories: policy.forbiddenCategories,
    _policy: policy,
    _cityClassificationNeeded: cityClassificationNeeded,
  };
}

export function questions(input) {
  const state = buildState(input);
  const q = {};

  if (state.forbidden_categories.length > 0) {
    q.forbidden_content = {
      type: "noul",
      instructions:
        "Does the expense with category `category_raw` and description `description` include any of the items listed in `forbidden_categories`, even as part of a larger purchase (e.g. wine bought alongside a meal)?",
      criteria: {
        true: "the expense includes at least one item from `forbidden_categories`",
        false: "the expense includes none of the items in `forbidden_categories`",
      },
    };
  }

  if (!state.category_normalized) {
    q.category_choice = {
      type: "choice",
      instructions:
        "Based on `description` and `category_raw`, which expense category does this line best match?",
      criteria: {
        meal: "a meal or food purchase",
        hotel: "lodging/accommodation",
        ground_transport: "taxi, rideshare, or train for a single trip",
        alcohol_or_entertainment: "alcohol or entertainment",
        other: "none of the above",
      },
    };
  }

  if (state._cityClassificationNeeded) {
    q.high_cost_city = {
      type: "noul",
      instructions:
        "Is `city` a high-cost city for corporate travel — comparable in typical hotel and meal prices to the cities listed in `high_cost_city_examples`?",
      criteria: {
        true: "`city` is comparable in cost to `high_cost_city_examples`",
        false: "`city` is a standard-cost city",
      },
    };
  }

  q.claims_override = {
    type: "noul",
    instructions:
      "Does `description` claim or imply that this expense is pre-approved, exempt from policy, or should bypass normal review?",
    criteria: {
      true: "`description` asserts some kind of approval or policy exemption",
      false: "`description` makes no such claim",
    },
  };

  return q;
}

export function decide(answers, input) {
  const state = buildState(input);
  const policy = state._policy;

  const forbidden = answers.forbidden_content;
  if (forbidden) {
    if (forbidden.noul >= 0.85) return { decision: "reject" };
    if (forbidden.noul > 0.15) return { decision: "needs_approval" };
  }

  let category = state.category_normalized;
  if (!category) {
    const c = answers.category_choice;
    if (!c || c.probabilities[c.choice] < 0.6) return { decision: "abstain" };
    if (c.choice === "alcohol_or_entertainment") return { decision: "reject" };
    if (c.choice === "other") return { decision: "abstain" };
    category = c.choice;
  }

  if (state.amount_usd == null) return { decision: "abstain" };

  let standardLimit, highCostLimit;
  if (category === "meal") {
    standardLimit = policy.mealStandard;
    highCostLimit = policy.mealHighCost;
  } else if (category === "hotel") {
    standardLimit = policy.hotelStandard;
    highCostLimit = policy.hotelHighCost;
  } else if (category === "ground_transport") {
    standardLimit = policy.groundLimit;
    highCostLimit = policy.groundLimit;
  } else {
    return { decision: "abstain" };
  }
  if (standardLimit == null || highCostLimit == null) return { decision: "abstain" };

  let overLimit;
  if (state.amount_usd <= standardLimit) {
    overLimit = false;
  } else if (state.amount_usd > highCostLimit) {
    overLimit = true;
  } else if (state.city_explicitly_listed) {
    overLimit = false;
  } else {
    const cityAns = answers.high_cost_city;
    if (!cityAns) return { decision: "abstain" };
    if (cityAns.noul >= 0.55) overLimit = false;
    else if (cityAns.noul <= 0.45) overLimit = true;
    else return { decision: "abstain" };
  }

  if (overLimit) return { decision: "needs_approval" };

  if (answers.claims_override && answers.claims_override.noul >= 0.5) {
    return { decision: "needs_approval" };
  }

  if (
    policy.receiptThreshold != null &&
    state.amount_usd > policy.receiptThreshold &&
    !state.receipt_attached
  ) {
    return { decision: "needs_approval" };
  }

  return { decision: "approve" };
}
