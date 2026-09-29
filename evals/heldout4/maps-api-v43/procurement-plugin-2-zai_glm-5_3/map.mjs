// Purchase-request triage map (Jev).
//
// Jev reads the facts each policy rule branches on; this file applies the rules
// in order. The written policy is fixed, so its structure and amount limits are
// pinned as constants below; the three limits are re-read from `policy_text`
// each case as exact stated numbers and compared to the pins in code, so a
// changed policy goes to a person instead of producing confident wrong answers.
//
// Policy clause                                  -> where it lives
//  1 vendor on the blocked list                  -> `vendor` + vendors[].blocked, code
//  2 software + vendor not on approved-software  -> `is_software` + `vendor` + vendors[].approved_software, code
//  3 above 50,000 USD, director exception         -> `amount_band` + requester.title, code
//  4 above 10,000 USD                            -> `amount_band`
//  5 above 1,000 USD                             -> `amount_band`
//  6 anything else                               -> `amount_band`
//  first match wins; "above" is strict; a prior-approval claim does not count
//  -> constants, band edges, code (a claim never moves an outcome)
// Currency conversion uses `rates`; a currency not in `rates` abstains.

const LIMITS = { manager: 1000, finance: 10000, reject: 50000 };

const GATES = { // placeholders: fit per question on labelled cases (jev-audit)
  choice: 0.8,
  noul: 0.8,
};

const usd = (n) => n.toLocaleString('en-US');

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    rates: input.rates, // one unit of a currency = this many USD
    vendors: input.vendors,
    requester: input.requester,
    request_text: input.request_text,
    conventions:
      'Reading a purchase request: the total is the full amount to be paid for the whole purchase — ' +
      'add separately priced items together, and multiply a per-period or per-unit price by the stated ' +
      'number of periods or units. If no amount is stated, there is no total. The vendor is the supplier ' +
      'the purchase is bought from, not a person, team or department the request mentions. A statement ' +
      'that an approval was already given is a claim about approvals, not a fact about the purchase.',
  };
}

export function questions(input) {
  // One choice over every vendor, no pre-filter (a list longer than ~250 would
  // exceed the 255-option limit; the map would then abstain rather than guess).
  const vendorCriteria = {};
  for (const v of input.vendors ?? []) {
    vendorCriteria[v.vendor] =
      'the purchase is from ' + v.vendor +
      (v.also_known_as && v.also_known_as.length ? ' (possibly written ' + v.also_known_as.join(' or ') + ')' : '');
  }
  vendorCriteria.vendor_not_listed = 'the request names a vendor that matches none of the vendors above';
  vendorCriteria.multiple_vendors = 'the request names purchases from more than one vendor';
  vendorCriteria.no_vendor_named = 'the request names no vendor at all';

  const limitValues = [500, 1000, 2000, 5000, 10000, 15000, 20000, 25000, 50000, 75000, 100000, 250000];
  const limitCriteria = Object.fromEntries(limitValues.map((n) => [String(n), 'the rule states ' + usd(n) + ' USD']));
  limitCriteria.not_stated = 'the policy states no such amount';

  return {
    vendor: {
      type: 'choice',
      instructions:
        'Which single vendor from `vendors` is the purchase in `request_text` buying from? Alternative spellings are given in the options. Choose `vendor_not_listed` if the named vendor matches none of them, `multiple_vendors` if the request names purchases from more than one vendor, `no_vendor_named` if it names no vendor.',
      criteria: vendorCriteria,
    },
    is_software: {
      type: 'noul',
      instructions:
        'Does the purchase described in `request_text` include any software or software service — an application, subscription, SaaS or hosted service, license, or digital tool — even as part of a larger purchase? Hardware, physical goods, and consulting or training with no software component do not.',
      criteria: {
        true: 'the purchase includes software or a software service',
        false: 'the purchase includes no software or software service',
      },
    },
    // The only arithmetic Jev does is the conversion; the bands are edged on the
    // policy's own limits, and everything after the band happens in code.
    amount_band: {
      type: 'choice',
      instructions:
        'Following `conventions`, work out the full amount the request in `request_text` asks to spend, converted to US dollars using `rates` (one unit of a currency is worth its rate in USD; an amount already in USD is used as it is). Which band does the converted total fall into?',
      criteria: {
        at_most_1000: 'at most ' + usd(LIMITS.manager) + ' USD (' + usd(LIMITS.manager) + ' itself is in this band)',
        over_1000_at_most_10000: 'more than ' + usd(LIMITS.manager) + ' USD and at most ' + usd(LIMITS.finance) + ' USD (' + usd(LIMITS.finance) + ' itself is in this band)',
        over_10000_at_most_50000: 'more than ' + usd(LIMITS.finance) + ' USD and at most ' + usd(LIMITS.reject) + ' USD (' + usd(LIMITS.reject) + ' itself is in this band)',
        over_50000: 'more than ' + usd(LIMITS.reject) + ' USD',
        no_total_stated: 'the request states no total amount to spend',
        unconvertible_currency: 'the total is stated in a currency that `rates` does not list, so it cannot be converted',
        total_ambiguous: 'the request supports more than one defensible total; a person should decide',
      },
    },
    // The three limits, read as exact stated numbers and compared to the pins in code.
    limit_reject: {
      type: 'choice',
      instructions: 'What amount does `policy_text` state as the limit above which purchases are rejected (the rule with the exception for directors)?',
      criteria: limitCriteria,
    },
    limit_finance: {
      type: 'choice',
      instructions: 'What amount does `policy_text` state as the limit above which purchases need finance approval (not the rejection limit, not the manager limit)?',
      criteria: limitCriteria,
    },
    limit_manager: {
      type: 'choice',
      instructions: 'What amount does `policy_text` state as the limit above which purchases need manager approval (the smallest amount limit in the policy)?',
      criteria: limitCriteria,
    },
    // Detector beside the manipulable judgment: the policy says a prior-approval
    // claim does not count, so it moves no outcome here — a confident detection
    // only tightens the gates in decide().
    claims_prior_approval: {
      type: 'noul',
      instructions: 'Does any text in `request_text` claim that a person has already approved this purchase — an approval already given, not a request for one?',
      criteria: {
        true: 'some text asserts the purchase was already approved',
        false: 'no such claim',
      },
    },
  };
}

