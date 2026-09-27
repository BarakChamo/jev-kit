// Expense-line triage against a written (per-case) travel & expense policy.
// Currency conversion and limit/threshold comparisons are done in code once Jev has
// read the policy prose into discrete, bucketed facts (never asked to compare directly).

const BAND_SEGMENTS = [
  [5, 200, 5],
  [200, 500, 10],
  [500, 1000, 25],
  [1000, 2000, 100],
  [2000, 5000, 250],
];

const NOT_SPECIFIED = 'not_specified';
const CHOICE_CONF_THRESH = 0.5;

function toUsd(amount, currency, fx) {
  if (typeof amount !== 'number' || !currency || !fx) return null;
  const rate = fx[currency];
  if (typeof rate !== 'number') return null;
  return amount * rate;
}

function buildBounds() {
  const set = new Set();
  for (const [start, end, step] of BAND_SEGMENTS) {
    for (let v = start; v <= end; v += step) set.add(v);
  }
  return Array.from(set).sort((a, b) => a - b);
}

function buildBands() {
  const bands = [];
  let prev = 0;
  for (const b of buildBounds()) {
    bands.push({ key: `b_${prev}_${b}`, lower: prev, upper: b });
    prev = b;
  }
  bands.push({ key: `b_over_${prev}`, lower: prev, upper: Infinity });
  return bands;
}

function bandLabel(b) {
  if (b.upper === Infinity) return `More than $${b.lower}.`;
  if (b.lower === 0) return `$0 up to and including $${b.upper}.`;
  return `More than $${b.lower}, up to and including $${b.upper}.`;
}

function bandCriteria(bands) {
  const criteria = {};
  for (const b of bands) criteria[b.key] = bandLabel(b);
  criteria[NOT_SPECIFIED] =
    'policy_text does not state a specific numeric dollar figure for this category or situation, or does not address it at all.';
  return criteria;
}

function resolveBand(ans) {
  if (!ans || typeof ans.choice !== 'string') return { status: 'unclear' };
  const p = ans.probabilities?.[ans.choice] ?? ans.confidence ?? 0;
  if (p < CHOICE_CONF_THRESH) return { status: 'unclear' };
  return { status: 'ok', key: ans.choice };
}

// Compares an exact known amount against a band that only bounds an unknown policy
// figure: 'within'/'over' only when the amount is outside the band entirely, else
// 'ambiguous' since the real figure could be on either side of the amount.
function compareBand(amountUsd, bandKey, bands) {
  if (bandKey === NOT_SPECIFIED) return NOT_SPECIFIED;
  const b = bands.find((x) => x.key === bandKey);
  if (!b) return 'ambiguous';
  if (amountUsd <= b.lower) return 'within';
  if (amountUsd > b.upper) return 'over';
  return 'ambiguous';
}

function chooseAction(ans) {
  if (!ans || typeof ans.choice !== 'string') return 'unclear';
  const p = ans.probabilities?.[ans.choice] ?? ans.confidence ?? 0;
  if (p < CHOICE_CONF_THRESH) return 'unclear';
  return ans.choice;
}

export function buildState(input) {
  const expense = input.expense || {};
  const amountUsd = toUsd(expense.amount, expense.currency, input.fx_to_usd);
  return {
    policy_text: input.policy_text,
    category: expense.category,
    city: expense.city,
    description: expense.description,
    receipt_attached: expense.receipt_attached,
    currency: expense.currency,
    amount: expense.amount,
    amount_usd: amountUsd == null ? null : Math.round(amountUsd * 100) / 100,
  };
}

export function questions(input) {
  const expense = input.expense || {};
  const criteria = bandCriteria(buildBands());
  const actionCriteria = {
    manager_approval: 'policy_text says this situation requires manager approval.',
    rejected_outright: 'policy_text says this situation is rejected outright, with no approval path.',
    not_stated: 'policy_text does not say what happens in this situation.',
  };

  const q = {
    never_reimbursable: {
      type: 'noul',
      instructions:
        'Does policy_text explicitly state that expenses of the category named in `category`, or matching the description in `description`, are never reimbursable regardless of amount, receipts, or approval (for example a blanket ban on alcohol, entertainment, or a similar named exclusion)?',
      criteria: {
        true: 'policy_text contains an explicit blanket ban that covers this expense',
        false: 'no such blanket ban in policy_text covers this expense',
      },
    },
    category_limit_band: {
      type: 'choice',
      instructions:
        'Read policy_text. What per-unit dollar limit (per day, per night, or per trip, whichever the policy uses) does it set for expenses in the category named in `category`, for the city named in `city`? If policy_text treats `city` as a higher-cost city, use that higher limit; otherwise use the standard limit. Pick the band containing that exact dollar figure.',
      criteria,
    },
    over_limit_action: {
      type: 'choice',
      instructions:
        'Read policy_text. When an expense in the category named in `category` exceeds its policy limit, does policy_text say the expense is rejected outright, or that it requires manager approval instead?',
      criteria: actionCriteria,
    },
  };

  if (!expense.receipt_attached) {
    q.receipt_threshold_band = {
      type: 'choice',
      instructions: 'Read policy_text. Above what per-expense dollar amount does policy_text require an itemised receipt?',
      criteria,
    };
    q.missing_receipt_action = {
      type: 'choice',
      instructions:
        'Read policy_text. When an expense above the itemised-receipt threshold is missing that receipt, does policy_text say the expense is rejected outright, or that it requires manager approval instead?',
      criteria: actionCriteria,
    };
  }

  return q;
}

export function decide(answers, input) {
  const expense = input.expense || {};
  const amountUsd = toUsd(expense.amount, expense.currency, input.fx_to_usd);
  if (amountUsd == null || !input.policy_text) return { decision: 'abstain' };

  const neverReimb = answers.never_reimbursable;
  if (!neverReimb || typeof neverReimb.noul !== 'number') return { decision: 'abstain' };
  if (neverReimb.noul >= 0.7) return { decision: 'reject' };
  if (neverReimb.noul > 0.3) return { decision: 'needs_approval' };

  const bands = buildBands();
  const limitRes = resolveBand(answers.category_limit_band);
  if (limitRes.status === 'unclear' || limitRes.key === NOT_SPECIFIED) {
    return { decision: 'needs_approval' };
  }
  const limitCmp = compareBand(amountUsd, limitRes.key, bands);
  if (limitCmp === 'over' || limitCmp === 'ambiguous') {
    const action = chooseAction(answers.over_limit_action);
    return { decision: action === 'rejected_outright' ? 'reject' : 'needs_approval' };
  }

  if (expense.receipt_attached) return { decision: 'approve' };

  const thrRes = resolveBand(answers.receipt_threshold_band);
  if (thrRes.status === 'unclear') return { decision: 'needs_approval' };
  if (thrRes.key === NOT_SPECIFIED) return { decision: 'approve' };
  const thrCmp = compareBand(amountUsd, thrRes.key, bands);
  if (thrCmp === 'within') return { decision: 'approve' };

  const action2 = chooseAction(answers.missing_receipt_action);
  return { decision: action2 === 'rejected_outright' ? 'reject' : 'needs_approval' };
}
