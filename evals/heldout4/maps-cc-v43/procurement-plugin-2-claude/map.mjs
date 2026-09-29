// Purchase-request triage against a written approval policy.
// Vendor blocked/approved-software flags, the amount, and the policy's own
// thresholds are all explicit data given in the case — they are parsed or
// looked up in code (rule 12), never asked as a judgment. Jev is used only
// for the two facts that genuinely require reading free text: which vendor
// is meant, and whether the purchase is software. A role-match question is
// added only when the policy's exception clause names a role.

function extractOutcome(text) {
  const t = text.toLowerCase();
  if (/security/.test(t)) return "needs_security";
  if (/finance/.test(t)) return "needs_finance";
  if (/manager/.test(t)) return "needs_manager";
  if (/reject|denied|deny/.test(t)) return "reject";
  if (/approve/.test(t)) return "approve";
  return null;
}

function extractThreshold(text) {
  const m = text.match(
    /(above|over|exceed[s]?|more than|greater than|at least|in excess of)\s+\$?([\d,]+(?:\.\d+)?)/i
  );
  if (!m) return null;
  const operator = /at least|minimum/i.test(m[1]) ? ">=" : ">";
  return { threshold: parseFloat(m[2].replace(/,/g, "")), operator };
}

function compareAmount(amount, threshold, operator) {
  return operator === ">=" ? amount >= threshold : amount > threshold;
}

function parsePolicy(policyText) {
  const lines = (policyText || "")
    .split(/\n/)
    .map((l) => l.replace(/^\s*\d+\.\s*/, "").trim())
    .filter(
      (l) =>
        l.length > 0 &&
        !/^apply the rules/i.test(l) &&
        !/^purchase approval policy/i.test(l)
    );

  const rules = [];
  for (const sentence of lines) {
    const lower = sentence.toLowerCase();

    if (/blocked/.test(lower)) {
      rules.push({ type: "vendor_blocked", outcome: extractOutcome(sentence) || "reject" });
      continue;
    }

    if (/software/.test(lower) && /security/.test(lower)) {
      rules.push({ type: "software_security", outcome: extractOutcome(sentence) || "needs_security" });
      continue;
    }

    const exceptionSplit = sentence.split(/,?\s*(?:unless|except when|except if|except that)\s+/i);
    if (exceptionSplit.length === 2) {
      const [primaryPart, exceptionPart] = exceptionSplit;
      const th = extractThreshold(primaryPart);
      if (th) {
        const roleMatch = exceptionPart.match(
          /requester (?:is|holds the title of|has the role of)\s*(?:an?|the)?\s*([a-z][a-z\- ]*?)(?:,|\bin which case\b|$)/i
        );
        rules.push({
          type: "threshold_with_exception",
          threshold: th.threshold,
          operator: th.operator,
          primaryOutcome: extractOutcome(primaryPart),
          role: roleMatch ? roleMatch[1].trim() : null,
          exceptionOutcome: extractOutcome(exceptionPart),
        });
        continue;
      }
    }

    const th = extractThreshold(sentence);
    if (th) {
      rules.push({ type: "threshold_plain", threshold: th.threshold, operator: th.operator, outcome: extractOutcome(sentence) });
      continue;
    }

    if (/anything else|otherwise/i.test(lower)) {
      rules.push({ type: "catchall", outcome: extractOutcome(sentence) || "approve" });
      continue;
    }

    rules.push({ type: "unknown", raw: sentence });
  }
  return rules;
}

