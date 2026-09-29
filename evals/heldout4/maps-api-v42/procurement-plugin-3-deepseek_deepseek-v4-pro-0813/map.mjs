const CURRENCY_SYMBOLS = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥'
};

const CURRENCY_ALIASES = {
  USD: ['US\\s*dollars', 'USD', 'dollars'],
  EUR: ['EUR', 'euros?'],
  GBP: ['GBP', 'pounds?', 'sterling'],
  JPY: ['JPY', 'yen']
};

const GATE = 0.7;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseAmount(value) {
  return parseFloat(String(value).replace(/,/g, ''));
}

function extractAmountCandidates(text, rates) {
  const currencies = Object.keys(rates || {});
  const found = [];
  const number = '\\d[\\d,]*(?:\\.\\d+)?';

  const add = (match, amountText, currency, index) => {
    const amount = parseAmount(amountText);
    if (Number.isFinite(amount)) {
      found.push({ text: match[0].trim(), amount, currency, start: index });
    }
  };

  for (const currency of currencies) {
    const aliases = [...(CURRENCY_ALIASES[currency] || [currency])].sort((a, b) => b.length - a.length);
    const token = aliases.map((alias) => `(?:${alias})`).join('|');

    const codeBefore = new RegExp(`(?:${token})\\s*(${number})`, 'gi');
    for (let match; (match = codeBefore.exec(text)) !== null; ) {
      add(match, match[1], currency, match.index);
    }

    const codeAfter = new RegExp(`(${number})\\s*(?:${token})`, 'gi');
    for (let match; (match = codeAfter.exec(text)) !== null; ) {
      add(match, match[1], currency, match.index);
    }

    const symbol = CURRENCY_SYMBOLS[currency];
    if (symbol) {
      const escaped = escapeRegExp(symbol);

      const symbolBefore = new RegExp(`(?:${escaped})\\s*(${number})`, 'gi');
      for (let match; (match = symbolBefore.exec(text)) !== null; ) {
        add(match, match[1], currency, match.index);
      }

      const symbolAfter = new RegExp(`(${number})\\s*(?:${escaped})`, 'gi');
      for (let match; (match = symbolAfter.exec(text)) !== null; ) {
        add(match, match[1], currency, match.index);
      }
    }
  }

  // The policy says amounts are in USD unless another currency is stated.
  if (currencies.includes('USD')) {
    const bare = new RegExp(number, 'gi');
    for (let match; (match = bare.exec(text)) !== null; ) {
      const amount = parseAmount(match[0]);
      if (Number.isFinite(amount)) {
        found.push({ text: match[0].trim(), amount, currency: 'USD', start: match.index });
      }
    }
  }

  const dedup = new Map();
  for (const candidate of found) {
    const existing = dedup.get(candidate.start);
    if (!existing || candidate.text.length > existing.text.length) {
      dedup.set(candidate.start, candidate);
    }
  }

  const sorted = [...dedup.values()].sort((a, b) => a.start - b.start);
  const merged = [];

  for (const candidate of sorted) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.currency === candidate.currency &&
      previous.amount === candidate.amount &&
      candidate.start >= previous.start &&
      candidate.start + candidate.text.length <= previous.start + previous.text.length
    ) {
      if (candidate.text.length > previous.text.length) {
        merged[merged.length - 1] = candidate;
      }
    } else {
      merged.push(candidate);
    }
  }

  return merged.map((candidate, index) => ({
    id: `a${index}`,
    text: candidate.text,
    amount: candidate.amount,
    currency: candidate.currency
  }));
}

function parseThresholds(policyText) {
  const numbers = [];
  const regex = /\b(?:above|exceeds?)\s+(?:\$\s*)?([0-9][0-9,]*(?:\.\d+)?)/gi;

  for (let match; (match = regex.exec(policyText || '')) !== null; ) {
    numbers.push(parseAmount(match[1]));
  }

  const unique = [...new Set(numbers)].sort((a, b) => b - a);

  return {
    rejectThreshold: unique[0] ?? 50000,
    financeThreshold: unique[1] ?? 10000,
    managerThreshold: unique[2] ?? 1000
  };
}

function pickChoice(answer, gate) {
  if (!answer || answer.type !== 'choice' || !answer.choice) return null;

  const probability = Number(answer.probabilities?.[answer.choice]);
  if (!Number.isFinite(probability) || probability < gate) return null;

  return answer.choice;
}

function pickNoul(answer, gate) {
  if (!answer || answer.type !== 'noul') return null;

  const probability = Number(answer.noul);
  if (!Number.isFinite(probability)) return null;

  if (probability >= gate) return true;
  if (probability <= 1 - gate) return false;
  return null;
}

