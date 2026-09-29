// map.mjs

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const CURRENCY_ALIASES = [
  { code: 'USD', aliases: ['USD', '$', 'dollar', 'dollars'] },
  { code: 'EUR', aliases: ['EUR', '€', 'euro', 'euros'] },
  { code: 'GBP', aliases: ['GBP', '£', 'pound', 'pounds'] },
  { code: 'JPY', aliases: ['JPY', '¥', 'yen'] },
];

function parseAmountString(raw, currencyCode = 'USD') {
  let s = String(raw).trim().replace(/\s/g, '');
  if (!s) return null;
  s = s.replace(/[.,]+$/, '');
  if (!/^[0-9.,]+$/.test(s) || !/\d/.test(s)) return null;

  const hasComma = s.includes(',');
  const hasPeriod = s.includes('.');

  if (hasComma && hasPeriod) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      // Comma decimal: 1.200,00
      s = s.replace(/\./g, '');
      s = s.replace(/,/g, '.');
    } else {
      // Period decimal: 1,200.00
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    if (/^\d{1,3}(?:,\d{3})+$/.test(s)) {
      s = s.replace(/,/g, '');
    } else {
      s = s.replace(/,/g, '.');
    }
  } else if (hasPeriod) {
    if (/^\d{1,3}(?:\.\d{3})+$/.test(s) && (currencyCode === 'EUR' || currencyCode === 'GBP')) {
      s = s.replace(/\./g, '');
    }
  }

  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const value = parseFloat(s);
  return Number.isFinite(value) ? value : null;
}

function extractAmountUsd(text, rates) {
  if (!text) return null;
  const candidates = [];
  const rateCodes = new Set(Object.keys(rates || {}).map(c => c.toUpperCase()));

  for (const unit of CURRENCY_ALIASES) {
    if (!rateCodes.has(unit.code)) continue;

    const aliasPattern = unit.aliases.map(alias => {
      if (/^[a-zA-Z]/.test(alias)) {
        return `\\b${escapeRegExp(alias)}\\b`;
      }
      return escapeRegExp(alias);
    }).join('|');

    const prefixRegex = new RegExp(`(${aliasPattern})\\s?([0-9][0-9,.]*)`, 'gi');
    const suffixRegex = new RegExp(`([0-9][0-9,.]*)\\s?(${aliasPattern})`, 'gi');

    let m;
    while ((m = prefixRegex.exec(text)) !== null) {
      const amount = parseAmountString(m[2], unit.code);
      if (amount !== null) {
        candidates.push({ amount, currency: unit.code, index: m.index, raw: m[0] });
      }
    }

    while ((m = suffixRegex.exec(text)) !== null) {
      const amount = parseAmountString(m[1], unit.code);
      if (amount !== null) {
        candidates.push({ amount, currency: unit.code, index: m.index, raw: m[0] });
      }
    }
  }

  if (candidates.length > 0) {
    const scoreCandidate = (candidate) => {
      let score = 0;
      const before = text.slice(Math.max(0, candidate.index - 80), candidate.index);
      const after = text.slice(candidate.index, candidate.index + 80);
      const around = `${before} ${after}`.toLowerCase();
      if (/(?:total|amount|cost|price|sum|purchase order|po|invoice|subscription|license|fee)\b/.test(around)) {
        score += 5;
      }
      if (/\$|€|£|¥|usd|eur|gbp|jpy/i.test(candidate.raw)) {
        score += 1;
      }
      score += candidate.index / 100000;
      return score;
    };

    candidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
    const best = candidates[0];
    const rate = rates?.[best.currency] ?? 1;
    return best.amount * rate;
  }

  const bareRegex = /(?:total|amount|cost|price|sum|purchase order|po|invoice)\D{0,30}?([0-9][0-9,.]*)/i;
  let m = bareRegex.exec(text);
  if (!m) {
    const reverseRegex = /([0-9][0-9,.]*)\s?(?:total|amount|cost|price|sum)/i;
    m = reverseRegex.exec(text);
  }
  if (m) {
    const amount = parseAmountString(m[1], 'USD');
    if (amount !== null) return amount;
  }

  return null;
}

function matchVendorFromText(text, vendors) {
  const lower = String(text || '').toLowerCase();
  const found = new Set();

  for (const v of vendors) {
    const names = [v.vendor, ...(v.also_known_as || [])];
    for (const name of names) {
      const needle = String(name || '').toLowerCase();
      if (!needle) continue;
      const regex = new RegExp(`\\b${escapeRegExp(needle)}\\b`, 'i');
      if (regex.test(lower)) found.add(v.vendor);
    }
  }

  if (found.size === 0) return null;
  if (found.size === 1) return vendors.find(v => v.vendor === [...found][0]) || null;
  return 'multiple';
}

