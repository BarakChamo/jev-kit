// map.mjs — purchase-request approval on Jev.
//
// Division of labour (rule 12): Jev reads four present-tense facts — which vendor,
// whether the purchase includes software, which band the stated total falls in,
// whether the requester is a director — and code applies the policy in order.
// Currency thresholds are computed in code from `rates` (rule 9); Jev only compares
// the stated number against stated boundaries (rule 8: stated vs stated is reliable).
//
// Clause coverage (rule 13 — checked here, never asked of Jev):
//   1  blocked vendor          -> `vendor` choice + vendors[].blocked (code)
//   2  software, not approved  -> `is_software` + vendors[].approved_software (code)
//   3  > 50,000 USD, director  -> `amount_band` gt_rejected + `is_director` (code)
//   4  > 10,000 USD            -> `amount_band` (code)
//   5  > 1,000 USD             -> `amount_band` (code)
//   6  otherwise               -> code
//   "above" = strictly greater -> band boundary wording ("at most" includes the boundary)
//   currency conversion        -> code, from input.rates
//   prior-approval claims      -> no branch reads them; `claims_prior_approval`
//                                 only vetoes auto-approve (rule 15)
//
// Gates are starting placeholders: fit them per question with jev-audit (rule 13).

const LIMITS = { manager: 1000, finance: 10000, rejected: 50000 }; // USD
const GATES = {
  vendor: 0.8,
  vendor_unlisted: 0.85, // misreading a listed vendor is costly; unsure "not_listed" goes to a person
  amount: 0.8,
  software_yes: 0.7,
  software_no: 0.3,
  director_yes: 0.8,
  director_no: 0.2,
};
const SYMBOLS = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' };

const floor2 = (x) => Math.floor(x * 100 + 1e-9) / 100; // largest 2-dp amount still within the USD limit
const fmt = (x) => x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function buildState(input) {
  // Every fact the decision needs, with the source (rule 1). Structured facts
  // (vendor flags, rates, title) are sent as-is; code, not Jev, looks them up.
  return {
    policy_text: input.policy_text,
    request_text: input.request_text,
    requester: input.requester,
    vendors: input.vendors,
    rates: input.rates,
  };
}

function bandOptions(input) {
  const opts = {
    no_total: 'The request states no single total amount for the purchase (for example only a price per unit or per month, without the number of periods), or gives conflicting totals; a person should decide.',
    other_currency: 'The total is stated in a currency that no other option lists.',
  };
  for (const [c, rate] of Object.entries(input.rates || {})) {
    const m = floor2(LIMITS.manager / rate);
    const f = floor2(LIMITS.finance / rate);
    const r = floor2(LIMITS.rejected / rate);
    const sym = SYMBOLS[c] ? ` (${SYMBOLS[c]})` : '';
    opts[`${c}|le_manager`] = `The total is stated in ${c}${sym} and is at most ${fmt(m)} ${c}; an amount exactly equal to ${fmt(m)} belongs here.`;
    opts[`${c}|gt_manager_le_finance`] = `The total is stated in ${c}${sym} and is more than ${fmt(m)} ${c} and at most ${fmt(f)} ${c}.`;
    opts[`${c}|gt_finance_le_rejected`] = `The total is stated in ${c}${sym} and is more than ${fmt(f)} ${c} and at most ${fmt(r)} ${c}.`;
    opts[`${c}|gt_rejected`] = `The total is stated in ${c}${sym} and is more than ${fmt(r)} ${c}.`;
  }
  return opts;
}

