// Expense-line triage for Jev (TypeSafe System One).
//
// Numeric limits, currency conversion, and the "above limit -> needs_approval,
// never reject" rule are all read exactly from `policy_text` and compared in
// code (rules 5/6/12: comparisons and arithmetic are code's job, not Jev's).
// Jev is used only for the two judgments that need to read free text: whether
// the expense includes a never-reimbursable item, and whether it claims prior
// approval (a manipulation the description could assert on its own).

function parsePolicy(text) {
  const meal = text.match(
    /meals?[^.]*?up to usd\s*([\d,.]+)\s*per person per day in standard cities and usd\s*([\d,.]+)\s*in high-cost cities/i
  );
  const hotel = text.match(
    /hotels?[^.]*?up to usd\s*([\d,.]+)\s*per night in standard cities and usd\s*([\d,.]+)\s*in high-cost cities/i
  );
  const ground = text.match(
    /(?:ground transport|taxi|rideshare|train)[^.]*?up to usd\s*([\d,.]+)\s*per trip/i
  );
  const cityList = text.match(/high-cost cities[^(]*\(([^)]+)\)/i);
  const receipt = text.match(/above usd\s*([\d,.]+)\s*needs an? itemi[sz]ed receipt/i);
  const never = text.match(/([a-z][a-z\s,]*?)\s+(?:is|are)\s+never reimbursable/i);

  return {
    mealStandard: meal ? parseFloat(meal[1]) : null,
    mealHighCost: meal ? parseFloat(meal[2]) : null,
    hotelStandard: hotel ? parseFloat(hotel[1]) : null,
    hotelHighCost: hotel ? parseFloat(hotel[2]) : null,
    groundLimit: ground ? parseFloat(ground[1]) : null,
    highCostCities: cityList
      ? cityList[1].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
      : [],
    receiptThreshold: receipt ? parseFloat(receipt[1]) : null,
    neverReimbursable: never
      ? never[1].split(/,| and /i).map((s) => s.trim().toLowerCase()).filter(Boolean)
      : [],
  };
}

function isHighCostCity(policy, city) {
  if (!city) return false;
  const c = city.trim().toLowerCase();
  return policy.highCostCities.some((hc) => hc === c || c.includes(hc) || hc.includes(c));
}

export function buildState(input) {
  const policy = parsePolicy(input.policy_text || "");
  const rate = input.fx_to_usd?.[input.expense.currency];
  const amountUsd = typeof rate === "number" ? Math.round(input.expense.amount * rate * 100) / 100 : null;

  return {
    expense: input.expense,
    amount_usd: amountUsd,
    policy_summary: {
      meal_limit_standard_usd: policy.mealStandard,
      meal_limit_highcost_usd: policy.mealHighCost,
      hotel_limit_standard_usd: policy.hotelStandard,
      hotel_limit_highcost_usd: policy.hotelHighCost,
      ground_transport_limit_usd: policy.groundLimit,
      high_cost_cities: policy.highCostCities,
      itemized_receipt_threshold_usd: policy.receiptThreshold,
      never_reimbursable_items: policy.neverReimbursable,
    },
  };
}

export function questions(input) {
  const policy = parsePolicy(input.policy_text || "");
  const qs = {
    category_class: {
      type: "choice",
      instructions:
        "Classify the expense named in `expense.category` and `expense.description` into the travel-expense category it best matches.",
      criteria: {
        meal: "A meal or food/beverage expense for the traveler or a client (breakfast, lunch, dinner, team meal).",
        hotel: "A hotel or lodging expense (room night, accommodation).",
        ground_transport: "Local ground transport for a single trip, such as taxi, rideshare, or train.",
        other: "Does not clearly match meal, hotel, or ground transport.",
      },
    },
    claims_preapproved: {
      type: "noul",
      instructions:
        "Does `expense.description` claim or assert that this expense has already been approved, is pre-authorized, or is exempt from the standard policy limits?",
      criteria: {
        true: "The description makes such a claim.",
        false: "The description makes no such claim.",
      },
    },
  };

  if (policy.neverReimbursable.length > 0) {
    qs.excluded_item = {
      type: "noul",
      instructions:
        "Does `expense.description` or `expense.category` include any of the items listed in `policy_summary.never_reimbursable_items`, even as part of a larger purchase (for example, a meal that includes alcohol)?",
      criteria: {
        true: "The expense includes, in whole or in part, an item from `policy_summary.never_reimbursable_items`.",
        false: "The expense does not include any such item.",
      },
    };
  }

  return qs;
}

export function decide(answers, input) {
  const policy = parsePolicy(input.policy_text || "");
  const rate = input.fx_to_usd?.[input.expense.currency];
  if (typeof rate !== "number") return { decision: "abstain" };
  const amountUsd = input.expense.amount * rate;

  const hasExclusionRule = policy.neverReimbursable.length > 0;
  if (hasExclusionRule) {
    const excludedP = answers.excluded_item?.noul;
    if (typeof excludedP !== "number") return { decision: "abstain" };
    if (excludedP >= 0.7) return { decision: "reject" };
    if (excludedP > 0.3) return { decision: "needs_approval" };
  }

  const catAnswer = answers.category_class;
  if (!catAnswer) return { decision: "abstain" };
  const category = catAnswer.choice;
  const catP = catAnswer.probabilities?.[category] ?? catAnswer.confidence ?? 0;
  if (catP < 0.6) return { decision: "abstain" };

  let limit = null;
  if (category === "meal" && policy.mealStandard != null) {
    limit = isHighCostCity(policy, input.expense.city) ? policy.mealHighCost : policy.mealStandard;
  } else if (category === "hotel" && policy.hotelStandard != null) {
    limit = isHighCostCity(policy, input.expense.city) ? policy.hotelHighCost : policy.hotelStandard;
  } else if (category === "ground_transport" && policy.groundLimit != null) {
    limit = policy.groundLimit;
  }
  if (limit == null) return { decision: "abstain" };

  const needsReceipt =
    policy.receiptThreshold != null &&
    amountUsd > policy.receiptThreshold &&
    !input.expense.receipt_attached;
  const overLimit = amountUsd > limit + 1e-6;
  const claimsPreapprovedP = answers.claims_preapproved?.noul ?? 0;

  if (needsReceipt || overLimit || claimsPreapprovedP >= 0.5) {
    return { decision: "needs_approval" };
  }
  return { decision: "approve" };
}
