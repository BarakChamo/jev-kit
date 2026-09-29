// Purchase-request triage against a fixed approval policy:
//   1. blocked vendor                                -> reject
//   2. software purchase, vendor not approved-software -> needs_security
//   3. amount > 50,000 USD                           -> reject, unless requester is a director -> needs_finance
//   4. amount > 10,000 USD                           -> needs_finance
//   5. amount > 1,000 USD                            -> needs_manager
//   6. otherwise                                     -> approve
// Rules are pinned in code (they are the same for every case); Jev is only asked
// about per-case facts it can judge from free text: which vendor is meant, whether
// the purchase is software, and whether the requester is a director. The purchase
// amount is read out of request_text and converted with `rates` in code, never asked
// as a question, since Jev has no reliable way to return an arbitrary stated number.

const SYMBOL_TO_CODE = {
  '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY',
  '₩': 'KRW', '₹': 'INR', '₺': 'TRY', '฿': 'THB',
};

const TOTAL_KEYWORDS = /total|amount to|amount of|grand total|cost of|price of|sum of|invoice|purchase (?:price|of)|for a total/i;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Reads every currency-tagged number in `text` and, if exactly one distinct
// amount is stated (or one clearly marked as the total), converts it to USD
// with `rates`. Returns null when no amount, or more than one ambiguous
// amount, is found — the caller should abstain in that case.
function extractAmountUSD(text, rates) {
  const codes = Object.keys(rates);
  const codeAlt = codes.map(escapeRe).join('|');
  const num = '(\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)';
  const matches = [];
  let m;

  const symAlt = Object.keys(SYMBOL_TO_CODE).map(escapeRe).join('|');
  const symRe = new RegExp(`(${symAlt})\\s?${num}`, 'g');
  while ((m = symRe.exec(text))) {
    const code = SYMBOL_TO_CODE[m[1]];
    if (code && rates[code] !== undefined) {
      matches.push({ index: m.index, value: parseFloat(m[2].replace(/,/g, '')), code });
    }
  }

  if (codeAlt) {
    const reNumCode = new RegExp(`${num}\\s?(${codeAlt})\\b`, 'gi');
    while ((m = reNumCode.exec(text))) {
      matches.push({ index: m.index, value: parseFloat(m[1].replace(/,/g, '')), code: m[2].toUpperCase() });
    }
    const reCodeNum = new RegExp(`\\b(${codeAlt})\\s?${num}`, 'gi');
    while ((m = reCodeNum.exec(text))) {
      matches.push({ index: m.index, value: parseFloat(m[2].replace(/,/g, '')), code: m[1].toUpperCase() });
    }
  }

  if (matches.length === 0) return null;

  const seenIndex = new Set();
  const unique = matches
    .sort((a, b) => a.index - b.index)
    .filter((mm) => (seenIndex.has(mm.index) ? false : (seenIndex.add(mm.index), true)));

  const distinct = new Set(unique.map((mm) => `${mm.value}_${mm.code}`));
  let chosen;
  if (distinct.size === 1) {
    chosen = unique[0];
  } else {
    const preferred = unique.filter((mm) => TOTAL_KEYWORDS.test(text.slice(Math.max(0, mm.index - 25), mm.index)));
    const preferredDistinct = new Set(preferred.map((mm) => `${mm.value}_${mm.code}`));
    if (preferredDistinct.size !== 1) return null;
    chosen = preferred[0];
  }

  const rate = rates[chosen.code];
  if (rate === undefined) return null;
  return chosen.value * rate;
}

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    rates: input.rates,
    vendors: input.vendors,
    requester: input.requester,
    request_text: input.request_text,
  };
}

export function questions(input) {
  const vendorCriteria = {};
  for (const v of input.vendors) {
    const aliases = v.also_known_as && v.also_known_as.length ? `, also known as: ${v.also_known_as.join(', ')}` : '';
    vendorCriteria[v.vendor] = `the request refers to this vendor${aliases}`;
  }
  vendorCriteria['none'] = 'no vendor in `vendors` is being referred to, or the request names a vendor not on that list';

  return {
    vendor: {
      type: 'choice',
      instructions: 'Which entry in `vendors` does the vendor named in `request_text` refer to? Match on the vendor name or any of its `also_known_as` aliases, allowing for minor spelling variation, abbreviation, or missing punctuation.',
      criteria: vendorCriteria,
    },
    is_software: {
      type: 'noul',
      instructions: 'Is the purchase described in `request_text` for software (a software license, subscription, SaaS platform, or application), rather than physical hardware, other goods, or a non-software professional service?',
      criteria: {
        true: 'the thing being purchased is software or a software-based service',
        false: 'the thing being purchased is hardware, other physical goods, or a non-software service',
      },
    },
    is_director: {
      type: 'noul',
      instructions: 'Does `requester.title` show that the requester holds the title of director (for example "Director" or "Director of X"), rather than a different title such as engineer, manager, VP, or another executive title that is not itself "director"?',
      criteria: {
        true: '`requester.title` is a director title',
        false: '`requester.title` is not a director title',
      },
    },
  };
}

function isAmbiguousNoul(p, low = 0.3, high = 0.7) {
  return p === undefined || p === null || (p > low && p < high);
}

export function decide(answers, input) {
  const vendorAns = answers.vendor;
  if (!vendorAns) return { decision: 'abstain' };
  const vendorTopProb = vendorAns.probabilities ? vendorAns.probabilities[vendorAns.choice] : vendorAns.confidence;
  if (vendorTopProb === undefined || vendorTopProb < 0.6) return { decision: 'abstain' };

  const softwareAns = answers.is_software;
  if (isAmbiguousNoul(softwareAns && softwareAns.noul)) return { decision: 'abstain' };
  const isSoftware = softwareAns.noul >= 0.7;

  const amountUSD = extractAmountUSD(input.request_text, input.rates);
  if (amountUSD === null) return { decision: 'abstain' };

  const vendor = vendorAns.choice === 'none' ? null : input.vendors.find((v) => v.vendor === vendorAns.choice);

  if (vendor && vendor.blocked) return { decision: 'reject' };

  if (isSoftware && !(vendor && vendor.approved_software)) return { decision: 'needs_security' };

  if (amountUSD > 50000) {
    const directorAns = answers.is_director;
    if (isAmbiguousNoul(directorAns && directorAns.noul)) return { decision: 'abstain' };
    return directorAns.noul >= 0.7 ? { decision: 'needs_finance' } : { decision: 'reject' };
  }

  if (amountUSD > 10000) return { decision: 'needs_finance' };
  if (amountUSD > 1000) return { decision: 'needs_manager' };
  return { decision: 'approve' };
}
