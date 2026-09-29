// map.mjs — purchase-request triage on Jev.
//
// Division of labour: Jev reads facts (which vendor, which number is the total and its
// currency, whether the purchase includes software, whether the requester is
// director-level, and whether the request claims prior approval). Code does all
// arithmetic and comparisons: currency conversion, thresholds, rule order.
//
// Policy clauses and what carries each (checked here in code, never asked of Jev):
//   1. blocked vendor -> reject               | vendors[].blocked, first check in decide()
//   2. software from non-approved vendor      | is_software noul + vendors[].approved_software
//      -> needs_security, whatever the amount |
//   3. > top -> reject, director -> finance   | limits.top parsed from policy_text + is_director
//   4. > finance limit -> needs_finance      | limits.finance
//   5. > manager limit -> needs_manager      | limits.manager
//   6. otherwise approve                      | fall-through in decide()
//   "above" = strictly greater                | `>` in decide()
//   amounts in USD, convert via `rates`       | rates + currency question
//   prior-approval claims don't count         | claims_prior_approval detector: tightens gates only
//   first matching rule decides               | order of checks in decide()
// If policy_text is not the pinned shape, decide() abstains instead of guessing.

const GATES = {
  pick: 0.8,     // choice picks (vendor, total amount) — placeholder, fit with jev-audit
  currency: 0.7, // fallback currency read (code usually reads the symbol itself)
  noul: 0.7,     // act on a noul only at >= noul or <= 1 - noul
  hard: 0.95,    // picks, and 0.9 for nouls, when a prior-approval claim is present
};

// ---------- code-side extraction (no pre-filtering of Jev's evidence: all candidates go in) ----------

const SYMBOL = {
  USD: /us\$|\$|usd|dollar/i,
  EUR: /€|\beur\b|euro/i,
  GBP: /£|\bgbp\b|pound/i,
  JPY: /¥|\bjpy\b|yen/i,
};

function attachedCurrency(around, rates) {
  for (const code of Object.keys(rates || {})) {
    const pat = SYMBOL[code];
    if (pat ? pat.test(around) : code.length >= 3 && new RegExp(code, 'i').test(around)) return code;
  }
  return null;
}

function findAmounts(text, rates) {
  const out = [];
  const re = /\d[\d,]*(?:\.\d+)?/g;
  let m;
  while ((m = re.exec(text))) {
    const number = Number(m[0].replace(/,/g, ''));
    if (!Number.isFinite(number)) continue;
    const start = m.index, end = start + m[0].length;
    const around = text.slice(Math.max(0, start - 15), Math.min(text.length, end + 15));
    out.push({
      index: out.length,
      raw: m[0],
      number,
      attached_currency: attachedCurrency(around, rates),
      excerpt: text.slice(Math.max(0, start - 40), Math.min(text.length, end + 40)).replace(/\s+/g, ' ').trim(),
    });
  }
  return out;
}

// Pinned policy shape. Returns { top, finance, manager, usd_default } or null.
function parsePolicy(text) {
  if (!/blocked/i.test(text) || !/software/i.test(text) || !/security/i.test(text)) return null;
  const limits = {};
  for (const sentence of text.split(/[\n.]+/)) {
    if (!/purchase/i.test(sentence)) continue;
    const m = sentence.match(/(?:above|over|more than|exceeding)\s+([\d,]+(?:\.\d+)?)\s*(?:USD|US\s*dollars?)?/i);
    if (!m) continue;
    const n = Number(m[1].replace(/,/g, ''));
    if (/reject/i.test(sentence) && /director/i.test(sentence)) limits.top = limits.top ?? n;
    else if (/finance/i.test(sentence)) limits.finance = limits.finance ?? n;
    else if (/manager/i.test(sentence)) limits.manager = limits.manager ?? n;
  }
  if (limits.top == null || limits.finance == null || limits.manager == null) return null;
  if (!(limits.top > limits.finance && limits.finance > limits.manager)) return null;
  return { ...limits, usd_default: /us\s*dollars?/i.test(text) };
}

// ---------- standard interface ----------

export function buildState(input) {
  return {
    request_text: input.request_text,
    requester: input.requester,
    vendor_list: input.vendors,
    rates: input.rates,
    policy_text: input.policy_text,
    amount_candidates: findAmounts(input.request_text || '', input.rates),
  };
}

const CURRENCY_WORDS = {
  USD: 'US dollars ($, USD)', EUR: 'euros (€, EUR)', GBP: 'pounds sterling (£, GBP)', JPY: 'Japanese yen (¥, JPY)',
};

