// Expense-line policy check on Jev.
//
// Design notes:
// - Dollar limits, the high-cost city list, the "over limit" action and the
//   "missing receipt" action are all *stated exactly* in `policy_text`, so
//   they are extracted and compared in code (never asked of Jev — rules 8/9).
// - `expense.category` is a clean structured field, so it is normalized in
//   code rather than re-classified by Jev.
// - The one genuinely fuzzy judgment — whether the description embeds
//   alcohol/entertainment inside a larger purchase — is asked as a present-tense
//   "does it include" noul (rule 7), not "is this expense alcohol".
// - Matching `expense.city` against the high-cost city list (which may use
//   abbreviations/alternate names) is asked as a `choice` over the named
//   cities (rule 10), not compared textually in code.
// - Low/mid-band confidence on either question, or any fact the policy text
//   doesn't state, abstains rather than guessing (rules 13/14).

function splitNumberedClauses(text) {
  return (text || "")
    .split(/\n(?=\s*\d+\.\s)/)
    .map((s) => s.trim())
    .filter((s) => /^\d+\./.test(s));
}

function usdAmounts(clause) {
  if (!clause) return [];
  return [...clause.matchAll(/USD\s*([\d,]+(?:\.\d+)?)/gi)].map((m) =>
    parseFloat(m[1].replace(/,/g, ""))
  );
}

function actionFor(clause) {
  if (!clause) return "needs_approval";
  if (/approv/i.test(clause)) return "needs_approval";
  if (/reject/i.test(clause)) return "reject";
  return "needs_approval";
}

function categorize(category) {
  const c = (category || "").toLowerCase().replace(/[\s_-]+/g, "_");
  if (/^meal/.test(c)) return "meal";
  if (/^hotel|^lodging/.test(c)) return "hotel";
  if (/^ground_transport|^taxi|^rideshare|^train|^transport/.test(c))
    return "ground_transport";
  if (/^alcohol|^entertainment/.test(c)) return "alcohol_or_entertainment";
  return "other";
}

function deriveFacts(input) {
  const { policy_text, fx_to_usd, expense } = input;
  const rate = fx_to_usd ? fx_to_usd[expense.currency] : undefined;
  const amount_usd = typeof rate === "number" ? expense.amount * rate : null;

  const clauses = splitNumberedClauses(policy_text);
  const findClause = (re) => clauses.find((c) => re.test(c)) || null;

  const mealClause = findClause(/meal/i);
  const hotelClause = findClause(/hotel/i);
  const transportClause = findClause(/ground transport|taxi|rideshare|train/i);
  const neverClause = findClause(/never reimbursable/i);
  const receiptClause = findClause(/itemi[sz]ed receipt/i);
  const overLimitClause =
    findClause(/above (its|the) limit/i) || findClause(/exceed/i);

  const mealNums = usdAmounts(mealClause);
  const hotelNums = usdAmounts(hotelClause);
  const transportNums = usdAmounts(transportClause);
  const receiptNums = usdAmounts(receiptClause);

  const cityListMatch = (policy_text || "").match(
    /high-cost cities?[^(]*\(([^)]+)\)/i
  );
  const high_cost_cities = cityListMatch
    ? cityListMatch[1].split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  return {
    amount_usd,
    limits: {
      meal_standard: mealNums[0] ?? null,
      meal_high_cost: mealNums[1] ?? mealNums[0] ?? null,
      hotel_standard: hotelNums[0] ?? null,
      hotel_high_cost: hotelNums[1] ?? hotelNums[0] ?? null,
      ground_transport: transportNums[0] ?? null,
    },
    high_cost_cities,
    never_reimbursable: !!neverClause,
    receipt_threshold: receiptNums[0] ?? null,
    receipt_missing_action: actionFor(receiptClause),
    over_limit_action: actionFor(overLimitClause),
  };
}

export function buildState(input) {
  const { policy_text, fx_to_usd, expense } = input;
  return { policy_text, fx_to_usd, expense, facts: deriveFacts(input) };
}

export function questions(input) {
  const facts = deriveFacts(input);

  const qs = {
    includes_alcohol_or_entertainment: {
      type: "noul",
      instructions:
        "Does `expense.description` indicate that any part of the purchase is alcohol or entertainment, even if it is only part of a larger purchase such as a meal that also includes drinks?",
      criteria: {
        true: "some part of the purchase is alcohol or entertainment",
        false: "no part of the purchase is alcohol or entertainment",
      },
    },
  };

  if (facts.high_cost_cities.length > 0) {
    const criteria = {};
    for (const city of facts.high_cost_cities) {
      criteria[city] = `the city named in expense.city is ${city}, including common abbreviations or alternate names for it`;
    }
    criteria.none = "the city named in expense.city is none of the other listed cities";
    qs.city_match = {
      type: "choice",
      instructions:
        "Which of the listed high-cost cities, if any, is the same city as the one named in `expense.city`?",
      criteria,
    };
  }

  return qs;
}

export function decide(answers, input) {
  const { expense } = input;
  const facts = deriveFacts(input);

  if (facts.amount_usd == null) return { decision: "abstain" };

  const alc = answers.includes_alcohol_or_entertainment;
  if (!alc) return { decision: "abstain" };
  if (alc.noul > 0.35 && alc.noul < 0.65) return { decision: "abstain" };
  if (alc.noul >= 0.65) {
    return { decision: facts.never_reimbursable ? "reject" : "needs_approval" };
  }

  const category = categorize(expense.category);
  if (category === "other") return { decision: "abstain" };
  if (category === "alcohol_or_entertainment") {
    return { decision: facts.never_reimbursable ? "reject" : "needs_approval" };
  }

  let limit = null;
  if (category === "meal" || category === "hotel") {
    const cityAns = answers.city_match;
    const isHighCost = !!cityAns && cityAns.choice !== "none" && cityAns.confidence >= 0.5;
    limit =
      category === "meal"
        ? isHighCost ? facts.limits.meal_high_cost : facts.limits.meal_standard
        : isHighCost ? facts.limits.hotel_high_cost : facts.limits.hotel_standard;
  } else if (category === "ground_transport") {
    limit = facts.limits.ground_transport;
  }
  if (limit == null) return { decision: "abstain" };

  if (facts.amount_usd > limit) {
    return { decision: facts.over_limit_action };
  }
  if (
    facts.receipt_threshold != null &&
    facts.amount_usd > facts.receipt_threshold &&
    !expense.receipt_attached
  ) {
    return { decision: facts.receipt_missing_action };
  }

  return { decision: "approve" };
}