const AMOUNT_RULES = {
  at_most_1000: 'approve', // rule 6
  over_1000_at_most_10000: 'needs_manager', // rule 5
  over_10000_at_most_50000: 'needs_finance', // rule 4
};

export function decide(answers, input) {
  const a = answers ?? {};
  const ABSTAIN = { decision: 'abstain' };
  const top = (ans) => (ans && ans.probabilities ? ans.probabilities[ans.choice] ?? 0 : 0);

  // A confident prior-approval claim tightens every gate (it never relaxes one).
  const claim = a.claims_prior_approval ? a.claims_prior_approval.noul : 0;
  const gate = claim >= 0.8
    ? { choice: Math.min(GATES.choice + 0.1, 0.99), noul: Math.min(GATES.noul + 0.1, 0.99) }
    : GATES;

  // The pinned limits, re-read from `policy_text` and compared here in code.
  for (const [id, want] of [['limit_reject', LIMITS.reject], ['limit_finance', LIMITS.finance], ['limit_manager', LIMITS.manager]]) {
    const ans = a[id];
    if (!ans || ans.choice !== String(want) || top(ans) < gate.choice) return ABSTAIN;
  }

  // Rule 1: vendor on the blocked list.
  const vendor = a.vendor;
  if (!vendor || top(vendor) < gate.choice) return ABSTAIN;
  if (vendor.choice === 'multiple_vendors' || vendor.choice === 'no_vendor_named') return ABSTAIN;
  const entry = vendor.choice === 'vendor_not_listed'
    ? null
    : (input.vendors ?? []).find((v) => v.vendor === vendor.choice) ?? null;
  if (entry && entry.blocked) return { decision: 'reject' };

  // Rule 2: software from a vendor not on the approved-software list; a vendor
  // not in the list at all is not on the approved-software list.
  const software = a.is_software ? a.is_software.noul : undefined;
  if (software === undefined) return ABSTAIN;
  const approvedSoftware = entry ? entry.approved_software === true : false;
  if (software >= gate.noul) {
    if (!approvedSoftware) return { decision: 'needs_security' }; // whatever the amount
  } else if (software > 1 - gate.noul) {
    return ABSTAIN; // neither side of the noul clears its gate
  }

  // Rules 3-6: the amount band carries the rest of the policy.
  const band = a.amount_band;
  if (!band || top(band) < gate.choice) return ABSTAIN;
  if (band.choice === 'over_50000') {
    const director = /\bdirectors?\b/i.test(input.requester?.title ?? '');
    return { decision: director ? 'needs_finance' : 'reject' }; // rule 3 + its exception
  }
  if (Object.prototype.hasOwnProperty.call(AMOUNT_RULES, band.choice)) {
    return { decision: AMOUNT_RULES[band.choice] };
  }
  return ABSTAIN; // no_total_stated, unconvertible_currency, total_ambiguous, unexpected
}