function findVendorByChoice(choice, vendors) {
  const c = String(choice || '').trim().toLowerCase();
  for (const v of vendors) {
    const names = [v.vendor, ...(v.also_known_as || [])].map(n => String(n).toLowerCase());
    if (names.includes(c)) return v;
  }
  return null;
}

function resolveVendor(answers, input) {
  const vendors = input.vendors || [];
  const textMatch = matchVendorFromText(input.request_text, vendors);

  if (textMatch === 'multiple') return undefined;
  if (textMatch) return { vendor: textMatch, confidence: 1 };

  const answer = answers?.vendor;
  if (!answer || typeof answer.choice !== 'string') return undefined;

  const confidence = typeof answer.confidence === 'number' ? answer.confidence : 0;
  if (confidence < 0.5) return undefined;

  if (answer.choice.toLowerCase() === 'not_listed') {
    return { vendor: null, confidence };
  }

  const v = findVendorByChoice(answer.choice, vendors);
  if (v) return { vendor: v, confidence };

  return { vendor: null, confidence };
}

function isDirector(title) {
  return /\bdirector\b/i.test(title || '');
}

function determineSoftware(answers, input) {
  const p = answers?.is_software?.noul;
  if (typeof p === 'number') return p >= 0.5;

  const text = String(input.request_text || '').toLowerCase();
  return /software|saas|subscription|license|cloud|database|monitoring service|platform|api\b|app\b/.test(text);
}

function getAmountUsd(answers, input) {
  const parsed = extractAmountUsd(input.request_text, input.rates);
  if (parsed != null) return parsed;

  const above1000 = answers?.amount_above_1000?.noul;
  const above10000 = answers?.amount_above_10000?.noul;
  const above50000 = answers?.amount_above_50000?.noul;

  if ([above1000, above10000, above50000].some(p => typeof p !== 'number')) return null;

  if (above50000 >= 0.5) return 50000.01;
  if (above10000 >= 0.5) return 10000.01;
  if (above1000 >= 0.5) return 1000.01;
  return 0;
}

export function buildState(input) {
  return {
    request_text: input.request_text,
    policy_text: input.policy_text,
    rates: input.rates,
    vendors: input.vendors,
    requester: input.requester,
  };
}

export function questions(input) {
  const vendorCriteria = {};
  for (const v of input.vendors || []) {
    const aliases = v.also_known_as?.length ? ` (also known as ${v.also_known_as.join(', ')})` : '';
    vendorCriteria[v.vendor] = `The vendor is ${v.vendor}${aliases}.`;
  }
  vendorCriteria.not_listed = 'The vendor is not one of the listed vendors, or the vendor cannot be identified.';

  const thresholdQuestion = (amount) => ({
    type: 'noul',
    instructions: 'Consider the total purchase amount in the request. Convert any non-USD amount to USD using the rates in the state. Ignore prior approvals. "Above" means strictly greater than.',
    criteria: {
      true: `The total purchase amount in USD is above ${amount} USD.`,
      false: `The total purchase amount in USD is at most ${amount} USD.`,
    },
  });

  return {
    vendor: {
      type: 'choice',
      instructions: 'Identify the vendor in the purchase request using the vendor names and aliases shown in the criteria.',
      criteria: vendorCriteria,
    },
    is_software: {
      type: 'noul',
      instructions: 'Determine whether the purchase request is for software. Include software licenses, SaaS subscriptions, cloud software, monitoring software, databases, and software support or subscription renewals. Do not include hardware, physical goods, or non-software consulting services.',
      criteria: {
        true: 'The purchase is a software purchase.',
        false: 'The purchase is not a software purchase.',
      },
    },
    amount_above_1000: thresholdQuestion(1000),
    amount_above_10000: thresholdQuestion(10000),
    amount_above_50000: thresholdQuestion(50000),
  };
}

export function decide(answers, input) {
  const resolvedVendor = resolveVendor(answers, input);
  if (resolvedVendor === undefined) return 'abstain';

  const amountUsd = getAmountUsd(answers, input);
  if (amountUsd == null) return 'abstain';

  const vendor = resolvedVendor.vendor;
  const software = determineSoftware(answers, input);
  const director = isDirector(input.requester?.title);

  // Rule 1: blocked vendor
  if (vendor && vendor.blocked) return 'reject';

  // Rule 2: software from a vendor not on the approved-software list
  if (software && (!vendor || !vendor.approved_software)) return 'needs_security';

  // Rule 3: above 50,000 USD
  if (amountUsd > 50000) {
    return director ? 'needs_finance' : 'reject';
  }

  // Rule 4: above 10,000 USD
  if (amountUsd > 10000) return 'needs_finance';

  // Rule 5: above 1,000 USD
  if (amountUsd > 1000) return 'needs_manager';

  // Rule 6: anything else
  return 'approve';
}
