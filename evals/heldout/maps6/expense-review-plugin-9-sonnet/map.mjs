// Expense line review under a written T&E policy.
// Numeric limits, the receipt threshold and the high-cost city list are read
// straight out of `policy_text` in code (rule 9: exact numbers, no Jev arithmetic).
// Jev is used only for the genuinely fuzzy facts: category classification,
// alcohol/entertainment detection in free text, and high-cost city matching by name.

const ALCOHOL_REJECT_P = 0.75;
const ALCOHOL_ESCALATE_P = 0.3;
const CATEGORY_MIN_P = 0.55;
const CITY_HIGH_P = 0.6;
const CITY_STANDARD_P = 0.4;

function usdAmounts(sentence) {
  if (!sentence) return [];
  return [...sentence.matchAll(/USD\s?([\d,]+(?:\.\d+)?)/gi)].map((m) =>
    parseFloat(m[1].replace(/,/g, ""))
  );
}

function parsePolicy(policyText) {
  const sentences = policyText
    .split(/\n+/)
    .flatMap((l) => l.split(/(?<=\.)\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
  const find = (re) => sentences.find((s) => re.test(s));

  const mealNums = usdAmounts(find(/meals?\b/i));
  const hotelNums = usdAmounts(find(/hotels?\b/i));
  const transportNums = usdAmounts(find(/ground transport|taxi|rideshare|train/i));
  const receiptSentence = find(/receipt/i);
  const receiptNums = usdAmounts(receiptSentence);
  const overLimitSentence = sentences.find(
    (s) => /limit/i.test(s) && /(approval|reject)/i.test(s)
  );
  const overLimitIsReject = overLimitSentence
    ? /reject/i.test(overLimitSentence) && !/not\s+(?:be\s+)?rejected/i.test(overLimitSentence)
    : false;

  const cityMatch = policyText.match(/high-cost cities[^(]*\(([^)]*)\)/i);
  const highCostCities = cityMatch ? cityMatch[1].split(",").map((c) => c.trim()) : [];

  return {
    meal_limit_standard: mealNums[0] ?? null,
    meal_limit_highcost: mealNums[1] ?? mealNums[0] ?? null,
    hotel_limit_standard: hotelNums[0] ?? null,
    hotel_limit_highcost: hotelNums[1] ?? hotelNums[0] ?? null,
    transport_limit: transportNums[0] ?? null,
    receipt_threshold_usd: receiptNums[0] ?? null,
    over_limit_needs_approval: !overLimitIsReject,
    high_cost_cities: highCostCities,
  };
}

export function buildState(input) {
  const { fx_to_usd, expense } = input;
  const rate = fx_to_usd?.[expense.currency];
  const amount_usd = typeof rate === "number" ? expense.amount * rate : null;
  return {
    expense,
    amount_usd,
    policy: parsePolicy(input.policy_text),
  };
}

export function questions(input) {
  return {
    category: {
      type: "choice",
      instructions:
        "Classify the expense described by `expense.category` and `expense.description` into the policy category it belongs to.",
      criteria: {
        meal: "food or beverage for a meal (breakfast, lunch, dinner, snacks)",
        hotel: "lodging or accommodation for an overnight stay",
        ground_transport: "taxi, rideshare, train, or other local ground transportation for a trip",
        other:
          "does not clearly belong to any of the above (e.g. airfare, supplies, software) or the category cannot be determined",
      },
    },
    includes_alcohol_or_entertainment: {
      type: "noul",
      instructions:
        "Does the expense in `expense.description` (category `expense.category`) include any alcohol or entertainment, even as part of a larger purchase such as a business meal or client event?",
      criteria: {
        true: "the description mentions or clearly implies alcohol (wine, beer, drinks, bar) or entertainment (show, game, client entertainment) as part of what was purchased",
        false: "no alcohol or entertainment is mentioned or implied",
      },
    },
    high_cost_city: {
      type: "noul",
      instructions:
        "Is the city named in `expense.city` one of the cities listed in `policy.high_cost_cities`?",
      criteria: {
        true: "`expense.city` refers to the same city as one of the entries in `policy.high_cost_cities` (allowing for abbreviations or alternate names)",
        false: "`expense.city` does not match any entry in `policy.high_cost_cities`",
      },
    },
  };
}

export function decide(answers, input) {
  const { expense, amount_usd, policy } = buildState(input);
  if (amount_usd == null) return { decision: "abstain" }; // unrecognized currency

  const alcoholP = answers.includes_alcohol_or_entertainment?.noul ?? 0;
  if (alcoholP >= ALCOHOL_REJECT_P) return { decision: "reject" };
  if (alcoholP >= ALCOHOL_ESCALATE_P) return { decision: "needs_approval" };

  const cat = answers.category;
  const topCat = cat?.choice;
  const topCatP = cat?.probabilities?.[topCat] ?? cat?.confidence ?? 0;
  if (!topCat || topCatP < CATEGORY_MIN_P || topCat === "other") {
    return { decision: "abstain" }; // uncovered by policy, or too unclear to classify
  }

  let limit;
  if (topCat === "ground_transport") {
    limit = policy.transport_limit;
  } else {
    const cityP = answers.high_cost_city?.noul ?? 0;
    if (cityP > CITY_STANDARD_P && cityP < CITY_HIGH_P) return { decision: "abstain" }; // ambiguous city
    const highCost = cityP >= CITY_HIGH_P;
    limit =
      topCat === "meal"
        ? highCost ? policy.meal_limit_highcost : policy.meal_limit_standard
        : highCost ? policy.hotel_limit_highcost : policy.hotel_limit_standard;
  }
  if (limit == null) return { decision: "abstain" }; // policy has no stated limit for this category

  if (amount_usd > limit) {
    return { decision: policy.over_limit_needs_approval ? "needs_approval" : "reject" };
  }

  const receiptRequired =
    policy.receipt_threshold_usd != null && amount_usd > policy.receipt_threshold_usd;
  if (receiptRequired && !expense.receipt_attached) {
    return { decision: "needs_approval" };
  }

  return { decision: "approve" };
}
