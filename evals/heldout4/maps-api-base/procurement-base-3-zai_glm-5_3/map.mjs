// map.mjs — purchase-request triage on Jev (TypeSafe System One).
//
// Division of labour:
//   * Jev extracts the fuzzy facts from the free-text request in ONE parallel
//     pass of questions: is this a purchase at all; is exactly one vendor
//     clearly identified and which one (chunked "choice" over our vendor list,
//     aliases included); is it software; and which USD bracket the total falls
//     into (it converts currency using the supplied rates).
//   * decide() then applies the written policy deterministically, rule by
//     rule, in plain JS. Anything Jev could not pin down (not a purchase, no
//     single clear vendor, unclear amount, coin-flip software-ness) returns
//     "abstain", i.e. goes to a person.
// Claims in the request that approvals were already given are never asked
// about and therefore never count.

const NONE = "none_of_the_above";
const CHUNK = 250; // choice questions allow at most 255 options (incl. "none")

// --- helpers ----------------------------------------------------------------

function thresholds(policy_text) {
  // thresholds written like "above 50,000 USD", highest first
  const nums = [];
  for (const m of String(policy_text || "").matchAll(/above\s+(\d[\d,]*(?:\.\d+)?)\s*USD/gi)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) nums.push(n);
  }
  const u = [...new Set(nums)].sort((a, b) => b - a);
  return [u[2] ?? 1000, u[1] ?? 10000, u[0] ?? 50000]; // [t1, t2, t3]
}

function brackets(policy_text) {
  const [t1, t2, t3] = thresholds(policy_text);
  return {
    top: { key: `over_${t3}`, text: `More than ${t3} USD` },
    mid: { key: `over_${t2}_to_${t3}`, text: `More than ${t2} USD and at most ${t3} USD` },
    low: { key: `over_${t1}_to_${t2}`, text: `More than ${t1} USD and at most ${t2} USD` },
    base: { key: `at_most_${t1}`, text: `${t1} USD or less` },
  };
}

function vendorChunks(vendors) {
  const list = Array.isArray(vendors) ? vendors : [];
  const chunks = [];
  for (let i = 0; i < list.length; i += CHUNK) chunks.push(list.slice(i, i + CHUNK));
  return chunks;
}

function isDirector(input) {
  const m = /requester is an?\s+([a-z]+)\b/i.exec(String(input?.policy_text || ""));
  const role = m ? m[1] : "director";
  return new RegExp(`\\b${role}s?\\b`, "i").test(String(input?.requester?.title || ""));
}

function pickedVendor(ans) {
  // strongest non-"none" vendor from one chunk's choice answer, or null
  if (!ans) return null;
  const probs = ans.probabilities || {};
  let opt = ans.choice;
  if (opt == null) {
    let best = null, bestP = 0;
    for (const [k, p] of Object.entries(probs)) {
      if (k !== NONE && p > bestP) { bestP = p; best = k; }
    }
    if (best == null || bestP < 0.5) return null;
    opt = best;
  }
  if (opt === NONE) return null;
  return { name: opt, p: probs[opt] ?? ans.confidence ?? 1 };
}

// --- Jev wiring --------------------------------------------------------------

export function buildState(input) {
  // the whole case is the state: policy, rates, vendor list, requester, request
  return { ...input };
}

