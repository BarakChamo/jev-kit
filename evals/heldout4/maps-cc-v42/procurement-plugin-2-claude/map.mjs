// Purchase-request triage against a written approval policy.
//
// Amounts and currency are read out of request_text with plain regex (Jev has no
// free-number answer type, so extraction has to happen in code). Vendor identity
// (fuzzy, aliases included) and "is this a software purchase" are judgment calls,
// so those go to Jev. The numbered policy clauses are parsed generically (by
// keyword) so the map keeps working if thresholds change between cases, applying
// them in the order they appear, first match wins, exactly as the policy states.

const VENDOR_CONFIDENCE_GATE = 0.55;
const SOFTWARE_TRUE_GATE = 0.6;
const SOFTWARE_FALSE_GATE = 0.4;

function parsePolicyRules(policyText) {
  const text = policyText || '';
  const chunks = text.split(/\n(?=\s*\d+\.\s)/).map((s) => s.trim()).filter(Boolean);
  const rules = [];

  for (const chunk of chunks) {
    if (!/^\d+\.\s/.test(chunk)) continue; // preamble, not a decision rule
    const body = chunk.replace(/^\d+\.\s*/, '');
    const lower = body.toLowerCase();

    if (lower.includes('blocked')) {
      rules.push({ type: 'blocked_reject' });
      continue;
    }
    if (lower.includes('software') && lower.includes('security')) {
      rules.push({ type: 'software_security' });
      continue;
    }

    const thresholdMatch = body.match(
      /(?:above|over|exceed(?:s|ing)?|greater than|more than)\s*\$?\s*([\d,]+(?:\.\d+)?)/i
    );
    const threshold = thresholdMatch ? parseFloat(thresholdMatch[1].replace(/,/g, '')) : null;

    if (lower.includes('director')) {
      rules.push({ type: 'threshold_reject_director', threshold });
      continue;
    }
    if (lower.includes('reject')) {
      rules.push({ type: 'threshold_reject', threshold });
      continue;
    }
    if (lower.includes('finance')) {
      rules.push({ type: 'threshold_finance', threshold });
      continue;
    }
    if (lower.includes('manager')) {
      rules.push({ type: 'threshold_manager', threshold });
      continue;
    }
    if (lower.includes('anything else') || lower.includes('approved') || lower.includes('otherwise')) {
      rules.push({ type: 'default_approve' });
      continue;
    }
    if (lower.startsWith('apply the rules')) continue; // meta instruction

    rules.push({ type: 'unknown' });
  }

  return rules;
}

function findAmounts(text, rates) {
  const symbolToCode = { $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' };
  const numberPart = '([\\d,]+(?:\\.\\d+)?)';
  const matches = [];

  for (const [sym, code] of Object.entries(symbolToCode)) {
    if (!(code in rates)) continue;
    const escSym = sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const re of [
      new RegExp(escSym + '\\s?' + numberPart, 'g'),
      new RegExp(numberPart + '\\s?' + escSym, 'g'),
    ]) {
      let m;
      while ((m = re.exec(text))) {
        matches.push({ code, amount: parseFloat(m[1].replace(/,/g, '')), index: m.index });
      }
    }
  }

  for (const code of Object.keys(rates)) {
    const escCode = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const re of [
      new RegExp('\\b' + escCode + '\\b\\s?' + numberPart, 'gi'),
      new RegExp(numberPart + '\\s?\\b' + escCode + '\\b', 'gi'),
    ]) {
      let m;
      while ((m = re.exec(text))) {
        matches.push({ code, amount: parseFloat(m[1].replace(/,/g, '')), index: m.index });
      }
    }
  }

  return matches;
}

function pickAmount(text, rates) {
  const matches = findAmounts(text, rates);

  if (matches.length === 0) {
    const m = text.match(
      /(?:total|cost|price|amount|worth|budget|value|invoice|quote|for)\D{0,10}?([\d,]{2,}(?:\.\d+)?)/i
    );
    return m ? { amount: parseFloat(m[1].replace(/,/g, '')), currency: 'USD' } : null;
  }
  if (matches.length === 1) return { amount: matches[0].amount, currency: matches[0].code };

  const keywordPositions = [];
  const keywordRe = /(total|cost|price|amount|worth|budget|value|invoice|quote)/gi;
  let km;
  while ((km = keywordRe.exec(text))) keywordPositions.push(km.index);

  if (keywordPositions.length > 0) {
    let best = null;
    let bestDist = Infinity;
    for (const mm of matches) {
      const dist = Math.min(...keywordPositions.map((k) => Math.abs(k - mm.index)));
      if (dist < bestDist) {
        bestDist = dist;
        best = mm;
      }
    }
    if (best) return { amount: best.amount, currency: best.code };
  }

  const last = [...matches].sort((a, b) => a.index - b.index).pop();
  return { amount: last.amount, currency: last.code };
}

