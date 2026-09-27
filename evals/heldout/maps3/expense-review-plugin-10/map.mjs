// Numeric grid for reading a stated USD limit exactly (never as a band, per Jev question rules):
// dense near typical per-day/per-night travel limits, coarser above $500.
function buildLimitGrid() {
  const values = [];
  for (let v = 0; v <= 200; v += 5) values.push(v);
  for (let v = 210; v <= 500; v += 10) values.push(v);
  for (let v = 525; v <= 1000; v += 25) values.push(v);
  return values;
}

function limitCriteria() {
  const criteria = {};
  for (const v of buildLimitGrid()) {
    criteria[String(v)] = `the policy states a limit of exactly USD ${v} for this line`;
  }
  criteria.greater_than_1000 = "the policy states a specific limit greater than USD 1000 for this line";
  criteria.no_limit_stated = "the policy states no explicit numeric limit that covers this line";
  return criteria;
}

function parseLimit(choice) {
  if (choice === "no_limit_stated") return null;
  if (choice === "greater_than_1000") return Infinity;
  const n = Number(choice);
  return Number.isFinite(n) ? n : null;
}

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    expense: input.expense,
  };
}

export function questions(input) {
  const { category, city } = input.expense;
  const grid = limitCriteria();
  return {
    category_limit: {
      type: "choice",
      instructions: `Read \`policy_text\`. It sets a maximum USD amount per unit (per day for meals, per night for hotels, per trip for ground transport, or whatever unit it states for other categories), and may set different amounts for standard vs. high-cost cities. Apply that rule to an expense with \`expense.category\` = "${category}" incurred in \`expense.city\` = "${city}". What is the maximum USD amount that applies to this specific category and city? If \`policy_text\` states no numeric limit covering this category, answer no_limit_stated.`,
      criteria: grid,
    },
    receipt_threshold: {
      type: "choice",
      instructions: `Read \`policy_text\`. Above what USD amount does it require a single expense to have an itemised receipt (with manager approval needed when that receipt is missing)? If \`policy_text\` states no such rule, answer no_limit_stated.`,
      criteria: grid,
    },
    never_reimbursable_item: {
      type: "noul",
      instructions: `Read \`policy_text\` for any category of expense it states is never reimbursable (for example alcohol or entertainment). Does the expense with \`expense.category\` = "${category}" and \`expense.description\` include any item from such a never-reimbursable category, even only as part of a larger purchase (for example, wine included in a meal)?`,
      criteria: {
        true: "the expense includes an item from a category the policy states is never reimbursable",
        false: "the expense includes no such item",
      },
    },
  };
}

const LIMIT_GATE = 0.6;
const ALCOHOL_REJECT = 0.8;
const ALCOHOL_CLEAR = 0.2;

export function decide(answers, input) {
  const { amount, currency, receipt_attached } = input.expense;
  const rate = input.fx_to_usd?.[currency];
  if (rate == null) return "abstain";
  const amountUsd = amount * rate;

  const alcohol = answers.never_reimbursable_item;
  if (alcohol.noul >= ALCOHOL_REJECT) return "reject";
  if (alcohol.noul > ALCOHOL_CLEAR) return "abstain";

  const limitAns = answers.category_limit;
  const limitTop = limitAns.probabilities?.[limitAns.choice] ?? limitAns.confidence;
  if (limitTop < LIMIT_GATE) return "abstain";

  let needsApproval = false;
  if (limitAns.choice === "no_limit_stated") {
    needsApproval = true;
  } else {
    const limitUsd = parseLimit(limitAns.choice);
    if (limitUsd === null) return "abstain";
    if (amountUsd > limitUsd) needsApproval = true;
  }

  const receiptAns = answers.receipt_threshold;
  const receiptTop = receiptAns.probabilities?.[receiptAns.choice] ?? receiptAns.confidence;
  if (receiptTop < LIMIT_GATE) return "abstain";
  if (receiptAns.choice !== "no_limit_stated") {
    const thresholdUsd = parseLimit(receiptAns.choice);
    if (thresholdUsd !== null && amountUsd > thresholdUsd && !receipt_attached) {
      needsApproval = true;
    }
  }

  return needsApproval ? "needs_approval" : "approve";
}
