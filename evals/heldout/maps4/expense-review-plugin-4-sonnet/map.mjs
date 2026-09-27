// Expense-line triage on Jev (TypeSafe System One).
// One case = one expense line reviewed against its own policy_text and fx_to_usd.

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Read every USD figure the policy states, so Jev picks among the exact values
// the document could mean rather than estimating a number itself (jev-questions rule 5).
function extractUsdAmounts(text) {
  const set = new Set();
  for (const m of String(text).matchAll(/USD\s*([\d][\d,]*(?:\.\d+)?)/gi)) {
    const n = parseFloat(m[1].replace(/,/g, ''));
    if (!isNaN(n)) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

function amountCriteria(amounts, notStatedText) {
  const criteria = {};
  for (const n of amounts) {
    criteria[String(n)] = `policy_text explicitly states USD ${n} as a monetary limit or threshold figure`;
  }
  criteria.not_stated = notStatedText;
  return criteria;
}

export function buildState(input) {
  const { policy_text, fx_to_usd, expense } = input;
  const rate = fx_to_usd?.[expense.currency];
  const amount_usd = typeof rate === 'number' ? round2(expense.amount * rate) : null;
  return {
    policy_text,
    category: expense.category,
    city: expense.city,
    amount_usd,
    original_amount: expense.amount,
    original_currency: expense.currency,
    receipt_attached: !!expense.receipt_attached,
    description: expense.description ?? '',
  };
}

export function questions(input) {
  const state = buildState(input);
  const amounts = extractUsdAmounts(state.policy_text).map(String);

  return {
    high_cost_city: {
      type: 'noul',
      instructions: `Does policy_text classify the city named in state.city ("${state.city}") as a high-cost city, for example by naming it (or a group it belongs to) in a list of high-cost cities used for meal or hotel limits?`,
      criteria: {
        true: 'policy_text names this city, or a named group it belongs to, as high-cost',
        false: 'policy_text does not name this city as high-cost, or draws no high-cost/standard distinction',
      },
    },
    category_limit_standard: {
      type: 'choice',
      instructions: `Reading policy_text only, what exact USD figure does it state as the limit for the expense category named in state.category ("${state.category}"), for a STANDARD (not high-cost) city? Match state.category to whichever policy_text clause addresses that kind of expense.`,
      criteria: amountCriteria(amounts, 'policy_text states no specific standard-city USD limit for this category'),
    },
    category_limit_highcost: {
      type: 'choice',
      instructions: `Reading policy_text only, what exact USD figure does it state as the limit for the expense category named in state.category ("${state.category}"), for a HIGH-COST city? Match state.category to whichever policy_text clause addresses that kind of expense.`,
      criteria: amountCriteria(amounts, 'policy_text states no specific high-cost-city USD limit for this category, or draws no high-cost distinction for it'),
    },
    receipt_required_threshold: {
      type: 'choice',
      instructions: `Reading policy_text only, what exact USD figure does it state as the single-expense amount above which an itemised receipt is required?`,
      criteria: amountCriteria(amounts, 'policy_text states no itemised-receipt threshold'),
    },
    alcohol_entertainment_included: {
      type: 'noul',
      instructions: `Does the text in state.description indicate the expense includes alcohol or entertainment, even as just one part of a larger purchase (for example a meal that includes wine or a bar tab, a show, tickets, a club)?`,
      criteria: {
        true: 'state.description indicates alcohol or entertainment is included in the expense',
        false: 'state.description gives no indication that alcohol or entertainment is included',
      },
    },
    over_limit_consequence: {
      type: 'choice',
      instructions: `Reading policy_text only, what does it say happens when an expense in a category exceeds that category's stated USD limit?`,
      criteria: {
        needs_approval: 'policy_text says it requires manager approval, or says it is not automatically rejected',
        rejected: 'policy_text says such an expense is rejected, denied, or not reimbursable',
        not_addressed: 'policy_text does not say what happens when a category limit is exceeded',
      },
    },
    missing_receipt_consequence: {
      type: 'choice',
      instructions: `Reading policy_text only, what does it say happens when a single expense above the itemised-receipt threshold has no itemised receipt?`,
      criteria: {
        needs_approval: 'policy_text says it requires manager approval',
        rejected: 'policy_text says such an expense is rejected, denied, or not reimbursable',
        not_addressed: 'policy_text does not address a missing-receipt consequence',
      },
    },
    alcohol_entertainment_consequence: {
      type: 'choice',
      instructions: `Reading policy_text only, what does it say happens to an expense that includes alcohol or entertainment?`,
      criteria: {
        rejected: 'policy_text says alcohol or entertainment is never reimbursable, is rejected, or is disallowed',
        needs_approval: 'policy_text says such an expense requires manager approval rather than outright rejection',
        not_addressed: 'policy_text says nothing about alcohol or entertainment',
      },
    },
    uncovered_category_consequence: {
      type: 'choice',
      instructions: `Reading policy_text only, what does it say happens to an expense in a category that policy_text does not explicitly address with any stated USD limit?`,
      criteria: {
        needs_approval: 'policy_text requires manager approval for anything not explicitly addressed, or implies caution for uncovered categories',
        rejected: 'policy_text says anything not explicitly covered is not reimbursable',
        not_addressed: 'policy_text gives no guidance at all for uncovered categories',
      },
    },
  };
}

export function decide(answers, input) {
  const state = buildState(input);
  if (state.amount_usd == null) return { decision: 'abstain' }; // no fx rate: cannot apply a USD-denominated policy

  const noulOf = (id) => answers[id]?.noul;
  const threeWay = (p, hi = 0.7, lo = 0.3) =>
    p == null ? null : p >= hi ? true : p <= lo ? false : null;

  function topChoice(id, minProb = 0.55) {
    const a = answers[id];
    if (!a) return null;
    const p = a.probabilities?.[a.choice] ?? a.confidence ?? 0;
    return p >= minProb ? a.choice : null;
  }

  // 'rejected' maps to reject; 'needs_approval' or an unclear/'not_addressed' policy both
  // escalate rather than auto-approve or auto-reject.
  const resolveConsequence = (choice) => (choice === 'rejected' ? 'reject' : 'needs_approval');

  const includesAlcohol = threeWay(noulOf('alcohol_entertainment_included'));
  if (includesAlcohol === true) {
    return { decision: resolveConsequence(topChoice('alcohol_entertainment_consequence') ?? 'rejected') };
  }
  if (includesAlcohol === null) {
    return { decision: 'needs_approval' }; // unsure must never relax toward approve
  }

  const isHighCost = threeWay(noulOf('high_cost_city'));
  if (isHighCost === null) {
    return { decision: 'needs_approval' };
  }

  const limitChoice = topChoice(isHighCost ? 'category_limit_highcost' : 'category_limit_standard');
  if (!limitChoice || limitChoice === 'not_stated') {
    return { decision: resolveConsequence(topChoice('uncovered_category_consequence') ?? 'needs_approval') };
  }

  const limit = parseFloat(limitChoice);
  if (state.amount_usd > limit) {
    return { decision: resolveConsequence(topChoice('over_limit_consequence') ?? 'needs_approval') };
  }

  const thresholdChoice = topChoice('receipt_required_threshold');
  const threshold = thresholdChoice && thresholdChoice !== 'not_stated' ? parseFloat(thresholdChoice) : null;
  const receiptMissing = threshold != null && state.amount_usd > threshold && !state.receipt_attached;
  if (receiptMissing) {
    return { decision: resolveConsequence(topChoice('missing_receipt_consequence') ?? 'needs_approval') };
  }

  return { decision: 'approve' };
}
