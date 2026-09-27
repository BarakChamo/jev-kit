// Expense-line triage against a written travel & expense policy.
// Numbers, city tiers and rule text are read from policy_text in code (rule: never let a
// model bucket a stated number, and never ask it to compare quantities). Jev is used only
// for the one genuine judgment call the policy text cannot settle by lookup: whether the
// free-text description includes a never-reimbursable item (alcohol/entertainment) that
// may be buried inside a larger purchase.

function stripListNumber(s) {
  return s.replace(/^\s*\d+[.)]\s*/, '').trim();
}

function sentenceChunks(policyText) {
  return String(policyText || '')
    .split(/\n+/)
    .flatMap((l) => l.split(/(?<=\.)\s+/))
    .map((c) => c.trim())
    .filter(Boolean);
}

function extractUsdNumbers(text) {
  if (!text) return [];
  return [...text.matchAll(/usd\s*([0-9]+(?:\.[0-9]+)?)/gi)].map((m) => parseFloat(m[1]));
}

const CATEGORY_KEYWORDS = {
  meal: ['meal'],
  meals: ['meal'],
  food: ['meal'],
  hotel: ['hotel', 'lodging', 'accommodation'],
  hotels: ['hotel', 'lodging', 'accommodation'],
  lodging: ['hotel', 'lodging', 'accommodation'],
  accommodation: ['hotel', 'lodging', 'accommodation'],
  ground_transport: ['ground transport', 'taxi', 'rideshare', 'train', 'transportation'],
  transport: ['ground transport', 'taxi', 'rideshare', 'train', 'transportation'],
  transportation: ['ground transport', 'taxi', 'rideshare', 'train', 'transportation'],
  taxi: ['taxi', 'ground transport'],
  rideshare: ['rideshare', 'ground transport'],
  train: ['train', 'ground transport'],
};

function categoryKeywords(category) {
  const norm = String(category || '').toLowerCase().replace(/_/g, ' ').trim();
  if (!norm) return [];
  return CATEGORY_KEYWORDS[norm] || [norm];
}

function findClauseText(policyText, keywords) {
  if (!keywords.length) return null;
  for (const chunk of sentenceChunks(policyText)) {
    const lower = chunk.toLowerCase();
    if (/usd/.test(lower) && keywords.some((k) => k && lower.includes(k))) return chunk;
  }
  return null;
}

function extractCategoryLimits(policyText, category) {
  const keywords = categoryKeywords(category);
  if (!keywords.length) return null;
  const clause = findClauseText(policyText, keywords);
  if (!clause) return null;
  const nums = extractUsdNumbers(clause);
  if (!nums.length) return null;
  return { standard: nums[0], highCost: nums.length > 1 ? nums[1] : nums[0] };
}

function extractHighCostCities(policyText) {
  const m = String(policyText || '').match(/high-cost cities[^(]*\(([^)]+)\)/i);
  if (!m) return [];
  return m[1].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function extractReceiptThreshold(policyText) {
  for (const chunk of sentenceChunks(policyText)) {
    if (/itemi[sz]ed receipt/i.test(chunk)) {
      const nums = extractUsdNumbers(chunk);
      if (nums.length) return nums[0];
    }
  }
  return null;
}

function extractOverLimitAction(policyText) {
  for (const rawChunk of sentenceChunks(policyText)) {
    const lower = rawChunk.toLowerCase();
    if (/(above|over|exceeds?)\s+(its|the)\s+limit/.test(lower)) {
      if (/manager approval|needs approval|not\s+(be\s+)?rejected/.test(lower)) return 'needs_approval';
      if (/reject/.test(lower)) return 'reject';
    }
  }
  return null;
}

function extractNeverReimbursable(policyText) {
  for (const rawChunk of sentenceChunks(policyText)) {
    const chunk = stripListNumber(rawChunk);
    const m = chunk.match(/^(.*?)\s+(?:is|are)\s+never reimbursable/i);
    if (m) {
      return m[1]
        .split(/\s*,\s*|\s+and\s+/i)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    }
  }
  return [];
}

export function buildState(input) {
  const expense = input.expense || {};
  return {
    expense_description: expense.description ?? '',
    expense_category: expense.category ?? '',
    never_reimbursable_items: extractNeverReimbursable(input.policy_text),
  };
}

export function questions(input) {
  const neverList = extractNeverReimbursable(input.policy_text);
  if (!neverList.length) return {};
  return {
    prohibited_content: {
      type: 'noul',
      instructions: `Does "expense_description" in the state describe or include any of these items: ${neverList.join(
        ', '
      )}? Count an item that is included as part of a larger purchase (e.g. wine listed within a meal), not only a standalone charge.`,
      criteria: {
        true: `expense_description includes or clearly implies one of: ${neverList.join(', ')}`,
        false: 'expense_description does not include any of those items',
      },
    },
  };
}

export function decide(answers, input) {
  const expense = input.expense || {};
  const policyText = input.policy_text || '';
  const fx = input.fx_to_usd || {};

  if (typeof expense.amount !== 'number' || !isFinite(expense.amount)) {
    return { decision: 'abstain' };
  }

  const neverList = extractNeverReimbursable(policyText);
  if (neverList.length) {
    const catNorm = String(expense.category || '').toLowerCase().replace(/_/g, ' ');
    if (catNorm && neverList.some((item) => catNorm.includes(item) || item.includes(catNorm))) {
      return { decision: 'reject' };
    }
    const p = answers.prohibited_content?.noul;
    if (typeof p === 'number') {
      if (p >= 0.7) return { decision: 'reject' };
      if (p > 0.3) return { decision: 'needs_approval' }; // genuinely ambiguous: let a manager judge
    }
  }

  const rate = fx[expense.currency];
  if (typeof rate !== 'number') return { decision: 'abstain' };
  const usdAmount = expense.amount * rate;

  const limits = extractCategoryLimits(policyText, expense.category);
  if (!limits) return { decision: 'abstain' }; // policy has no readable rule for this category

  const highCostCities = extractHighCostCities(policyText);
  const isHighCost = highCostCities.includes(String(expense.city || '').toLowerCase());
  const limit = isHighCost ? limits.highCost : limits.standard;
  const overLimit = usdAmount > limit;

  if (overLimit) {
    const action = extractOverLimitAction(policyText);
    if (action === 'reject') return { decision: 'reject' };
    if (action === 'needs_approval') return { decision: 'needs_approval' };
    return { decision: 'abstain' }; // policy doesn't say what happens above the limit
  }

  const receiptThreshold = extractReceiptThreshold(policyText);
  const missingReceipt = !expense.receipt_attached && receiptThreshold != null && usdAmount > receiptThreshold;
  if (missingReceipt) return { decision: 'needs_approval' };

  return { decision: 'approve' };
}