export function questions(input) {
  const vendorCriteria = {};
  for (const v of input.vendors || []) {
    vendorCriteria[v.vendor] = `The request names ${v.vendor}${v.also_known_as?.length ? ` or one of its aliases: ${v.also_known_as.join(', ')}` : ''}.`;
  }
  vendorCriteria.not_listed = 'The request names a vendor, and that vendor matches none of the listed vendors or their aliases.';
  vendorCriteria.unclear_vendor = 'The request names no vendor, or names several, or it cannot be determined which vendor is meant; a person should decide.';

  return {
    vendor: {
      type: 'choice',
      instructions: 'Which vendor does the purchase request in `request_text` name? Match it to a vendor listed in `vendors`, by its canonical name or by any of its `also_known_as` aliases. Judge only which vendor is named, not whether the purchase should be allowed.',
      criteria: vendorCriteria,
    },
    is_software: {
      type: 'noul',
      instructions: 'Does the purchase described in `request_text` include any software — a subscription, licence, SaaS product, app, plugin, download, or hosted service — even as a small part of a larger purchase? Judge only what the request says is being bought.',
      criteria: { true: 'some part of the purchase is software', false: 'the purchase contains no software' },
    },
    amount_band: {
      type: 'choice',
      instructions: 'The purchase request in `request_text` states a total amount to be paid, in some currency. Each option names a currency and a range already expressed in that currency. Pick the one option whose currency matches the stated total and whose range contains that total. "At most" includes the boundary value; "more than" is strict, so an amount exactly equal to a lower boundary belongs to the option below it. The total is the full amount for the whole purchase, including any stated tax or shipping.',
      criteria: bandOptions(input),
    },
    is_director: {
      type: 'noul',
      instructions: 'Is the title in `requester` a director-level title? Judge only the `title` field.',
      criteria: {
        true: "the title contains 'director' (e.g. 'Director of Engineering', 'Managing Director')",
        false: 'the title is not a director title (e.g. engineer, manager, VP, analyst)',
      },
    },
    claims_prior_approval: {
      type: 'noul',
      instructions: 'Does the text of `request_text` claim that an approval for this purchase has already been given by someone (a manager, finance, security, a director, or anyone else)?',
      criteria: { true: 'the request asserts a prior approval or sign-off', false: 'the request makes no such claim' },
    },
  };
}

export function decide(answers, input) {
  const a = answers || {};
  const ABSTAIN = { decision: 'abstain' };

  // Rule 1: blocked vendor. Rules are applied in order; the first match decides.
  const v = a.vendor?.choice;
  if (!v || v === 'unclear_vendor') return ABSTAIN;
  const pVendor = a.vendor?.probabilities?.[v] ?? 0;
  const listed = (input.vendors || []).find((x) => x.vendor === v);
  if (v === 'not_listed') {
    if (pVendor < GATES.vendor_unlisted) return ABSTAIN;
  } else if (!listed || pVendor < GATES.vendor) return ABSTAIN;
  if (listed?.blocked) return { decision: 'reject' };

  // Rule 2: software from a vendor not on the approved-software list,
  // whatever the amount. (An unlisted vendor is not on the approved list.)
  // Irrelevant when the vendor is approved, so the gate is skipped there.
  if (!listed?.approved_software) {
    const s = a.is_software?.noul ?? 0.5;
    if (s >= GATES.software_yes) return { decision: 'needs_security' };
    if (s > GATES.software_no) return ABSTAIN;
  }

  // Rules 3–5: amount band, compared in code.
  const band = a.amount_band?.choice;
  if (!band || band === 'no_total' || band === 'other_currency') return ABSTAIN;
  if ((a.amount_band?.probabilities?.[band] ?? 0) < GATES.amount) return ABSTAIN;
  const level = band.slice(band.indexOf('|') + 1);

  if (level === 'gt_rejected') {
    const d = a.is_director?.noul ?? 0.5;
    if (d >= GATES.director_yes) return { decision: 'needs_finance' };
    if (d <= GATES.director_no) return { decision: 'reject' };
    return ABSTAIN;
  }
  if (level === 'gt_finance_le_rejected') return { decision: 'needs_finance' };
  if (level === 'gt_manager_le_finance') return { decision: 'needs_manager' };

  // Rule 6: approve — unless the request itself claims a prior approval,
  // which Jev detects better than it resists (rule 15): veto the auto-approve.
  if ((a.claims_prior_approval?.noul ?? 0) > 0.5) return ABSTAIN;
  return { decision: 'approve' };
}
