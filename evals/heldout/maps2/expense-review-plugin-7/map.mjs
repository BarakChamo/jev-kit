// Expense-line triage against a written T&E policy.
// All arithmetic (FX conversion, limit comparison) is done in code from
// numbers stated in policy_text; Jev is only asked the two judgment calls
// that require reading free text: hidden never-reimbursable spend, and
// whether the line is too ambiguous for an automated decision.

function parsePolicy(policyText) {
  const t = policyText || "";
  const meal = t.match(
    /meals?[^:]*:\s*up to usd\s*([\d.]+).*?standard cities and usd\s*([\d.]+).*?high-cost cities\s*\(([^)]*)\)/is
  );
  const hotel = t.match(
    /hotels?[^:]*:\s*up to usd\s*([\d.]+).*?standard cities and usd\s*([\d.]+).*?high-cost cities/is
  );
  const transport = t.match(/ground transport[^:]*:\s*up to usd\s*([\d.]+)/is);
  const receipt = t.match(/above usd\s*([\d.]+)[^.]*itemi[sz]ed receipt/is);

  return {
    mealStandard: meal ? Number(meal[1]) : null,
    mealHigh: meal ? Number(meal[2]) : null,
    highCostCities: meal ? meal[3].split(",").map((c) => c.trim().toLowerCase()) : [],
    hotelStandard: hotel ? Number(hotel[1]) : null,
    hotelHigh: hotel ? Number(hotel[2]) : null,
    transportLimit: transport ? Number(transport[1]) : null,
    receiptThreshold: receipt ? Number(receipt[1]) : null,
  };
}

function normalizeCategory(category) {
  const c = (category || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (["meal", "meals", "food"].includes(c)) return "meal";
  if (["hotel", "hotels", "lodging", "accommodation"].includes(c)) return "hotel";
  if (["ground_transport", "transport", "taxi", "rideshare", "train"].includes(c))
    return "ground_transport";
  if (["alcohol", "alcoholic_beverages"].includes(c)) return "alcohol";
  if (["entertainment"].includes(c)) return "entertainment";
  return c;
}

export function buildState(input) {
  const { policy_text, fx_to_usd, expense } = input;
  const policy = parsePolicy(policy_text);
  const rate = fx_to_usd?.[expense.currency];
  const amount_usd =
    typeof rate === "number" ? Math.round(expense.amount * rate * 100) / 100 : null;
  const category = normalizeCategory(expense.category);
  const isHighCostCity = policy.highCostCities.includes((expense.city || "").toLowerCase());

  return {
    policy_text,
    expense,
    derived: {
      category_normalized: category,
      amount_usd,
      high_cost_cities: policy.highCostCities,
      is_high_cost_city: isHighCostCity,
      meal_limit_usd: category === "meal" ? (isHighCostCity ? policy.mealHigh : policy.mealStandard) : null,
      hotel_limit_usd: category === "hotel" ? (isHighCostCity ? policy.hotelHigh : policy.hotelStandard) : null,
      ground_transport_limit_usd: category === "ground_transport" ? policy.transportLimit : null,
      receipt_threshold_usd: policy.receiptThreshold,
    },
    _policy: policy,
  };
}

export function questions(input) {
  const { expense } = input;
  return {
    never_reimbursable: {
      type: "noul",
      instructions: `Read \`policy_text\`. Considering \`expense.category\` ("${expense.category}") and \`expense.description\` ("${expense.description}"), is this expense a type of spending the policy says is never reimbursable (such as alcohol or entertainment), whether or not it is labeled that way?`,
      criteria: {
        true: "the policy treats this expense as never reimbursable, based on its category or what the description describes",
        false: "the policy does not treat this expense as never reimbursable",
      },
    },
    ambiguous: {
      type: "noul",
      instructions: `Looking at \`expense\` and \`policy_text\` together, is information missing, unclear, or conflicting enough that a person (not an automated check) should decide this expense line?`,
      criteria: {
        true: "a person should decide because something needed is missing, unclear, or conflicting",
        false: "the given facts are sufficient to decide against the policy",
      },
    },
  };
}

export function decide(answers, input) {
  const state = buildState(input);
  const { expense } = state;
  const category = state.derived.category_normalized;
  const policy = state._policy;

  const ambiguous = answers.ambiguous?.noul ?? 0;
  if (ambiguous >= 0.6) return { decision: "abstain" };

  if (category === "alcohol" || category === "entertainment") {
    return { decision: "reject" };
  }

  const neverReimbursable = answers.never_reimbursable?.noul ?? 0;
  if (neverReimbursable >= 0.7) return { decision: "reject" };
  if (neverReimbursable >= 0.35) return { decision: "needs_approval" };

  if (!["meal", "hotel", "ground_transport"].includes(category)) {
    return { decision: "abstain" };
  }

  const amountUsd = state.derived.amount_usd;
  if (amountUsd === null || policy.receiptThreshold === null) {
    return { decision: "abstain" };
  }

  const limit =
    category === "meal"
      ? state.derived.meal_limit_usd
      : category === "hotel"
      ? state.derived.hotel_limit_usd
      : state.derived.ground_transport_limit_usd;
  if (limit === null) return { decision: "abstain" };

  if (amountUsd > limit) return { decision: "needs_approval" };

  if (amountUsd > policy.receiptThreshold && !expense.receipt_attached) {
    return { decision: "needs_approval" };
  }

  return { decision: "approve" };
}