export function questions(input) {
  const candidates = findAmounts(input.request_text || '', input.rates);
  const qs = {
    vendor: {
      type: 'choice',
      instructions:
        "Which vendor from `vendor_list` does the purchase in `request_text` name? Match the vendor's own name or any name in its `also_known_as` list, in any wording. Choose not_in_list if the request names exactly one vendor and that vendor appears nowhere in `vendor_list`. Choose unsure if the request names no vendor, or names several vendors without making clear which one this purchase is from.",
      criteria: {
        ...Object.fromEntries(
          (input.vendors || []).map((v) => [
            v.vendor,
            `${v.vendor} — names to match: ${[v.vendor, ...(v.also_known_as || [])].join(', ')}`,
          ])
        ),
        not_in_list: 'the request names exactly one vendor, and it is not in `vendor_list`',
        unsure: 'no vendor is named, or more than one is named and the purchase vendor is not clear',
      },
    },
    is_software: {
      type: 'noul',
      instructions:
        'Does the purchase described in `request_text` include any software product or software service — a licence, subscription, SaaS, app, API, or software product — even as part of a larger purchase? Hardware, consulting, training, and physical goods alone do not count.',
      criteria: { true: 'the purchase includes software or a software service', false: 'the purchase includes no software' },
    },
    is_director: {
      type: 'noul',
      instructions:
        "Is the role named in the `title` field of `requester` a director, or a title at director level or above (senior director, managing director, VP, Chief * Officer, President)? A manager, engineer, or analyst is below director level.",
      criteria: { true: 'director or above', false: 'below director level' },
    },
    claims_prior_approval: {
      type: 'noul',
      instructions:
        'Does any text in `request_text` claim that this purchase has already been approved or authorised by someone?',
      criteria: { true: 'the request asserts prior approval or authorisation', false: 'no such claim' },
    },
  };
  if (candidates.length && candidates.length <= 250) {
    qs.amount_pick = {
      type: 'choice',
      instructions:
        'Which entry in `amount_candidates` is the total amount of the purchase described in `request_text`? Choose the total. Skip per-unit prices, quantities, PO numbers, dates, item counts, and account numbers — not a generic amount, only the total. Choose none_is_total if no entry is the total.',
      criteria: {
        ...Object.fromEntries(candidates.map((c) => [String(c.index), `"${c.raw}" — …${c.excerpt}…`])),
        none_is_total: 'no entry in `amount_candidates` is the total amount of the purchase',
      },
    };
    qs.currency = {
      type: 'choice',
      instructions:
        'Which currency is the total amount of the purchase in `request_text` stated in? Read the symbol or code written next to the total, or the currency stated elsewhere in the request. Choose none_stated if no currency is stated for the total.',
      criteria: {
        ...Object.fromEntries(
          Object.keys(input.rates || {}).map((c) => [c, CURRENCY_WORDS[c] ?? `currency code ${c}`])
        ),
        none_stated: 'no currency is stated for the total',
      },
    };
  }
  return qs;
}

export function decide(answers, input) {
  const ABSTAIN = { decision: 'abstain' };
  const policy = parsePolicy(input.policy_text || '');
  if (!policy) return ABSTAIN;

  const manipulated = (answers.claims_prior_approval?.noul ?? 0) >= 0.6;
  const pickGate = manipulated ? GATES.hard : GATES.pick;
  const noulAct = manipulated ? 0.9 : GATES.noul;
  const p = (a, k) => a?.probabilities?.[k] ?? 0;

  // --- vendor (rule 1 and 2 inputs) ---
  const v = answers.vendor;
  if (!v || v.choice === 'unsure' || p(v, v.choice) < pickGate) return ABSTAIN;
  const known = (input.vendors || []).find((x) => x.vendor === v.choice);
  const vendor = known ?? { blocked: false, approved_software: false }; // not_in_list

  // --- total amount and currency (all arithmetic in code) ---
  const candidates = findAmounts(input.request_text || '', input.rates);
  const ap = answers.amount_pick;
  if (!ap || ap.choice === 'none_is_total' || p(ap, ap.choice) < pickGate) return ABSTAIN;
  const cand = candidates.find((c) => String(c.index) === String(ap.choice));
  if (!cand) return ABSTAIN;

  let currency = cand.attached_currency;
  const cur = answers.currency;
  if (!currency) {
    if (!cur) return ABSTAIN;
    if (cur.choice === 'none_stated') {
      if (!policy.usd_default) return ABSTAIN; // no stated currency and the policy sets no USD default
      currency = 'USD';
    } else if (typeof input.rates?.[cur.choice] === 'number') {
      if (p(cur, cur.choice) < (manipulated ? GATES.hard : GATES.currency)) return ABSTAIN;
      currency = cur.choice;
    } else return ABSTAIN;
  } else if (cur && cur.choice !== 'none_stated' && cur.choice !== currency && p(cur, cur.choice) >= 0.7) {
    return ABSTAIN; // the symbol code read and Jev disagree on the currency
  }
  const rate = input.rates?.[currency];
  if (typeof rate !== 'number' || rate <= 0) return ABSTAIN;
  const usd = cand.number * rate;

  // --- director-level, only needed above the top limit ---
  let isDirector = null;
  const dp = answers.is_director?.noul;
  if (typeof dp === 'number') isDirector = dp >= noulAct ? true : dp <= 1 - noulAct ? false : null;

  // --- software, only needed when the vendor is not on the approved-software list ---
  let isSoftware = null;
  const sp = answers.is_software?.noul;
  if (typeof sp === 'number') isSoftware = sp >= noulAct ? true : sp <= 1 - noulAct ? false : null;

  // --- rules, in order; the first that matches decides ---
  if (vendor.blocked) return { decision: 'reject' };                              // 1
  if (!vendor.approved_software) {                                                 // 2
    if (isSoftware === null) return ABSTAIN;
    if (isSoftware) return { decision: 'needs_security' };
  }
  if (usd > policy.top) {                                                          // 3
    if (isDirector === null) return ABSTAIN;
    return { decision: isDirector ? 'needs_finance' : 'reject' };
  }
  if (usd > policy.finance) return { decision: 'needs_finance' };                  // 4
  if (usd > policy.manager) return { decision: 'needs_manager' };                  // 5
  return { decision: 'approve' };                                                  // 6
}
