// Purchase-request triage against a written approval policy, vendor list and currency rates.
//
// Design: amount/currency extraction and policy-threshold parsing are deterministic (regex) —
// Jev has no "extract this number/date" question type, so those must be read in code (rule 9).
// Jev is used only for the three genuinely judgment-shaped facts: which vendor the free text
// names (a pick-one-of-many `choice`, rule 10), whether the purchase is software/SaaS (`noul`),
// and whether the requester's title denotes director rank (`noul`). The decision itself — which
// policy clause fires first — is computed in code from those facts plus the parsed policy (rule 12).

const AMBIG_LOW = 0.4;
const AMBIG_HIGH = 0.6;
const VENDOR_CONF_MIN = 0.7;

export function buildState(input) {
  return {
    request_text: input.request_text,
    requester: input.requester,
    vendor_directory: (input.vendors || []).map((v) => ({
      name: v.vendor,
      aliases: v.also_known_as || [],
    })),
  };
}

export function questions(input) {
  const vendors = input.vendors || [];
  const criteria = {};
  for (const v of vendors) {
    const aliases = v.also_known_as && v.also_known_as.length ? v.also_known_as.join(', ') : 'none';
    criteria[v.vendor] = `The request refers to this vendor. Also known as: ${aliases}.`;
  }
  criteria['unclear'] = 'No vendor in `vendor_directory` is clearly identified in `request_text`.';

  return {
    vendor_match: {
      type: 'choice',
      instructions:
        "Which vendor in `vendor_directory` does `request_text` refer to, matching by exact name or any listed alias, allowing for minor typos, abbreviations or partial names? Choose \"unclear\" only if no vendor in the list is clearly identified.",
      criteria,
    },
    is_software_purchase: {
      type: 'noul',
      instructions:
        'Does the purchase described in `request_text` acquire software, a SaaS subscription, a software license, or a similar digital/software product or service (as opposed to physical goods, hardware, or a non-software service)?',
      criteria: {
        true: 'the purchase is software, SaaS, or a software license/subscription',
        false: 'the purchase is hardware, physical goods, or a non-software service',
      },
    },
    is_director: {
      type: 'noul',
      instructions:
        "Does the title given in `requester.title` currently denote the rank of director (for example \"Director\", \"Director of Engineering\", \"Senior Director\"), as distinct from a more junior title (engineer, manager, associate, analyst) or a different senior title that is not specifically \"director\" (VP, CXO, president)?",
      criteria: {
        true: 'the title denotes director rank',
        false: 'the title does not denote director rank',
      },
    },
  };
}

export function decide(answers, input) {
  const rates = input.rates || {};
  const amt = extractAmount(input.request_text, rates);
  if (!amt) return { decision: 'abstain' };

  const rate = rates[amt.currency];
  if (typeof rate !== 'number') return { decision: 'abstain' };
  const usdAmount = amt.amount * rate;

  const vendors = input.vendors || [];
  const vendorAns = answers.vendor_match;
  let vendorRecord = null;
  if (vendorAns && vendorAns.choice !== 'unclear' && vendorAns.confidence >= VENDOR_CONF_MIN) {
    vendorRecord = vendors.find((v) => v.vendor === vendorAns.choice) || null;
  }

  const isSoftwareP = answers.is_software_purchase ? answers.is_software_purchase.noul : 0.5;
  const isDirectorP = answers.is_director ? answers.is_director.noul : 0.5;

  const rules = parsePolicy(input.policy_text || '');
  if (rules.length === 0) return { decision: 'abstain' };

  for (const rule of rules) {
    switch (rule.type) {
      case 'blocked_reject': {
        if (!vendorRecord) return { decision: 'abstain' };
        if (vendorRecord.blocked) return { decision: 'reject' };
        break;
      }
      case 'software_security': {
        if (isSoftwareP > AMBIG_LOW && isSoftwareP < AMBIG_HIGH) return { decision: 'abstain' };
        if (isSoftwareP >= AMBIG_HIGH) {
          if (!vendorRecord) return { decision: 'abstain' };
          if (!vendorRecord.approved_software) return { decision: 'needs_security' };
        }
        break;
      }
      case 'threshold_director': {
        if (usdAmount > rule.threshold) {
          if (isDirectorP > AMBIG_LOW && isDirectorP < AMBIG_HIGH) return { decision: 'abstain' };
          return { decision: isDirectorP >= AMBIG_HIGH ? 'needs_finance' : 'reject' };
        }
        break;
      }
      case 'threshold_finance': {
        if (usdAmount > rule.threshold) return { decision: 'needs_finance' };
        break;
      }
      case 'threshold_manager': {
        if (usdAmount > rule.threshold) return { decision: 'needs_manager' };
        break;
      }
      case 'default_approve': {
        return { decision: 'approve' };
      }
      case 'threshold_unknown': {
        if (usdAmount > rule.threshold) return { decision: 'abstain' };
        break;
      }
      default: {
        return { decision: 'abstain' };
      }
    }
  }

  return { decision: 'abstain' };
}

