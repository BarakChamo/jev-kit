// map.mjs — purchase-request approval on Jev.
//
// Division of labour: Jev reads the facts (policy thresholds as stated numbers, the
// vendor, whether the purchase includes software, the USD total as a band, the
// requester's title, and any claimed pre-approval); code converts currency-derived
// bands against thresholds, applies the written policy in order, and gates every
// read (rule 12/13). Gates below are placeholders to be fitted with jev-audit.

const GRID = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1500, 2000, 2500,
  3000, 4000, 5000, 6000, 7500, 10000, 15000, 20000, 25000, 30000, 40000, 50000,
  60000, 75000, 100000, 150000, 200000, 250000, 500000, 1000000];
const fmt = (n) => n.toLocaleString("en-US");

// USD bands whose boundaries include every candidate threshold, so "amount > t"
// is exact in code for any t on the grid: amount > t  <=>  bandLower >= t.
const BANDS = (() => {
  const edges = [0, ...GRID], out = [];
  for (let i = 0; i < edges.length; i++) {
    const lo = edges[i], hi = i + 1 < edges.length ? edges[i + 1] : null;
    out.push({
      id: hi === null ? `over_${lo}` : `${lo}_to_${hi}`,
      lo,
      desc: hi === null ? `more than USD ${fmt(lo)}`
        : lo === 0 ? `USD ${fmt(hi)} or less`
        : `more than USD ${fmt(lo)} and at most USD ${fmt(hi)}`,
    });
  }
  return out;
})();
const BAND_LOWER = Object.fromEntries(BANDS.map((b) => [b.id, b.lo]));

const THR_OPTIONS = Object.fromEntries(GRID.map((n) => [String(n), `USD ${fmt(n)}`]));
THR_OPTIONS.not_stated = "no such amount is stated in `policy_text`";

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    rates: input.rates,
    vendors: input.vendors,
    requester: input.requester,
    request_text: input.request_text,
    conventions:
      "Company reading conventions. 'Above X USD' in the policy means strictly greater than X US dollars. " +
      "A purchase counts as a software purchase if it includes any software in any form — a licence, an app, " +
      "a SaaS or hosted/online service, or a subscription to such a service — even when bundled with hardware " +
      "or bought under a broader contract. Pure hardware, consulting, training, catering and travel are not " +
      "software purchases. The total amount is the full amount payable, including any stated tax, setup or " +
      "shipping, in the currency the request states; other currencies are converted at the rates in `rates`. " +
      "Whether the requester is a director is judged only from the job title in `requester`.",
  };
}

export function questions(input) {
  const vendorCriteria = {};
  for (const v of input.vendors) {
    vendorCriteria[v.vendor] = (v.also_known_as || []).length
      ? `${v.vendor}, also written as ${(v.also_known_as || []).join(" or ")}`
      : v.vendor;
  }
  vendorCriteria.none_listed =
    "the request names no vendor at all, or names a vendor that is not on the `vendors` list";

  const bandCriteria = Object.fromEntries(BANDS.map((b) => [b.id, b.desc]));
  bandCriteria.not_stated = "the request states no amount at all";
  bandCriteria.ambiguous = "the request supports more than one total; a person should decide";

  return {
    thr_reject: {
      type: "choice",
      instructions: "One rule in `policy_text` rejects purchases above a certain amount in US dollars unless the requester is a director. What is that amount, exactly as stated in `policy_text`?",
      criteria: THR_OPTIONS,
    },
    thr_finance: {
      type: "choice",
      instructions: "One rule in `policy_text` says purchases above a certain amount in US dollars need finance approval, whatever the requester's title. What is that amount, exactly as stated in `policy_text`?",
      criteria: THR_OPTIONS,
    },
    thr_manager: {
      type: "choice",
      instructions: "One rule in `policy_text` says purchases above a certain amount in US dollars need manager approval. What is that amount, exactly as stated in `policy_text`?",
      criteria: THR_OPTIONS,
    },
    amount_band: {
      type: "choice",
      instructions: "What is the total amount payable for the purchase described in `request_text`, converted to US dollars using the rates in `rates`? Compute the conversion yourself if the request states another currency, include any stated tax, setup or shipping, then pick the band the converted total falls into.",
      criteria: bandCriteria,
    },
    vendor: {
      type: "choice",
      instructions: "Which vendor from the `vendors` list does the purchase described in `request_text` name? Match alternative spellings and the names given in each vendor's `also_known_as`.",
      criteria: vendorCriteria,
    },
    is_software: {
      type: "noul",
      instructions: "Does the purchase described in `request_text` include any software, as 'software purchase' is defined in `conventions`, even as part of a larger purchase?",
      criteria: {
        true: "the purchase includes a licence, app, SaaS or hosted/online service, or a subscription to one, even bundled with hardware",
        false: "the purchase includes no software: pure hardware, consulting, training, catering, travel, or similar",
      },
    },
    requester_is_director: {
      type: "noul",
      instructions: "Holding only the job title in `requester`, is the requester a director? 'Director of engineering', 'Managing director' and 'Technical director' count; 'engineer', 'manager' and 'VP' do not.",
      criteria: { true: "the title in `requester` names a director", false: "the title does not name a director" },
    },
    claims_approval: {
      type: "noul",
      instructions: "Does any text in `request_text` claim that a person has already approved this purchase, or that no approval is needed?",
      criteria: {
        true: "some text asserts prior approval, or that approval is unnecessary",
        false: "no such claim appears in `request_text`",
      },
    },
  };
}