function parseAmount(text, rates) {
  const codes = Object.keys(rates || {});
  if (codes.length === 0) return null;
  const symbolMap = { "$": "USD", "£": "GBP", "€": "EUR", "¥": "JPY" };
  const symbols = Object.entries(symbolMap).filter(([, code]) => codes.includes(code));

  const candidates = [];

  if (symbols.length > 0) {
    const symPattern = symbols.map(([s]) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const re = new RegExp(`(${symPattern})\\s?([\\d,]+(?:\\.\\d+)?)`, "g");
    let m;
    while ((m = re.exec(text))) {
      candidates.push({ value: parseFloat(m[2].replace(/,/g, "")), currency: symbolMap[m[1]], index: m.index });
    }
  }

  const codeAlt = codes.join("|");
  const reCodeThenNum = new RegExp(`\\b(${codeAlt})\\b\\s?([\\d,]+(?:\\.\\d+)?)`, "gi");
  let m;
  while ((m = reCodeThenNum.exec(text))) {
    candidates.push({ value: parseFloat(m[2].replace(/,/g, "")), currency: m[1].toUpperCase(), index: m.index });
  }
  const reNumThenCode = new RegExp(`([\\d,]+(?:\\.\\d+)?)\\s?(${codeAlt})\\b`, "gi");
  while ((m = reNumThenCode.exec(text))) {
    candidates.push({ value: parseFloat(m[1].replace(/,/g, "")), currency: m[2].toUpperCase(), index: m.index });
  }

  if (candidates.length === 0) return null;

  const unique = [];
  for (const c of candidates) {
    if (!unique.some((u) => Math.abs(u.index - c.index) < 3 && u.value === c.value && u.currency === c.currency)) {
      unique.push(c);
    }
  }

  if (unique.length === 1) return unique[0];

  const distinct = new Set(unique.map((c) => `${c.value}|${c.currency}`));
  if (distinct.size === 1) return unique[0];

  const nearTotal = unique.filter((c) => /total/i.test(text.slice(Math.max(0, c.index - 25), c.index + 25)));
  if (nearTotal.length === 1) return nearTotal[0];

  return { ambiguous: true };
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
  const vendors = input.vendors || [];
  const vendorCriteria = {};
  for (const v of vendors) {
    const aliases = (v.also_known_as || []).join(", ");
    vendorCriteria[v.vendor] = aliases
      ? `The request is buying from this vendor, named "${v.vendor}", possibly referred to by an alias such as ${aliases}.`
      : `The request is buying from this vendor, named "${v.vendor}".`;
  }
  vendorCriteria.none = "No vendor in the list is clearly the one being purchased from, or it cannot be determined which one.";

  const q = {
    vendor_match: {
      type: "choice",
      instructions:
        "Which vendor, if any, is the purchase described in `request_text` being made from? Match the vendor named in the request against the vendor list in `vendors`, including any alias listed for that vendor.",
      criteria: vendorCriteria,
    },
    is_software: {
      type: "noul",
      instructions:
        "Does the purchase described in `request_text` involve software — a software license, a SaaS or cloud subscription, or another digital software product or service — rather than only hardware, physical goods, or a non-software service?",
      criteria: {
        true: "The purchase is of software or a software-based service.",
        false: "The purchase is not of software (e.g. hardware, physical goods, or a non-software service).",
      },
    },
  };

  const rules = parsePolicy(input.policy_text);
  const roleRule = rules.find((r) => r.type === "threshold_with_exception" && r.role);
  if (roleRule) {
    q.role_exception_match = {
      type: "noul",
      instructions: `Does the title given in \`requester.title\` indicate that the requester holds the role or seniority of "${roleRule.role}" — a title that clearly signifies that role or an equivalent/more senior one?`,
      criteria: {
        true: `\`requester.title\` clearly signifies the role of "${roleRule.role}" or a more senior equivalent.`,
        false: `\`requester.title\` does not indicate the role of "${roleRule.role}".`,
      },
    };
  }
  return q;
}

export function decide(answers, input) {
  const rules = parsePolicy(input.policy_text);
  if (rules.length === 0 || rules.some((r) => r.type === "unknown")) {
    return { decision: "abstain" };
  }

  const vendorAns = answers.vendor_match;
  if (!vendorAns || vendorAns.choice === "none" || (vendorAns.confidence ?? 0) < 0.55) {
    return { decision: "abstain" };
  }
  const vendor = (input.vendors || []).find((v) => v.vendor === vendorAns.choice);
  if (!vendor) return { decision: "abstain" };

  const softwareAns = answers.is_software;
  const softwareNoul = softwareAns ? softwareAns.noul : undefined;
  if (softwareNoul === undefined || softwareNoul === null) return { decision: "abstain" };
  const softwareMatters = vendor.approved_software !== true;
  if (softwareMatters && softwareNoul > 0.35 && softwareNoul < 0.65) {
    return { decision: "abstain" };
  }
  const isSoftware = softwareNoul >= 0.5;

  // Parsed lazily: a blocked vendor or a software-security case decides
  // without needing the amount, so an unparseable amount should not force
  // an abstain on cases where it was never actually needed.
  let amountUSD;
  let amountResolved = false;
  function resolveAmountUSD() {
    if (amountResolved) return amountUSD;
    amountResolved = true;
    const amount = parseAmount(input.request_text || "", input.rates || {});
    if (!amount || amount.ambiguous || !(input.rates && input.rates[amount.currency] != null)) {
      amountUSD = null;
    } else {
      amountUSD = amount.value * input.rates[amount.currency];
    }
    return amountUSD;
  }

  for (const rule of rules) {
    if (rule.type === "vendor_blocked") {
      if (vendor.blocked === true) return { decision: rule.outcome };
    } else if (rule.type === "software_security") {
      if (isSoftware && vendor.approved_software !== true) return { decision: rule.outcome };
    } else if (rule.type === "threshold_with_exception" || rule.type === "threshold_plain") {
      const usd = resolveAmountUSD();
      if (usd === null) return { decision: "abstain" };
      if (!compareAmount(usd, rule.threshold, rule.operator)) continue;
      if (rule.type === "threshold_plain" || !rule.role) {
        return { decision: rule.type === "threshold_plain" ? rule.outcome : rule.primaryOutcome };
      }
      const roleAns = answers.role_exception_match;
      const roleNoul = roleAns ? roleAns.noul : undefined;
      if (roleNoul === undefined || roleNoul === null) return { decision: "abstain" };
      if (roleNoul > 0.35 && roleNoul < 0.65) return { decision: "abstain" };
      return { decision: roleNoul >= 0.5 ? rule.exceptionOutcome : rule.primaryOutcome };
    } else if (rule.type === "catchall") {
      return { decision: rule.outcome };
    }
  }

  return { decision: "abstain" };
}
