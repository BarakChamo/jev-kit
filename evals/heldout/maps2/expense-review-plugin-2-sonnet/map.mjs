// Expense-line policy triage on Jev.
// One call per line: classify the expense against the policy's own categories,
// read the policy's stated USD figures exactly (as enumerated choices, never bands),
// and let code do all arithmetic and comparisons.

const AMOUNT_OPTIONS = (() => {
  const opts = [];
  for (let n = 0; n <= 200; n += 5) opts.push(n);
  for (let n = 210; n <= 500; n += 10) opts.push(n);
  for (let n = 550; n <= 1000; n += 50) opts.push(n);
  return opts;
})();

function amountCriteria(unitDescription) {
  const criteria = {};
  for (const n of AMOUNT_OPTIONS) {
    criteria[String(n)] = `the policy states this limit as exactly USD ${n}${unitDescription}`;
  }
  criteria.not_specified = `the policy text does not state a specific USD figure for this${unitDescription}`;
  return criteria;
}

function computeUsdAmount(input) {
  const { fx_to_usd, expense } = input || {};
  if (!expense || typeof expense.amount !== "number") return null;
  const rate = fx_to_usd ? fx_to_usd[expense.currency] : undefined;
  if (typeof rate !== "number") return null;
  return expense.amount * rate;
}

export function buildState(input) {
  const { policy_text, expense } = input;
  const usd_amount = computeUsdAmount(input);
  return {
    policy_text,
    expense: {
      category: expense.category,
      city: expense.city,
      amount: expense.amount,
      currency: expense.currency,
      usd_amount,
      receipt_attached: expense.receipt_attached,
      description: expense.description,
    },
  };
}

export function questions(input) {
  return {
    category_bucket: {
      type: "choice",
      instructions:
        "Read `expense.category` and `expense.description`, and the expense categories defined in `policy_text`. Classify what this expense actually is, based on what was purchased, not just its category label.",
      criteria: {
        meals: "a meal (breakfast, lunch, or dinner) for one or more people",
        hotel_lodging: "a hotel or lodging charge for one or more nights",
        ground_transport: "local ground transport such as a taxi, rideshare, or train trip",
        other_uncovered:
          "any other kind of expense not described above (e.g. flights, supplies, parking, gifts, phone/internet)",
      },
    },
    is_never_reimbursable: {
      type: "noul",
      instructions:
        "Read `expense.category`, `expense.description`, and `policy_text`. Does the true nature of this expense (not just its category label) fall into a category that the policy states is never reimbursable, such as alcohol or entertainment?",
      criteria: {
        true: "the policy explicitly excludes this kind of expense from reimbursement entirely",
        false: "the policy does not categorically exclude this expense",
      },
    },
    meal_limit_usd: {
      type: "choice",
      instructions:
        "Read `policy_text`. What is the maximum USD amount the policy allows for a meal per person per day, for the city named in `expense.city`? If the policy sets different meal limits for high-cost vs standard cities, use whichever tier `expense.city` falls into per the policy's own list of cities.",
      criteria: amountCriteria(" meal limit"),
    },
    hotel_limit_usd: {
      type: "choice",
      instructions:
        "Read `policy_text`. What is the maximum USD amount the policy allows for a hotel per night, for the city named in `expense.city`? If the policy sets different hotel limits for high-cost vs standard cities, use whichever tier `expense.city` falls into per the policy's own list of cities.",
      criteria: amountCriteria(" hotel limit"),
    },
    ground_transport_limit_usd: {
      type: "choice",
      instructions:
        "Read `policy_text`. What is the maximum USD amount the policy allows per ground-transport trip (taxi, rideshare, or train)?",
      criteria: amountCriteria(" ground transport limit"),
    },
    receipt_threshold_usd: {
      type: "choice",
      instructions:
        "Read `policy_text`. Above what single-expense USD amount does the policy require an itemised receipt before the expense can be approved without manager review?",
      criteria: amountCriteria(" receipt threshold"),
    },
    reject_over_limit: {
      type: "noul",
      instructions:
        "Read `policy_text`. For an expense that exceeds the policy's per-category spending limit, does the policy state that it is rejected outright, rather than sent for manager approval?",
      criteria: {
        true: "the policy states exceeding the limit results in rejection",
        false: "the policy states exceeding the limit requires manager approval, or the policy does not say it is rejected",
      },
    },
  };
}

function topProb(ans) {
  if (!ans) return 0;
  const fromDist = ans.probabilities ? ans.probabilities[ans.choice] : undefined;
  return typeof fromDist === "number" ? fromDist : ans.confidence ?? 0;
}

export function decide(answers, input) {
  const expense = input && input.expense;
  const usd_amount = computeUsdAmount(input);
  if (!input || !input.policy_text || !expense || usd_amount === null) {
    return { decision: "abstain" };
  }

  const neverP = answers.is_never_reimbursable?.noul ?? 0;
  if (neverP >= 0.75) return { decision: "reject" };
  let needsApproval = neverP >= 0.3;

  const catAns = answers.category_bucket;
  const bucket = catAns?.choice;
  const catConfidence = topProb(catAns);
  let covered = bucket && bucket !== "other_uncovered" && catConfidence >= 0.45;

  if (covered) {
    const limitKey =
      bucket === "meals"
        ? "meal_limit_usd"
        : bucket === "hotel_lodging"
        ? "hotel_limit_usd"
        : "ground_transport_limit_usd";
    const limitAns = answers[limitKey];
    const limitChoice = limitAns?.choice;

    if (!limitChoice || limitChoice === "not_specified") {
      covered = false;
    } else {
      const limitUsd = Number(limitChoice);
      const limitConfidence = topProb(limitAns);
      if (usd_amount > limitUsd) {
        const rejectP = answers.reject_over_limit?.noul ?? 0;
        if (rejectP >= 0.65) return { decision: "reject" };
        needsApproval = true;
      } else if (limitConfidence < 0.5) {
        needsApproval = true;
      }
    }
  }

  if (!covered) needsApproval = true;

  const receiptAns = answers.receipt_threshold_usd;
  const receiptChoice = receiptAns?.choice;
  if (!expense.receipt_attached && receiptChoice && receiptChoice !== "not_specified") {
    const thresholdUsd = Number(receiptChoice);
    const thresholdConfidence = topProb(receiptAns);
    if (usd_amount > thresholdUsd || thresholdConfidence < 0.5) {
      needsApproval = true;
    }
  }

  return { decision: needsApproval ? "needs_approval" : "approve" };
}