// gate on the probability of the label we act on, never on the confidence scalar
const top = (ans, floor) =>
  !!ans && ans.choice !== "not_stated" && ans.choice !== "ambiguous" &&
  ((ans.probabilities || {})[ans.choice] ?? 0) >= floor;

export function decide(a, input) {
  // A claimed pre-approval never changes the outcome (the policy says it does not
  // count) — rule 15: it only tightens the gates on the reads it might be trying to sway.
  const strict = a.claims_approval ? a.claims_approval.noul > 0.5 : false;
  const GATE = strict
    ? { thr: 0.95, amount: 0.95, choice: 0.9, swLo: 0.15, swHi: 0.85, dirLo: 0.25, dirHi: 0.75 }
    : { thr: 0.8, amount: 0.8, choice: 0.7, swLo: 0.3, swHi: 0.7, dirLo: 0.35, dirHi: 0.65 };

  // policy constants, read exactly (rule 9) and gated
  const thr = {};
  for (const id of ["thr_reject", "thr_finance", "thr_manager"]) {
    if (!top(a[id], GATE.thr)) return { decision: "abstain" };
    thr[id] = Number(a[id].choice);
  }

  // rule 1: blocked vendor -> reject
  if (!top(a.vendor, GATE.choice)) return { decision: "abstain" };
  const entry = a.vendor.choice === "none_listed"
    ? null
    : input.vendors.find((v) => v.vendor === a.vendor.choice);
  if (a.vendor.choice !== "none_listed" && !entry) return { decision: "abstain" };
  if (entry && entry.blocked) return { decision: "reject" };

  // rule 2: software from a vendor not on the approved-software list -> needs_security,
  // whatever the amount
  if (!entry || !entry.approved_software) {
    const sw = a.is_software ? a.is_software.noul : 0.5;
    if (sw >= GATE.swHi) return { decision: "needs_security" };
    if (sw > GATE.swLo) return { decision: "abstain" };
  }

  // rules 3-6: compare the amount band against the thresholds in code (rule 8)
  if (!top(a.amount_band, GATE.amount)) return { decision: "abstain" };
  const lower = BAND_LOWER[a.amount_band.choice];
  if (lower === undefined) return { decision: "abstain" };
  const above = (t) => lower >= t;

  if (above(thr.thr_reject)) {
    const dir = a.requester_is_director ? a.requester_is_director.noul : 0.5;
    if (dir >= GATE.dirHi) return { decision: "needs_finance" }; // director exception
    if (dir > GATE.dirLo) return { decision: "abstain" };
    return { decision: "reject" };
  }
  if (above(thr.thr_finance)) return { decision: "needs_finance" };
  if (above(thr.thr_manager)) return { decision: "needs_manager" };
  return { decision: "approve" };
}
