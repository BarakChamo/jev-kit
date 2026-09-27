// Expense-line policy triage on Jev.
// Arithmetic, currency conversion and reading literal dollar figures out of
// policy_text are done in code (rule 9); Jev only judges facts that need
// language understanding (rule 5/6/7).

function extractUsdNumbers(text) {
  const nums = [];
  const re = /USD\s?([\d][\d,]*(?:\.\d+)?)/gi;
  let m;
  while ((m = re.exec(text))) nums.push(parseFloat(m[1].replace(/,/g, "")));
  return nums;
}

function splitClauses(text) {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=\.)\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseLimits(policyText) {
  const limits = {};
  for (const c of splitClauses(policyText)) {
    const nums = extractUsdNumbers(c);
    if (nums.length === 0) continue;
    if (/\bmeals?\b/i.test(c)) {
      limits.meal = nums.length >= 2 ? { standard: nums[0], highCost: nums[1] } : { flat: nums[0] };
    } else if (/\bhotels?\b/i.test(c)) {
      limits.hotel = nums.length >= 2 ? { standard: nums[0], highCost: nums[1] } : { flat: nums[0] };
    } else if (/\b(ground transport|taxi|rideshare|train)\b/i.test(c)) {
      limits.ground_transport = { flat: nums[0] };
    }
  }
  return limits;
}

function parseReceiptThreshold(policyText) {
  for (const c of splitClauses(policyText)) {
    if (/itemi[sz]ed receipt/i.test(c)) {
      const nums = extractUsdNumbers(c);
      if (nums.length) return nums[0];
    }
  }
  return null;
}

function parseHighCostCities(policyText) {
  for (const c of splitClauses(policyText)) {
    if (/high-cost cit/i.test(c)) {
      const m = c.match(/\(([^)]+)\)/);
      if (m) return m[1].split(",").map((s) => s.trim());
    }
  }
  return [];
}

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    expense: input.expense,
  };
}

export function questions(input) {
  const { expense } = input;
  return {
    alcohol_entertainment: {
      type: "noul",
      instructions: `Does the expense in \`expense\` (category "${expense.category}", description "${expense.description}") include any alcohol or entertainment, even as part of a larger purchase?`,
      criteria: {
        true: "the expense includes alcohol and/or entertainment, wholly or as part of a larger purchase",
        false: "the expense includes no alcohol or entertainment",
      },
    },
    category_bucket: {
      type: "choice",
      instructions: `Which policy expense category does the expense in \`expense\` (category "${expense.category}", description "${expense.description}") belong to?`,
      criteria: {
        meal: "a meal or food/drink expense (excluding alcohol)",
        hotel: "a hotel or lodging expense",
        ground_transport: "taxi, rideshare, or train travel",
        other: "none of the above, e.g. airfare, supplies, or anything else not covered by those three",
      },
    },
    high_cost_city: {
      type: "noul",
      instructions: `Is the city "${expense.city}" named in \`expense.city\` one of the high-cost cities listed in \`policy_text\` (allowing for common name variants or abbreviations of the same city)?`,
      criteria: {
        true: "the city is one of the high-cost cities named in the policy",
        false: "the city is not one of the high-cost cities named in the policy",
      },
    },
  };
}

export function decide(answers, input) {
  const { policy_text, fx_to_usd, expense } = input;

  const rate = fx_to_usd?.[expense.currency];
  if (rate == null) return { decision: "abstain" };
  const amountUsd = expense.amount * rate;

  const alcohol = answers.alcohol_entertainment?.noul ?? 0;
  if (alcohol >= 0.65) return { decision: "reject" };
  if (alcohol > 0.35) return { decision: "abstain" };

  const receiptThreshold = parseReceiptThreshold(policy_text);
  const missingReceipt =
    receiptThreshold != null && amountUsd > receiptThreshold && !expense.receipt_attached;
  if (missingReceipt) return { decision: "needs_approval" };

  const bucketAns = answers.category_bucket;
  const bucket = bucketAns?.choice;
  const bucketProb = bucketAns?.probabilities?.[bucket] ?? bucketAns?.confidence ?? 0;
  if (!bucket || bucket === "other" || bucketProb < 0.6) return { decision: "abstain" };

  const limits = parseLimits(policy_text)[bucket];
  if (!limits) return { decision: "abstain" };

  let overLimit;
  if (limits.flat != null) {
    overLimit = amountUsd > limits.flat;
  } else {
    const lo = Math.min(limits.standard, limits.highCost);
    const hi = Math.max(limits.standard, limits.highCost);
    if (amountUsd <= lo) {
      overLimit = false;
    } else if (amountUsd > hi) {
      overLimit = true;
    } else {
      const cities = parseHighCostCities(policy_text);
      const exactMatch = cities.some((c) => c.toLowerCase() === expense.city.toLowerCase());
      let isHighCost;
      if (exactMatch) {
        isHighCost = true;
      } else {
        const hc = answers.high_cost_city?.noul ?? 0;
        if (hc >= 0.65) isHighCost = true;
        else if (hc <= 0.35) isHighCost = false;
        else isHighCost = "ambiguous";
      }
      if (isHighCost === "ambiguous") return { decision: "abstain" };
      const applicable = isHighCost ? limits.highCost : limits.standard;
      overLimit = amountUsd > applicable;
    }
  }

  return { decision: overLimit ? "needs_approval" : "approve" };
}