export function buildState(input) {
  const safeInput = input || {};

  return {
    policy_text: safeInput.policy_text || '',
    request_text: safeInput.request_text || '',
    rates: safeInput.rates || {},
    vendors: safeInput.vendors || [],
    requester: safeInput.requester || {},
    amount_candidates: extractAmountCandidates(safeInput.request_text || '', safeInput.rates || {})
  };
}

export function questions(input) {
  const safeInput = input || {};
  const amountCandidates = extractAmountCandidates(safeInput.request_text || '', safeInput.rates || {});

  const vendorCriteria = {};
  (safeInput.vendors || []).forEach((vendor, index) => {
    const aliases = (vendor.also_known_as || []).join(', ');
    vendorCriteria[`v${index}`] = aliases
      ? `${vendor.vendor} (also known as: ${aliases})`
      : vendor.vendor;
  });
  vendorCriteria.none_of_the_listed = 'The request_text does not indicate any vendor listed in `vendors`.';
  vendorCriteria.ambiguous_vendor = 'The request_text could refer to more than one listed vendor; a person should decide.';

  const amountCriteria = {};
  for (const candidate of amountCandidates) {
    amountCriteria[candidate.id] = `${candidate.text} — normalized as ${candidate.amount} ${candidate.currency}`;
  }
  amountCriteria.no_amount = 'The request_text states no total purchase amount, or the total has no recognized currency.';
  amountCriteria.ambiguous_amount = 'The request_text has more than one plausible total purchase amount; a person should decide.';

  return {
    vendor: {
      type: 'choice',
      instructions: 'Which vendor listed in `vendors` is the purchase in `request_text` from? Match the request against each vendor\'s `vendor` name and its `also_known_as` names. If the request names no listed vendor, choose `none_of_the_listed`. If it could be more than one listed vendor, choose `ambiguous_vendor`.',
      criteria: vendorCriteria
    },
    amount: {
      type: 'choice',
      instructions: 'Which candidate in `amount_candidates` is the total purchase amount stated in `request_text`? Choose the total being requested, not tax, shipping, unit price, or unrelated amounts. If none of the candidates is the total purchase amount, choose `no_amount`. If there is more than one plausible total, choose `ambiguous_amount`.',
      criteria: amountCriteria
    },
    is_software: {
      type: 'noul',
      instructions: 'Does `request_text` include a purchase of software, a software subscription, SaaS, a software license, a digital service, or a software product? Physical goods, hardware, and consulting or professional services do not count unless the request also explicitly includes software.',
      criteria: {
        true: '`request_text` describes a software purchase or a software/subscription/digital-service purchase.',
        false: '`request_text` describes only non-software goods or services.'
      }
    }
  };
}

export function decide(answers, input) {
  const vendorChoice = pickChoice(answers?.vendor, GATE);
  const amountChoice = pickChoice(answers?.amount, GATE);
  const softwareFlag = pickNoul(answers?.is_software, GATE);

  if (vendorChoice === null || amountChoice === null || softwareFlag === null) {
    return { decision: 'abstain' };
  }

  if (vendorChoice === 'none_of_the_listed' || vendorChoice === 'ambiguous_vendor') {
    return { decision: 'abstain' };
  }

  if (amountChoice === 'no_amount' || amountChoice === 'ambiguous_amount') {
    return { decision: 'abstain' };
  }

  const vendorIndex = Number(vendorChoice.slice(1));
  const vendor = (input?.vendors || [])[vendorIndex];
  if (!vendor) return { decision: 'abstain' };

  const amountCandidates = extractAmountCandidates(input?.request_text || '', input?.rates || {});
  const amountIndex = Number(amountChoice.slice(1));
  const amountCandidate = amountCandidates[amountIndex];
  if (!amountCandidate) return { decision: 'abstain' };

  const rate = input?.rates?.[amountCandidate.currency];
  const amountUsd = rate === undefined ? NaN : amountCandidate.amount * rate;
  if (!Number.isFinite(amountUsd)) return { decision: 'abstain' };

  const thresholds = parseThresholds(input?.policy_text || '');
  const director = /\bdirector\b/i.test(input?.requester?.title || '');

  if (vendor.blocked) return { decision: 'reject' };
  if (softwareFlag === true && !vendor.approved_software) return { decision: 'needs_security' };
  if (amountUsd > thresholds.rejectThreshold) {
    return { decision: director ? 'needs_finance' : 'reject' };
  }
  if (amountUsd > thresholds.financeThreshold) return { decision: 'needs_finance' };
  if (amountUsd > thresholds.managerThreshold) return { decision: 'needs_manager' };

  return { decision: 'approve' };
}