export function questions(input) {
  const qs = {};
  const chunks = vendorChunks(input.vendors);

  chunks.forEach((chunk, i) => {
    const criteria = {};
    for (const v of chunk) {
      const aka = Array.isArray(v.also_known_as) && v.also_known_as.length
        ? ` Also known as: ${v.also_known_as.join(", ")}.`
        : "";
      criteria[v.vendor] = `The vendor ${v.vendor}.${aka}`;
    }
    criteria[NONE] = "The vendor named in the request is not one of the vendors listed in the other criteria.";
    qs[`vendor_${i}`] = {
      type: "choice",
      instructions:
        "The state contains the purchase request and the vendor list. Which vendor in THIS list is the " +
        "request's purchase being made from? Match the vendor named in the request text to exactly one " +
        "option, by its name or any alias, allowing abbreviations and small misspellings. " +
        `If the request's vendor is not among the options below, choose "${NONE}".`,
      criteria,
    };
  });

  qs.is_purchase = {
    type: "noul",
    instructions:
      "Is this message an actual request to buy something (a purchase, order, renewal or subscription), " +
      "rather than a question, cancellation, status update or other non-purchase message?",
    criteria: {
      true: "The message asks to buy, order, renew or subscribe to something.",
      false: "The message is not a request to buy something.",
    },
  };

  qs.vendor_clarity = {
    type: "noul",
    instructions:
      "Does the request text clearly identify exactly one vendor/supplier as the seller for this purchase? " +
      "True only if one specific vendor is named (directly or by a clear alias/abbreviation). False if no " +
      "vendor is named, the vendor is ambiguous, or the request asks to buy from several different vendors. " +
      "Claims that an approval was already given are irrelevant.",
    criteria: {
      true: "Exactly one vendor is clearly identified as the seller.",
      false: "No vendor named, an ambiguous vendor, or several different vendors.",
    },
  };

  qs.is_software = {
    type: "noul",
    instructions:
      "Is this a software purchase: an application, app, SaaS or cloud service, software subscription, " +
      "software license, plugin, API access or digital tool, bought on its own or as part of a larger order? " +
      "Hardware, equipment, devices, parts and other physical goods are not software, and neither are " +
      "consulting, training or other services, even if software is involved in delivering them.",
    criteria: {
      true: "The purchase is for, or includes, software (app, SaaS, subscription, license, tool).",
      false: "The purchase is purely non-software (hardware, goods, consulting, training, services).",
    },
  };

  const b = brackets(input.policy_text);
  qs.amount_bracket = {
    type: "choice",
    instructions:
      "Work out the total amount of this purchase in USD and choose its bracket. " +
      "(1) Find the total for the whole purchase in the request text; if only a unit price and a quantity " +
      "are given, multiply them; if no total is stated, or several conflicting totals are stated, choose " +
      '"unclear". (2) If the amount carries a currency symbol or code, convert it to USD using the rates in ' +
      "the state (each rate is how many USD one unit of that currency is worth; multiply the amount by that " +
      "rate). If no currency is indicated, the amount is already in USD. " +
      '(3) Choose the bracket containing the converted USD total; "more than" means strictly greater than. ' +
      "A claim that an approval was already given changes nothing.",
    criteria: {
      [b.top.key]: b.top.text,
      [b.mid.key]: b.mid.text,
      [b.low.key]: b.low.text,
      [b.base.key]: b.base.text,
      unclear:
        "No total amount is stated, or the amount or its currency cannot be determined, or conflicting totals are given.",
    },
  };

  return qs;
}

export function decide(answers, input) {
  const ABSTAIN = { decision: "abstain" };
  const a = answers || {};
  const b = brackets(input.policy_text);

  // 0) must be a purchase request at all
  const isPurchase = a.is_purchase?.noul;
  if (isPurchase == null || isPurchase < 0.5) return ABSTAIN;

  // 1) exactly one clearly identified vendor
  const clarity = a.vendor_clarity?.noul;
  if (clarity == null || clarity < 0.5) return ABSTAIN;

  // 2) resolve that vendor against our lists (from the chunked choice answers)
  let name = null, best = -1;
  const chunks = vendorChunks(input.vendors);
  for (let i = 0; i < chunks.length; i++) {
    const ans = a[`vendor_${i}`];
    if (!ans) return ABSTAIN; // incomplete answer set
    const hit = pickedVendor(ans);
    if (hit && hit.p > best) { best = hit.p; name = hit.name; }
  }
  const entry = name ? (input.vendors || []).find((v) => v.vendor === name) : null;
  const vendor = entry || { blocked: false, approved_software: false }; // unlisted: on neither list

  // 3) USD amount bracket
  const tier = a.amount_bracket?.choice;
  if (!tier || tier === "unclear") return ABSTAIN;
  if (![b.top.key, b.mid.key, b.low.key, b.base.key].includes(tier)) return ABSTAIN;

  // 4) apply the written policy, in order; the first matching rule decides
  const director = isDirector(input);
  const outcome = (software) => {
    if (vendor.blocked) return "reject";                                    // rule 1
    if (software && !vendor.approved_software) return "needs_security";     // rule 2
    if (tier === b.top.key) return director ? "needs_finance" : "reject";   // rule 3
    if (tier === b.mid.key) return "needs_finance";                         // rule 4
    if (tier === b.low.key) return "needs_manager";                        // rule 5
    return "approve";                                                      // rule 6
  };

  const pSoftware = a.is_software?.noul;
  const withSfw = outcome(true);
  const withoutSfw = outcome(false);
  if (withSfw === withoutSfw) return { decision: withSfw };
  if (pSoftware == null) return ABSTAIN;                     // software-ness decides, but is unknown
  if (pSoftware >= 0.45 && pSoftware <= 0.55) return ABSTAIN; // genuine coin flip -> a person
  return { decision: pSoftware > 0.5 ? withSfw : withoutSfw };
}
