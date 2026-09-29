// Purchase-request triage for the fixed policy described in the task:
//   1. blocked vendor -> reject
//   2. software purchase from a vendor not on the approved-software list -> needs_security
//   3. amount > 50,000 USD -> reject, unless requester is a director -> needs_finance
//   4. amount > 10,000 USD -> needs_finance
//   5. amount > 1,000 USD -> needs_manager
//   6. otherwise -> approve
// Rules are pinned in code (never asked of Jev); Jev only answers case facts.
// A request's own claim that it was "already approved" is never read by decide().

const CURRENCY_SYMBOLS = { "$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY" };

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Extracts the single stated amount + currency from free text, using only
// currencies present in `rates`. Returns null when no unambiguous match is
// found (arithmetic and parsing stay in code; ambiguity becomes "abstain").
function parseAmount(text, rates) {
  const codes = Object.keys(rates);
  const symbolIndicators = Object.keys(CURRENCY_SYMBOLS).filter((s) => codes.includes(CURRENCY_SYMBOLS[s]));
  const indicators = [...symbolIndicators.map(escapeRe), ...codes.map(escapeRe)];
  if (indicators.length === 0) return null;
  const alt = indicators.join("|");
  const numRe = "([0-9][0-9,]*(?:\\.[0-9]+)?)\\s?(k|K|m|M)?";

  const pre = new RegExp(`(${alt})\\s?${numRe}`, "gi");
  const post = new RegExp(`${numRe}\\s?(${alt})`, "gi");

  function toCode(indicator) {
    const sym = CURRENCY_SYMBOLS[indicator];
    if (sym) return sym;
    const up = indicator.toUpperCase();
    return codes.find((c) => c.toUpperCase() === up) || null;
  }

  function toValue(numStr, mult) {
    let v = parseFloat(numStr.replace(/,/g, ""));
    if (mult) {
      const m = mult.toLowerCase();
      if (m === "k") v *= 1000;
      if (m === "m") v *= 1000000;
    }
    return v;
  }

  const found = [];
  let m;
  while ((m = pre.exec(text)) !== null) {
    const code = toCode(m[1]);
    if (code) found.push({ value: toValue(m[2], m[3]), currency: code, index: m.index });
  }
  while ((m = post.exec(text)) !== null) {
    const code = toCode(m[3]);
    if (code) found.push({ value: toValue(m[1], m[2]), currency: code, index: m.index });
  }
  if (found.length === 0) return null;

  const distinct = [];
  for (const f of found) {
    if (!distinct.some((d) => d.value === f.value && d.currency === f.currency)) distinct.push(f);
  }
  if (distinct.length === 1) return distinct[0];

  // Several different amounts are stated (e.g. a per-unit rate plus a total).
  // If exactly one is next to the word "total", that is the one the policy means.
  const totalRe = /\btotal(?:s|ed|ing)?\b/i;
  const near = distinct.filter((d) => totalRe.test(text.slice(Math.max(0, d.index - 20), d.index + 20)));
  if (near.length === 1) return near[0];
  return null;
}

export function buildState(input) {
  return {
    request_text: input.request_text,
    requester: input.requester,
    vendors: input.vendors,
  };
}

export function questions(input) {
  const vendorCriteria = {};
  for (const v of input.vendors) {
    const aliases = (v.also_known_as || []).join(", ");
    vendorCriteria[v.vendor] = aliases
      ? `\`request_text\` names this vendor, calling it "${v.vendor}" or by an alias such as ${aliases}`
      : `\`request_text\` names this vendor, calling it "${v.vendor}"`;
  }
  vendorCriteria["other_vendor"] = "`request_text` clearly names a specific vendor/company to buy from, but it is none of the vendors listed above";
  vendorCriteria["unclear"] = "`request_text` does not clearly identify which single vendor the purchase is from";

  return {
    vendor: {
      type: "choice",
      instructions: "Which vendor in `vendors` does `request_text` name as the seller for this purchase? Match by the vendor's name or any of its also_known_as aliases.",
      criteria: vendorCriteria,
    },
    is_software: {
      type: "noul",
      instructions: "Does `request_text` describe buying software: a software product, subscription, SaaS service, or software license?",
      criteria: {
        true: "the purchase is software, a software subscription/SaaS, or a software license",
        false: "the purchase is physical hardware, professional/consulting services, or some other non-software good or service",
      },
    },
    is_director: {
      type: "noul",
      instructions: "Does `requester.title` show a director-level title, such as 'Director', 'Senior Director', or 'Director of X'?",
      criteria: {
        true: "the title is 'Director' or an equivalent director-level rank",
        false: "the title is something else, e.g. engineer, manager, VP, or a C-level title (CEO, CFO, etc.)",
      },
    },
  };
}

function gate(p, lowHigh = [0.35, 0.65]) {
  if (p >= lowHigh[1]) return true;
  if (p <= lowHigh[0]) return false;
  return null; // ambiguous
}

export function decide(answers, input) {
  const amt = parseAmount(input.request_text, input.rates);
  if (!amt) return { decision: "abstain" };
  const amountUsd = amt.value * input.rates[amt.currency];

  const vendorAns = answers.vendor;
  if (!vendorAns || vendorAns.confidence < 0.6) return { decision: "abstain" };

  let vendorInfo;
  if (vendorAns.choice === "unclear") {
    return { decision: "abstain" };
  } else if (vendorAns.choice === "other_vendor") {
    vendorInfo = { blocked: false, approved_software: false };
  } else {
    vendorInfo = input.vendors.find((v) => v.vendor === vendorAns.choice);
    if (!vendorInfo) return { decision: "abstain" };
  }

  if (vendorInfo.blocked) return { decision: "reject" };

  if (!vendorInfo.approved_software) {
    const isSoftware = gate(answers.is_software.noul);
    if (isSoftware === null) return { decision: "abstain" };
    if (isSoftware) return { decision: "needs_security" };
  }

  if (amountUsd > 50000) {
    const isDirector = gate(answers.is_director.noul);
    if (isDirector === null) return { decision: "abstain" };
    return { decision: isDirector ? "needs_finance" : "reject" };
  }
  if (amountUsd > 10000) return { decision: "needs_finance" };
  if (amountUsd > 1000) return { decision: "needs_manager" };
  return { decision: "approve" };
}