export function buildState(input) {
  return {
    request_text: input.request_text,
    requester: input.requester,
    vendors: input.vendors.map((v) => ({ vendor: v.vendor, also_known_as: v.also_known_as || [] })),
  };
}

export function questions(input) {
  const vendorCriteria = {};
  for (const v of input.vendors) {
    const names = [v.vendor, ...(v.also_known_as || [])].join(', ');
    vendorCriteria[v.vendor] = `the purchase is from this vendor, referenced by name or alias: ${names}`;
  }
  vendorCriteria.unclear = 'no vendor in the `vendors` list is clearly referenced in `request_text`';

  return {
    vendorMatch: {
      type: 'choice',
      instructions:
        "Which vendor in `vendors` (matching by its `vendor` name or any of its `also_known_as` aliases) is the purchase in `request_text` being made from right now?",
      criteria: vendorCriteria,
    },
    softwarePurchase: {
      type: 'noul',
      instructions:
        'Does `request_text` describe a purchase of software: a software subscription, license, SaaS service, or app, as opposed to hardware, physical goods, professional or consulting services, or other non-software purchases?',
      criteria: {
        true: 'the purchase is of software, a software subscription, license, or SaaS service',
        false: 'the purchase is not software: hardware, physical goods, services, or something else',
      },
    },
  };
}

export function decide(answers, input) {
  const rules = parsePolicyRules(input.policy_text);
  const rates = input.rates;

  const vendorAns = answers.vendorMatch;
  const vendorChoice = vendorAns ? vendorAns.choice : null;
  const vendorIsSpecific = vendorChoice && vendorChoice !== 'unclear';
  const vendorConfident = !vendorIsSpecific || (vendorAns.confidence ?? 0) >= VENDOR_CONFIDENCE_GATE;
  const vendorRecord = vendorIsSpecific
    ? input.vendors.find((v) => v.vendor === vendorChoice) || null
    : null;

  const softwareProb = answers.softwarePurchase ? answers.softwarePurchase.noul : 0.5;
  const isSoftware = softwareProb >= SOFTWARE_TRUE_GATE;
  const isNotSoftware = softwareProb <= SOFTWARE_FALSE_GATE;

  const isDirector = /\bdirector\b/i.test(input.requester?.title || '');
  const priced = pickAmount(input.request_text, rates);
  const usdAmount = priced ? priced.amount * (rates[priced.currency] ?? NaN) : null;

  for (const rule of rules) {
    switch (rule.type) {
      case 'blocked_reject':
        if (!vendorConfident) return { decision: 'abstain' };
        if (vendorRecord && vendorRecord.blocked) return { decision: 'reject' };
        continue;

      case 'software_security':
        if (!vendorConfident) return { decision: 'abstain' };
        if (isSoftware) {
          const approved = vendorRecord ? vendorRecord.approved_software : false;
          if (!approved) return { decision: 'needs_security' };
        } else if (!isNotSoftware) {
          return { decision: 'abstain' };
        }
        continue;

      case 'threshold_reject_director':
        if (usdAmount == null || Number.isNaN(usdAmount) || rule.threshold == null) {
          return { decision: 'abstain' };
        }
        if (usdAmount > rule.threshold) {
          return { decision: isDirector ? 'needs_finance' : 'reject' };
        }
        continue;

      case 'threshold_reject':
        if (usdAmount == null || Number.isNaN(usdAmount) || rule.threshold == null) {
          return { decision: 'abstain' };
        }
        if (usdAmount > rule.threshold) return { decision: 'reject' };
        continue;

      case 'threshold_finance':
        if (usdAmount == null || Number.isNaN(usdAmount) || rule.threshold == null) {
          return { decision: 'abstain' };
        }
        if (usdAmount > rule.threshold) return { decision: 'needs_finance' };
        continue;

      case 'threshold_manager':
        if (usdAmount == null || Number.isNaN(usdAmount) || rule.threshold == null) {
          return { decision: 'abstain' };
        }
        if (usdAmount > rule.threshold) return { decision: 'needs_manager' };
        continue;

      case 'default_approve':
        return { decision: 'approve' };

      default:
        return { decision: 'abstain' };
    }
  }

  return { decision: 'abstain' };
}
