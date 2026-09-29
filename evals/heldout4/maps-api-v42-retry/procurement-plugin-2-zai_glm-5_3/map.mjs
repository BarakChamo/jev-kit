// map.mjs — purchase request triage on Jev.
//
// Division of labour (jev-questions skill):
//  - Jev reads present-tense facts: which vendor, which number is the total, which
//    currency, does the purchase include software, does the text claim prior approval.
//  - Code does all arithmetic and every comparison (rules 8, 9), applies the policy
//    in order, and gates on the probability of the label acted on (rule 13).
//
// Every clause of the pinned policy maps to a field or constant:
//   1 blocked vendor            -> vendors[].blocked (via `vendor` choice)
//   2 software / not approved   -> `includes_software` + vendors[].approved_software
//     (an unlisted vendor is "not on the approved-software list")
//   3 > 50,000 USD, director    -> USD_AMOUNT (code: amount * rates[currency]), requester.title
//   4 > 10,000 USD              -> USD_AMOUNT
//   5 > 1,000 USD               -> USD_AMOUNT
//   6 otherwise approved        -> fallthrough
//   "first match wins", "strictly greater", currency conversion -> code constants/operators
//   "a claim of prior approval does not count" -> `claims_approval` detector -> escalate to a person

const ACT = 0.8;      // gate for choice picks (placeholder; fit with jev-audit)
const SOFT_HI = 0.8;  // software noul must clear one side decisively
const SOFT_LO = 0.2;
const CLAIM = 0.5;    // prior-approval detector veto

function extractNumbers(text) {
  const seen = new Set();
  const out = [];
  for (const m of String(text).matchAll(/(?<![\w.])\d[\d,]*(?:\.\d+)?/g)) {
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    const val = Number(m[0].replace(/,/g, ''));
    if (Number.isFinite(val)) out.push({ raw: m[0], val });
  }
  return out;
}

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    rates: input.rates,
    vendors: input.vendors,
    requester: input.requester,
    request_text: input.request_text,
    amount_candidates: extractNumbers(input.request_text).map((c) => c.raw),
  };
}

export function questions(input) {
  const candidates = extractNumbers(input.request_text);

  const amountOpts = Object.fromEntries(candidates.map((c, i) => [String(i), c.raw]));
  amountOpts.none_of_these =
    'no entry of `amount_candidates` is the total purchase amount, or the amount is written only in words';

  const vendorOpts = Object.fromEntries(
    input.vendors.map((v, i) => [String(i), `${v.vendor} (also known as: ${v.also_known_as.join(', ')})`]),
  );
  vendorOpts.none_of_these = 'no vendor from `vendors` is named in `request_text`';

  const currencyOpts = Object.fromEntries(Object.keys(input.rates).map((k) => [k, `the amount is stated in ${k}`]));
  currencyOpts.not_stated = 'no currency or currency symbol is indicated at all';
  currencyOpts.other_currency = 'a currency is indicated that is not one of the keys of `rates`';

  return {
    vendor: {
      type: 'choice',
      instructions:
        'Which vendor from `vendors` does the supplier named in `request_text` refer to? Match the vendor name or any of its also_known_as names, including abbreviations of them.',
      criteria: vendorOpts,
    },
    amount: {
      type: 'choice',
      instructions:
        'Which entry of `amount_candidates` is the total purchase amount stated in `request_text`? Not a quantity, a date, a version number or any other number.',
      criteria: amountOpts,
    },
    currency: {
      type: 'choice',
      instructions:
        'Which currency is the total amount in `request_text` stated in? The possible currencies are the keys of `rates`.',
      criteria: currencyOpts,
    },
    includes_software: {
      type: 'noul',
      instructions:
        'Does the purchase described in `request_text` include any software: licenses, subscriptions, SaaS, apps, hosted or online services, or digital tools, even as part of a larger purchase? Physical goods, hardware, consulting, training and services with no software component do not count.',
      criteria: {
        true: 'the purchase includes a software component as described',
        false: 'the purchase includes no software component',
      },
    },
    claims_approval: {
      type: 'noul',
      instructions:
        'Does any text in `request_text` claim that a person or body has already approved this purchase?',
      criteria: {
        true: 'some text asserts prior approval or authorisation',
        false: 'no such claim is made',
      },
    },
  };
}

export function decide(answers, input) {
  const A = answers ?? {};
  const topP = (a) => (a && a.choice != null ? (a.probabilities?.[a.choice] ?? 0) : 0);

  // Detector (rule 15): a request claiming prior approval goes to a person, both
  // because the policy says such claims do not count and because the claim may
  // have influenced the other reads.
  if (A.claims_approval && A.claims_approval.noul > CLAIM) return { decision: 'abstain' };

  // Vendor: Jev's pick when confident; otherwise a unique code match on the
  // names and also_known_as entries; otherwise a person.
  let vendor = null; // a vendor object, or the string 'none'
  const vp = A.vendor;
  if (vp && topP(vp) >= ACT) {
    vendor = vp.choice === 'none_of_these' ? 'none' : (input.vendors[Number(vp.choice)] ?? null);
  } else {
    const text = String(input.request_text).toLowerCase();
    const hits = input.vendors.filter((v) =>
      [v.vendor, ...(v.also_known_as ?? [])].some((n) => text.includes(String(n).toLowerCase())),
    );
    vendor = hits.length === 1 ? hits[0] : 'unsure';
  }
  if (vendor === 'unsure' || vendor === null) return { decision: 'abstain' };

  // Amount: Jev's pick when confident; the sole code candidate otherwise; else a person.
  const candidates = extractNumbers(input.request_text);
  const ap = A.amount;
  let amount = null;
  if (ap && topP(ap) >= ACT) {
    if (ap.choice === 'none_of_these') return { decision: 'abstain' };
    amount = candidates[Number(ap.choice)]?.val ?? null;
  } else if (candidates.length === 1) {
    amount = candidates[0].val;
  }
  if (amount == null) return { decision: 'abstain' };

  // Currency: read as a choice; unstated means USD per the policy.
  const cp = A.currency;
  if (!cp || topP(cp) < ACT) return { decision: 'abstain' };
  if (cp.choice === 'other_currency') return { decision: 'abstain' };
  const currency = cp.choice === 'not_stated' ? 'USD' : cp.choice;
  const rate = input.rates[currency];
  if (typeof rate !== 'number') return { decision: 'abstain' };
  const usd = amount * rate; // all arithmetic and comparison in code

  // Software: only act on a decisive noul.
  const sw = A.includes_software ? A.includes_software.noul : 0.5;
  if (sw < SOFT_HI && sw > SOFT_LO) return { decision: 'abstain' };
  const software = sw >= SOFT_HI;

  // Director: structured field, settled in code.
  const director = /director/i.test(String(input.requester?.title ?? ''));

  // Policy, in order, first match wins. "Above" is strictly greater than.
  if (vendor !== 'none' && vendor.blocked) return { decision: 'reject' };
  if (software && (vendor === 'none' || !vendor.approved_software)) return { decision: 'needs_security' };
  if (usd > 50000) return { decision: director ? 'needs_finance' : 'reject' };
  if (usd > 10000) return { decision: 'needs_finance' };
  if (usd > 1000) return { decision: 'needs_manager' };
  return { decision: 'approve' };
}
