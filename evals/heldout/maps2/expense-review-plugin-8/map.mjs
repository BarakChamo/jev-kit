// Expense-line triage on Jev (TypeSafe System One).
//
// Design: the policy_text and its dollar figures vary per case, so the limits
// cannot be hardcoded. Instead, code extracts every USD figure that appears in
// the policy text, and Jev is only asked to (a) classify the city/category and
// (b) pick which of those already-extracted figures is the relevant one — never
// to compare amounts or do arithmetic. All comparisons/conversions happen here.

function extractUsdAmounts(text) {
  const amounts = new Set();
  const patterns = [
    /(?:USD|US\$|\$)\s?([0-9][0-9,]*(?:\.[0-9]+)?)/gi,
    /([0-9][0-9,]*(?:\.[0-9]+)?)\s?USD/gi,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const n = parseFloat(m[1].replace(/,/g, ""));
      if (Number.isFinite(n)) amounts.add(n);
    }
  }
  return [...amounts].sort((a, b) => a - b);
}

function amountCriteria(amounts, noneLabel) {
  const criteria = {};
  for (const a of amounts) {
    criteria[String(a)] = `the policy states this exact figure (USD ${a}) as the applicable amount`;
  }
  criteria.none = noneLabel;
  return criteria;
}

function parseAmount(choice) {
  if (choice === "none") return null;
  const n = parseFloat(choice);
  return Number.isFinite(n) ? n : null;
}

export function buildState(input) {
  const { policy_text, fx_to_usd, expense } = input;
  const rate = fx_to_usd[expense.currency];
  return {
    policy_text,
    fx_to_usd,
    expense,
    amount_usd: rate !== undefined ? expense.amount * rate : null,
    candidate_usd_figures: extractUsdAmounts(policy_text),
  };
}

export function questions(input) {
  const amounts = extractUsdAmounts(input.policy_text);

  return {
    never_reimbursable: {
      type: "noul",
      instructions:
        "Read `policy_text`. Does the policy state that the expense category named in `expense.category` (as further described in `expense.description`) is never reimbursable regardless of amount, such as alcohol or entertainment?",
      criteria: {
        true: "the policy names this category, or the description clearly matches a category the policy names, as never reimbursable",
        false: "the policy does not ban this category outright",
      },
    },
    high_cost_city: {
      type: "noul",
      instructions:
        "Read `policy_text`. Does the policy explicitly list the city named in `expense.city` as a high-cost city (or is `expense.city` unambiguously one of the cities it lists as high-cost)?",
      criteria: {
        true: "`expense.city` is one of the policy's listed high-cost cities",
        false: "`expense.city` is not listed as high-cost, so the standard limit applies",
      },
    },
    limit_standard: {
      type: "choice",
      instructions: `Read \`policy_text\`. For the expense category named in \`expense.category\`, in a STANDARD (not high-cost) city, which of these dollar figures does the policy state as the reimbursement limit? Pick the one figure that matches this category's standard-city limit, not a figure that belongs to a different category or to the high-cost-city limit.`,
      criteria: amountCriteria(
        amounts,
        "the policy does not state a specific numeric standard-city limit for this category"
      ),
    },
    limit_highcost: {
      type: "choice",
      instructions: `Read \`policy_text\`. For the expense category named in \`expense.category\`, in a HIGH-COST city, which of these dollar figures does the policy state as the reimbursement limit? Pick the one figure that matches this category's high-cost-city limit, not a figure that belongs to a different category or to the standard-city limit.`,
      criteria: amountCriteria(
        amounts,
        "the policy does not state a specific numeric high-cost-city limit for this category"
      ),
    },
    receipt_threshold: {
      type: "choice",
      instructions:
        "Read `policy_text`. Which of these dollar figures does the policy state as the threshold above which a single expense requires an itemised receipt?",
      criteria: amountCriteria(
        amounts,
        "the policy does not state a specific receipt-itemisation threshold"
      ),
    },
    over_limit_action: {
      type: "choice",
      instructions:
        "Read `policy_text`. What does the policy state happens to an expense that exceeds its applicable category limit?",
      criteria: {
        needs_approval:
          "the policy states or implies the expense is forwarded to a manager for approval, not rejected",
        reject: "the policy states the expense is rejected outright for exceeding the limit",
        unspecified: "the policy does not say what happens when the limit is exceeded",
      },
    },
  };
}

export function decide(answers, input) {
  const { expense, fx_to_usd } = input;
  const rate = fx_to_usd[expense.currency];
  if (rate === undefined) return { decision: "abstain" };
  const amountUsd = expense.amount * rate;

  const neverReimb = answers.never_reimbursable.noul;
  if (neverReimb >= 0.75) return { decision: "reject" };

  const highCostProb = answers.high_cost_city.noul;
  const stdChoice = answers.limit_standard;
  const highChoice = answers.limit_highcost;
  const limitStd = parseAmount(stdChoice.choice);
  const limitHigh = parseAmount(highChoice.choice);

  let limit, limitConfidence;
  if (highCostProb >= 0.6) {
    limit = limitHigh;
    limitConfidence = highChoice.probabilities[highChoice.choice];
  } else if (highCostProb <= 0.4) {
    limit = limitStd;
    limitConfidence = stdChoice.probabilities[stdChoice.choice];
  } else if (limitStd !== null && limitStd === limitHigh) {
    limit = limitStd;
    limitConfidence = Math.min(
      stdChoice.probabilities[stdChoice.choice],
      highChoice.probabilities[highChoice.choice]
    );
  } else {
    return { decision: "abstain" }; // ambiguous city class and limits disagree
  }

  if (limit === null || limitConfidence < 0.55) return { decision: "abstain" };
  if (neverReimb >= 0.4) return { decision: "needs_approval" }; // ambiguous category ban

  const receiptAns = answers.receipt_threshold;
  const receiptThreshold = parseAmount(receiptAns.choice);
  const receiptConfidence = receiptAns.probabilities[receiptAns.choice];
  if (
    receiptThreshold !== null &&
    receiptConfidence >= 0.55 &&
    amountUsd > receiptThreshold &&
    !expense.receipt_attached
  ) {
    return { decision: "needs_approval" };
  }

  if (amountUsd <= limit) return { decision: "approve" };

  const overAns = answers.over_limit_action;
  const overConfidence = overAns.probabilities[overAns.choice];
  if (overAns.choice === "reject" && overConfidence >= 0.6) return { decision: "reject" };
  return { decision: "needs_approval" };
}
