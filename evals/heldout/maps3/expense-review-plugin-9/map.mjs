// Expense-line triage: approve / needs_approval / reject / abstain.
//
// Numeric limits and the high-cost city list are stated verbatim in
// policy_text ("USD 75", "(London, New York, ...)"), so they are extracted
// with code, not asked of Jev — this is text lookup, not a judgment call.
// Jev is used only for the two facts that need reading comprehension:
// whether the description hides alcohol/entertainment inside a larger
// purchase, and whether the description looks like a different expense
// type than the category field claims.

function extractTwoUsd(text, keyword) {
  const re = new RegExp(keyword + "[^.]*?USD\\s*([\\d,.]+)[^.]*?USD\\s*([\\d,.]+)", "i");
  const m = text.match(re);
  if (!m) return null;
  return [parseFloat(m[1].replace(/,/g, "")), parseFloat(m[2].replace(/,/g, ""))];
}

function extractOneUsd(text, keyword) {
  const re = new RegExp(keyword + "[^.]*?USD\\s*([\\d,.]+)", "i");
  const m = text.match(re);
  if (!m) return null;
  return parseFloat(m[1].replace(/,/g, ""));
}

function extractReceiptThreshold(text) {
  const m = text.match(/above\s+USD\s*([\d,.]+)[^.]*?itemi[sz]ed receipt/i);
  return m ? parseFloat(m[1].replace(/,/g, "")) : null;
}

function extractHighCostCities(text) {
  const m = text.match(/high-cost cities\s*\(([^)]+)\)/i);
  if (!m) return [];
  return m[1].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function classifyCategory(categoryRaw) {
  const c = (categoryRaw || "").trim().toLowerCase();
  if (/alcohol|entertain/.test(c)) return "alcohol_entertainment";
  if (/meal|food/.test(c)) return "meal";
  if (/hotel|lodg|accommod/.test(c)) return "hotel";
  if (/transport|taxi|rideshare|train/.test(c)) return "ground_transport";
  return "other";
}

function computeFacts(input) {
  const { policy_text = "", fx_to_usd = {}, expense = {} } = input;

  const meal = extractTwoUsd(policy_text, "Meals");
  const hotel = extractTwoUsd(policy_text, "Hotels");
  const ground = extractOneUsd(policy_text, "Ground transport");
  const receiptThreshold = extractReceiptThreshold(policy_text);
  const highCostCities = extractHighCostCities(policy_text);

  const rate = fx_to_usd[expense.currency];
  const amountUsd = typeof rate === "number" ? expense.amount * rate : NaN;

  const isHighCost = highCostCities.includes((expense.city || "").trim().toLowerCase());
  const categoryClass = classifyCategory(expense.category);

  let limit;
  if (categoryClass === "meal" && meal) limit = isHighCost ? meal[1] : meal[0];
  else if (categoryClass === "hotel" && hotel) limit = isHighCost ? hotel[1] : hotel[0];
  else if (categoryClass === "ground_transport" && ground != null) limit = ground;

  const limitParseFailed =
    (categoryClass === "meal" && !meal) ||
    (categoryClass === "hotel" && !hotel) ||
    (categoryClass === "ground_transport" && ground == null);

  return { amountUsd, isHighCost, categoryClass, limit, limitParseFailed, receiptThreshold };
}

export function buildState(input) {
  const { policy_text, expense } = input;
  const facts = computeFacts(input);
  return {
    policy_text,
    expense: {
      category: expense.category,
      city: expense.city,
      amount: expense.amount,
      currency: expense.currency,
      amount_usd: Number.isFinite(facts.amountUsd) ? facts.amountUsd : null,
      receipt_attached: expense.receipt_attached,
      description: expense.description,
    },
  };
}

export function questions(_input) {
  return {
    includes_alcohol_or_entertainment: {
      type: "noul",
      instructions:
        "Does the expense described in `expense.description` include any alcohol or entertainment, even if it is only part of a larger purchase (for example a dinner that includes wine, or a client meal that includes show tickets)?",
      criteria: {
        true: "the description includes alcohol and/or entertainment, even as just part of the purchase",
        false: "the description includes neither alcohol nor entertainment",
      },
    },
    category_mismatch: {
      type: "noul",
      instructions:
        "Does `expense.description` describe an expense of a genuinely different type than the category stated in `expense.category` (for example a hotel charge described under a `meal` category)? Answer false if the description is simply a normal example of that category.",
      criteria: {
        true: "the description describes a different expense type than the stated category",
        false: "the description is consistent with the stated category",
      },
    },
  };
}

const ALCOHOL_REJECT_THRESHOLD = 0.65;
const ALCOHOL_ESCALATE_THRESHOLD = 0.3;
const MISMATCH_ESCALATE_THRESHOLD = 0.6;

export function decide(answers, input) {
  const expense = input.expense || {};
  const facts = computeFacts(input);

  if (!Number.isFinite(facts.amountUsd)) return { decision: "abstain" };

  if (facts.categoryClass === "alcohol_entertainment") return { decision: "reject" };

  const pAlcohol = answers.includes_alcohol_or_entertainment?.noul ?? 0;
  if (pAlcohol >= ALCOHOL_REJECT_THRESHOLD) return { decision: "reject" };
  if (pAlcohol >= ALCOHOL_ESCALATE_THRESHOLD) return { decision: "needs_approval" };

  const pMismatch = answers.category_mismatch?.noul ?? 0;
  if (pMismatch >= MISMATCH_ESCALATE_THRESHOLD) return { decision: "needs_approval" };

  if (facts.categoryClass === "other") return { decision: "needs_approval" };
  if (facts.limitParseFailed) return { decision: "abstain" };

  if (facts.amountUsd > facts.limit) return { decision: "needs_approval" };

  if (
    facts.receiptThreshold != null &&
    facts.amountUsd > facts.receiptThreshold &&
    !expense.receipt_attached
  ) {
    return { decision: "needs_approval" };
  }

  return { decision: "approve" };
}
