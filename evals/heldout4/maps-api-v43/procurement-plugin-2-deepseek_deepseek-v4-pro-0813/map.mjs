const VENDOR_GATE = 0.8;
const CURRENCY_GATE = 0.8;
const AMOUNT_GATE = 0.8;
const SOFTWARE_GATE = 0.7;

const CURRENCY_LABELS = {
  USD: 'United States dollar',
  EUR: 'euro',
  GBP: 'British pound',
  JPY: 'Japanese yen'
};

function vendorList(input) {
  const vendors = Array.isArray(input.vendors) ? input.vendors : [];
  return vendors.map((v) => ({
    vendor: v.vendor,
    also_known_as: Array.isArray(v.also_known_as) ? v.also_known_as : []
  }));
}

function extractAmountCandidates(text) {
  if (!text) return [];
  const matches = text.match(/(?:\bUSD\b|\bEUR\b|\bGBP\b|\bJPY\b|[$€£¥])?\s*\d[\d,]*(?:\.\d+)?/g) || [];
  const seen = new Set();
  const out = [];
  for (const raw of matches) {
    const s = raw.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= 200) break;
  }
  return out;
}

function amountToNumber(raw) {
  const cleaned = String(raw).replace(/,/g, '').replace(/[^0-9.]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function parseThresholds(policyText) {
  const thresholds = { high: 50000, mid: 10000, low: 1000 };
  if (!policyText) return thresholds;

  for (const line of policyText.split('\n')) {
    const match = line.match(/\b(?:above|over|exceeds?|more than)\s*\$?([\d,]+(?:\.\d+)?)\s*(?:USD|usd)?/i);
    if (!match) continue;

    const amount = amountToNumber(match[1]);
    if (!Number.isFinite(amount)) continue;

    if (/rejected/.test(line) && /director/.test(line)) {
      thresholds.high = amount;
    } else if (/finance approval/.test(line) && !/director/.test(line)) {
      thresholds.mid = amount;
    } else if (/manager approval/.test(line)) {
      thresholds.low = amount;
    }
  }

  return thresholds;
}

function topProbability(answer) {
  if (!answer || !answer.choice || !answer.probabilities) return 0;
  return answer.probabilities[answer.choice] ?? 0;
}

function vendorQuestion(input) {
  const listed = vendorList(input).slice(0, 254);
  const criteria = {};

  listed.forEach((v, i) => {
    const aliases = v.also_known_as.length
      ? ` (also known as ${v.also_known_as.join(', ')})`
      : '';
    criteria[String(i)] = `${v.vendor}${aliases}`;
  });

  criteria.unlisted = 'the request mentions a vendor not in `vendors`, or no vendor can be determined';

  return {
    type: 'choice',
    instructions: 'Which vendor in `vendors` does `request_text` ask to purchase from? Match the vendor by its name or alias. Ignore any claim that approval was already given. If the vendor is not in `vendors` or no vendor can be determined, choose `unlisted`.',
    criteria
  };
}

function currencyQuestion(rates) {
  const keys = rates && typeof rates === 'object' ? Object.keys(rates) : [];
  const criteria = {};

  for (const c of keys) {
    criteria[c] = CURRENCY_LABELS[c] || `the amount is in ${c}`;
  }

  if (!criteria.USD) criteria.USD = CURRENCY_LABELS.USD;

  return {
    type: 'choice',
    instructions: 'Which currency is the total monetary amount in `request_text` expressed in? If the request uses `$` or gives no currency code/symbol, treat it as USD. Use one of the currencies in `rates`.',
    criteria
  };
}

function amountQuestion(input) {
  const candidates = extractAmountCandidates(input.request_text);
  if (candidates.length === 0) return null;

  const criteria = {};
  candidates.forEach((c, i) => {
    criteria[String(i)] = `the amount ${c} appears in \`request_text\``;
  });
  criteria.none = 'none of the listed amounts is the total purchase amount';

  return {
    type: 'choice',
    instructions: 'Which exact monetary amount in `request_text` is the total purchase amount? Choose the total purchase amount, not unit prices, quantities, tax, discounts, or any claimed prior approval. If the total is not listed, choose `none`.',
    criteria
  };
}

export function buildState(input) {
  return {
    request_text: input.request_text || '',
    vendors: vendorList(input),
    rates: input.rates && typeof input.rates === 'object' ? input.rates : {}
  };
}

export function questions(input) {
  const q = {
    vendor: vendorQuestion(input),
    currency: currencyQuestion(input.rates),
    is_software: {
      type: 'noul',
      instructions: 'Does `request_text` request a purchase that includes software, a software subscription, a software license, SaaS, or a hosted monitoring service? Hardware-only purchases, consulting, office supplies, and other non-software purchases do not count.',
      criteria: {
        true: 'the request includes software, a software subscription/license, SaaS, or a hosted software/monitoring service',
        false: 'the request is only for hardware, non-software services, supplies, or another non-software purchase'
      }
    }
  };

  const amount = amountQuestion(input);
  if (amount) q.amount = amount;

  return q;
}

function vendorRecordFor(vendorChoice, vendors) {
  if (vendorChoice == null || vendorChoice === 'unlisted') return null;
  const index = Number(vendorChoice);
  if (!Number.isInteger(index) || index < 0 || index >= vendors.length) return null;
  return vendors[index];
}

function softwareFact(softwareAnswer) {
  const p = softwareAnswer?.noul;
  if (typeof p !== 'number' || !Number.isFinite(p)) return 'uncertain';
  if (p >= SOFTWARE_GATE) return 'true';
  if (p <= 1 - SOFTWARE_GATE) return 'false';
  return 'uncertain';
}

function resolveAmountUSD(answers, input) {
  const currencyAnswer = answers?.currency;
  const currency = currencyAnswer?.choice;
  const pCurrency = topProbability(currencyAnswer);
  if (!currency || pCurrency < CURRENCY_GATE) return { ok: false };

  const requestedRate = input.rates?.[currency];
  const rate = currency === 'USD' ? requestedRate ?? 1 : requestedRate;
  if (!rate || !(rate > 0)) return { ok: false };

  const amountAnswer = answers?.amount;
  if (!amountAnswer || amountAnswer.choice === 'none') return { ok: false };

  const pAmount = topProbability(amountAnswer);
  if (pAmount < AMOUNT_GATE) return { ok: false };

  const candidates = extractAmountCandidates(input.request_text);
  const amountText = candidates[Number(amountAnswer.choice)];
  if (!amountText) return { ok: false };

  const amount = amountToNumber(amountText);
  if (!Number.isFinite(amount)) return { ok: false };

  return { ok: true, usd: amount * rate };
}

export function decide(answers, input) {
  const vendorAnswer = answers?.vendor;
  const vendorChoice = vendorAnswer?.choice;
  if (!vendorChoice || topProbability(vendorAnswer) < VENDOR_GATE) {
    return { decision: 'abstain' };
  }

  const vendors = Array.isArray(input.vendors) ? input.vendors : [];
  const vendor = vendorRecordFor(vendorChoice, vendors);

  if (vendor && vendor.blocked) return { decision: 'reject' };

  const approvedSoftware = vendor ? Boolean(vendor.approved_software) : false;

  if (!approvedSoftware) {
    const software = softwareFact(answers?.is_software);
    if (software === 'true') return { decision: 'needs_security' };
    if (software === 'uncertain') return { decision: 'abstain' };
  }

  const resolved = resolveAmountUSD(answers, input);
  if (!resolved.ok) return { decision: 'abstain' };

  const thresholds = parseThresholds(input.policy_text);
  const isDirector = /director/i.test(input.requester?.title || '');

  if (resolved.usd > thresholds.high) {
    return { decision: isDirector ? 'needs_finance' : 'reject' };
  }
  if (resolved.usd > thresholds.mid) {
    return { decision: 'needs_finance' };
  }
  if (resolved.usd > thresholds.low) {
    return { decision: 'needs_manager' };
  }

  return { decision: 'approve' };
}
