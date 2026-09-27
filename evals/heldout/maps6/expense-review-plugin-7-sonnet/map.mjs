// Expense line triage against a written T&E policy.
// approve | needs_approval | reject | abstain

const DOLLAR_OPTIONS = [
  0, 25, 30, 40, 50, 60, 65, 70, 75, 80, 90, 100, 110, 120, 125, 130, 140,
  150, 175, 200, 225, 250, 275, 300, 350, 400, 450, 500, 600, 750, 1000,
];

function dollarCriteria(noneStatedDescription) {
  const criteria = {};
  for (const v of DOLLAR_OPTIONS) {
    criteria[String(v)] = `policy_text states exactly USD ${v} as this limit`;
  }
  criteria.none_stated = noneStatedDescription;
  return criteria;
}

function toUsd(expense, fxToUsd) {
  const rate = fxToUsd && fxToUsd[expense.currency];
  if (typeof rate !== "number" || typeof expense.amount !== "number") return null;
  return Math.round(expense.amount * rate * 100) / 100;
}

export function buildState(input) {
  const { expense, policy_text, fx_to_usd } = input;
  return {
    policy_text,
    category: expense.category,
    city: expense.city,
    description: expense.description,
    receipt_attached: expense.receipt_attached,
    original_amount: expense.amount,
    original_currency: expense.currency,
    usd_amount: toUsd(expense, fx_to_usd),
  };
}

export function questions(input) {
  return {
    city_tier: {
      type: "choice",
      instructions:
        "Based on `policy_text`, is the city named in `city` one of the higher-cost cities that the policy gives its own (higher) limits, or is it a standard city under the policy?",
      criteria: {
        high_cost:
          "policy_text lists this city among its high-cost / higher-limit cities",
        standard:
          "policy_text does not list this city as high-cost, so its standard limits apply",
      },
    },
    category_limit_standard: {
      type: "choice",
      instructions:
        "According to `policy_text`, what per-unit (per day, per night, or per trip, as applicable) USD limit does the policy state for the expense category named in `category`, in a STANDARD (non high-cost) city? Give the exact number policy_text states.",
      criteria: dollarCriteria(
        "policy_text states no specific USD limit for this category"
      ),
    },
    category_limit_high_cost: {
      type: "choice",
      instructions:
        "According to `policy_text`, what per-unit (per day, per night, or per trip, as applicable) USD limit does the policy state for the expense category named in `category`, in a HIGH-COST city? Give the exact number policy_text states; if policy_text uses the same limit regardless of city, give that same number here.",
      criteria: dollarCriteria(
        "policy_text states no specific USD limit for this category"
      ),
    },
    receipt_threshold: {
      type: "choice",
      instructions:
        "According to `policy_text`, above what USD amount does a single expense require an itemised receipt (with manager approval required when that receipt is missing)? Give the exact number policy_text states.",
      criteria: dollarCriteria(
        "policy_text states no itemised-receipt threshold"
      ),
    },
    includes_alcohol_or_entertainment: {
      type: "noul",
      instructions:
        "Do `category` and `description` show that this expense includes any alcohol or entertainment, even as just part of a larger purchase (for example a bar tab within a dinner, or tickets within a client outing)?",
      criteria: {
        true: "the expense includes an alcohol or entertainment component",
        false: "the expense includes no alcohol or entertainment",
      },
    },
    alcohol_entertainment_barred: {
      type: "noul",
      instructions:
        "Does `policy_text` state that alcohol and/or entertainment expenses are never reimbursable, regardless of amount?",
      criteria: {
        true: "policy_text bars alcohol/entertainment outright",
        false: "policy_text does not state such a blanket bar",
      },
    },
    over_limit_treatment: {
      type: "choice",
      instructions:
        "When a single expense exceeds the USD limit that applies to it, does `policy_text` say it goes to a manager for approval, say it is rejected outright, or not address this at all?",
      criteria: {
        manager_approval: "policy_text sends over-limit expenses to manager approval",
        reject: "policy_text has over-limit expenses rejected outright",
        unspecified: "policy_text does not address what happens when a limit is exceeded",
      },
    },
  };
}

const CONF = 0.7;
const HIGH_CONF = 0.85;

export function decide(answers, input) {
  const { expense, fx_to_usd, policy_text } = input || {};

  if (
    !policy_text ||
    !expense ||
    typeof expense.amount !== "number" ||
    !expense.category ||
    !expense.city ||
    !expense.currency
  ) {
    return { decision: "abstain" };
  }

  const usdAmount = toUsd(expense, fx_to_usd);
  if (usdAmount === null) {
    return { decision: "abstain" }; // no FX rate for this currency, can't evaluate any USD limit
  }

  const alcohol = answers.includes_alcohol_or_entertainment?.noul ?? 0;
  const barred = answers.alcohol_entertainment_barred?.noul ?? 0;
  if (alcohol >= HIGH_CONF && barred >= HIGH_CONF) {
    return { decision: "reject" };
  }

  const tierAns = answers.city_tier;
  const tier = tierAns?.choice;
  const tierConf = tierAns?.confidence ?? 0;

  const limitAns =
    tier === "high_cost"
      ? answers.category_limit_high_cost
      : answers.category_limit_standard;
  const limitVal = limitAns?.choice;
  const limitConf = limitAns?.confidence ?? 0;

  if (
    !tier ||
    tierConf < CONF ||
    !limitVal ||
    limitVal === "none_stated" ||
    limitConf < CONF
  ) {
    return { decision: "needs_approval" }; // no policy limit we can confidently apply
  }

  const limitUsd = Number(limitVal);
  const exceedsLimit = usdAmount > limitUsd;

  if (exceedsLimit) {
    const treatment = answers.over_limit_treatment?.choice;
    const treatmentConf = answers.over_limit_treatment?.confidence ?? 0;
    if (treatment === "reject" && treatmentConf >= HIGH_CONF) {
      return { decision: "reject" };
    }
    return { decision: "needs_approval" };
  }

  const receiptVal = answers.receipt_threshold?.choice;
  const receiptConf = answers.receipt_threshold?.confidence ?? 0;
  const hasReceiptRule =
    receiptVal && receiptVal !== "none_stated" && receiptConf >= CONF;
  if (hasReceiptRule && usdAmount > Number(receiptVal) && !expense.receipt_attached) {
    return { decision: "needs_approval" };
  }

  if (alcohol >= CONF && barred >= CONF) {
    return { decision: "needs_approval" }; // suspect alcohol/entertainment, not confident enough to reject outright
  }

  return { decision: "approve" };
}