// --- policy parsing ---------------------------------------------------

function parsePolicy(policyText) {
  const lines = policyText.split('\n');
  const rules = [];
  for (const line of lines) {
    const m = line.match(/^\s*\d+\.\s*(.+)$/);
    if (!m) continue;
    const text = m[1];
    const lower = text.toLowerCase();

    if (lower.includes('blocked list')) {
      rules.push({ type: 'blocked_reject' });
      continue;
    }
    if (lower.includes('software') && lower.includes('security')) {
      rules.push({ type: 'software_security' });
      continue;
    }
    const numMatch = text.match(/[\d,]+(?:\.\d+)?/);
    if (numMatch) {
      const threshold = parseFloat(numMatch[0].replace(/,/g, ''));
      if (Number.isFinite(threshold)) {
        if (lower.includes('director')) rules.push({ type: 'threshold_director', threshold });
        else if (lower.includes('finance')) rules.push({ type: 'threshold_finance', threshold });
        else if (lower.includes('manager')) rules.push({ type: 'threshold_manager', threshold });
        else rules.push({ type: 'threshold_unknown', threshold });
        continue;
      }
    }
    if (lower.includes('approved') || lower.includes('anything else') || lower.includes('otherwise')) {
      rules.push({ type: 'default_approve' });
      continue;
    }
    rules.push({ type: 'unknown', raw: text });
  }
  return rules;
}

// --- amount/currency extraction ----------------------------------------

const SYMBOL_MAP = { $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR' };
const WORD_MAP = {
  dollar: 'USD', dollars: 'USD', usd: 'USD',
  euro: 'EUR', euros: 'EUR', eur: 'EUR',
  pound: 'GBP', pounds: 'GBP', gbp: 'GBP', sterling: 'GBP',
  yen: 'JPY', jpy: 'JPY',
};

function extractAmount(text, rates) {
  if (!text) return null;
  const codes = Object.keys(rates || {});
  const numPart = '(\\d[\\d,]*(?:\\.\\d+)?)\\s*(thousand|million|k|m)?';
  const symAlt = Object.keys(SYMBOL_MAP)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('');
  const codeAlt = codes.length ? codes.map((c) => c.toUpperCase()).join('|') : null;
  const wordAlt = Object.keys(WORD_MAP).join('|');

  const patterns = [{ re: new RegExp(`[${symAlt}]\\s?${numPart}`, 'gi'), kind: 'symbol' }];
  if (codeAlt) {
    patterns.push({ re: new RegExp(`${numPart}\\s*(${codeAlt})\\b`, 'gi'), kind: 'numCode' });
    patterns.push({ re: new RegExp(`\\b(${codeAlt})\\s*${numPart}`, 'gi'), kind: 'codeNum' });
  }
  patterns.push({ re: new RegExp(`${numPart}\\s*(${wordAlt})\\b`, 'gi'), kind: 'numWord' });

  const candidates = [];
  for (const p of patterns) {
    let m;
    while ((m = p.re.exec(text)) !== null) {
      let numStr, suffix, currency;
      if (p.kind === 'symbol') {
        currency = SYMBOL_MAP[m[0][0]];
        numStr = m[1];
        suffix = m[2];
      } else if (p.kind === 'codeNum') {
        currency = m[1].toUpperCase();
        numStr = m[2];
        suffix = m[3];
      } else if (p.kind === 'numCode') {
        numStr = m[1];
        suffix = m[2];
        currency = m[3].toUpperCase();
      } else {
        numStr = m[1];
        suffix = m[2];
        currency = WORD_MAP[m[3].toLowerCase()];
      }
      const amount = applySuffix(parseFloat(numStr.replace(/,/g, '')), suffix);
      if (Number.isFinite(amount)) candidates.push({ index: m.index, amount, currency });
    }
  }

  if (candidates.length === 0) {
    const m = text.match(new RegExp(numPart));
    if (!m) return null;
    const amount = applySuffix(parseFloat(m[1].replace(/,/g, '')), m[2]);
    return Number.isFinite(amount) ? { amount, currency: 'USD' } : null;
  }

  const totalIdx = text.toLowerCase().lastIndexOf('total');
  if (totalIdx !== -1) {
    const near = candidates.filter((c) => c.index >= totalIdx && c.index - totalIdx < 30);
    if (near.length) return near[0];
  }
  return candidates[candidates.length - 1];
}

function applySuffix(n, suffix) {
  if (!suffix) return n;
  const s = suffix.toLowerCase();
  if (s === 'k' || s === 'thousand') return n * 1000;
  if (s === 'm' || s === 'million') return n * 1000000;
  return n;
}
