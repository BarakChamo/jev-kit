const MAX_AMOUNT_OPTIONS = 250;
const GATE = 0.70;
const NOUL_TRUE = 0.65;
const NOUL_FALSE = 0.35;

function buildVendorOptions(vendors) {
  const out = [];

  for (const [vi, v] of (vendors || []).entries()) {
    const canonical = v.vendor || `Vendor ${vi}`;

    out.push({
      id: `v${vi}_0`,
      vendor: canonical,
      vendor_index: vi,
      blocked: Boolean(v.blocked),
      approved_software: Boolean(v.approved_software),
      description: `The vendor named in the request is "${canonical}", a listed vendor.`
    });

    for (const [ai, aka] of (v.also_known_as || []).entries()) {
      out.push({
        id: `v${vi}_${ai + 1}`,
        vendor: canonical,
        vendor_index: vi,
        blocked: Boolean(v.blocked),
        approved_software: Boolean(v.approved_software),
        description: `The vendor named in the request is "${aka}", an alias for listed vendor "${canonical}".`
      });
    }
  }

  out.push({
    id: 'not_listed',
    vendor: null,
    vendor_index: -1,
    blocked: false,
    approved_software: false,
    description: 'The purchase does not name a vendor, or the vendor is not in the vendor list.'
  });

  out.push({
    id: 'unclear',
    vendor: null,
    vendor_index: -1,
    blocked: false,
    approved_software: false,
    description: 'Multiple vendors are named or the intended vendor is genuinely unclear.'
  });

  return out;
}

function buildAmountOptions(text) {
  const out = [];
  const source = text || '';
  const regex = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+|\d+)(?:\s?(?:USD|EUR|GBP|JPY))?/g;
  let match;

  while ((match = regex.exec(source)) !== null) {
    const amount = parseFloat(match[1].replace(/,/g, ''));
    if (!Number.isFinite(amount)) continue;

    const start = Math.max(0, match.index - 40);
    const end = Math.min(source.length, match.index + match[0].length + 40);
    const snippet = source.slice(start, end).replace(/\s+/g, ' ').trim();

    out.push({ id: `a${out.length}`, amount, snippet });

    if (out.length >= MAX_AMOUNT_OPTIONS) break;
  }

  return out;
}

function getPolicyConstants(policyText = '') {
  const text = String(policyText || '');
  const amounts = [];
  const re = /above\s+([\d][\d,]*)\s*USD/gi;
  let match;

  while ((match = re.exec(text)) !== null) {
    const n = parseFloat(match[1].replace(/,/g, ''));
    if (Number.isFinite(n)) amounts.push(n);
  }

  if (amounts.length >= 3) {
    const sorted = [...amounts].sort((a, b) => b - a);
    return {
      rejectThreshold: sorted[0],
      financeThreshold: sorted[1],
      managerThreshold: sorted[2],
      directorException: /director/i.test(text)
    };
  }

  return {
    rejectThreshold: 50000,
    financeThreshold: 10000,
    managerThreshold: 1000,
    directorException: true
  };
}

function isDirectorTitle(title) {
  if (!title) return false;
  const t = String(title).trim();
  return /(^|[\s/])director(?:s)?(?=[\s/,.;-]|$)/i.test(t) ||
         /(^|[\s/])dir\.?(?=[\s/,.;-]|$)/i.test(t);
}

export function buildState(input) {
  return {
    policy_text: input.policy_text || '',
    rates: input.rates || {},
    vendors: input.vendors || [],
    requester: input.requester || {},
    request_text: input.request_text || ''
  };
}

export function questions(input) {
  const vendorOptions = buildVendorOptions(input.vendors);
  const amountOptions = buildAmountOptions(input.request_text);

  const vendorCriteria = Object.fromEntries(
    vendorOptions.map((option) => [option.id, option.description])
  );

  const amountCriteria = Object.fromEntries([
    ...amountOptions.map((option) => [
      option.id,
      `A number in the request: "${option.snippet}"`
    ]),
    ['not_listed', 'The total amount is not listed as a number, or no total amount is given.']
  ]);

  return {
    vendor: {
      type: 'choice',
      instructions: 'Which vendor is the purchase in `request_text` for? Choose the matching listed vendor or alias. If the text names no vendor, choose `not_listed`. If it names more than one vendor and the intended one is not clear, choose `unclear`.',
      criteria: vendorCriteria
    },

    is_software: {
      type: 'noul',
      instructions: 'Does the purchase described in `request_text` include any software, software subscription, software as a service (SaaS), software license, software product, or software service? Include software delivered as a service. Do not include hardware, consulting, physical goods, or non-software services.',
      criteria: {
        true: 'The purchase includes software or a software service.',
        false: 'The purchase does not include software.'
      }
    },

    amount: {
      type: 'choice',
      instructions: 'Which number in `request_text` is the total amount of the purchase? Ignore unit prices, quantities, order numbers, dates, policy thresholds, and any other numbers. If the total amount is written in words or no total amount is given, choose `not_listed`.',
      criteria: amountCriteria
    },

    currency: {
      type: 'choice',
      instructions: 'In which currency is the total amount in `request_text` stated? Map currency symbols: $ is USD, € is EUR, £ is GBP, ¥ is JPY. Use the currency code if one is written. If no currency is stated or it is ambiguous, choose `unclear`.',
      criteria: {
        USD: 'United States dollars',
        EUR: 'Euros',
        GBP: 'British pounds',
        JPY: 'Japanese yen',
        unclear: 'No currency is stated, or the currency is ambiguous or not one of the listed currencies'
      }
    }
  };
}

export function decide(answers, input) {
  const vendorOptions = buildVendorOptions(input.vendors);
  const amountOptions = buildAmountOptions(input.request_text);
  const policy = getPolicyConstants(input.policy_text);

  const vendorAnswer = answers?.vendor || {};
  const vendorChoice = vendorAnswer.choice;
  const vendorProb = vendorAnswer.probabilities?.[vendorChoice] ?? vendorAnswer.confidence ?? 0;
  const vendor = vendorOptions.find((option) => option.id === vendorChoice);

  if (!vendor) return 'abstain';
  if (vendor.id === 'unclear') return 'abstain';
  if (vendorProb < GATE) return 'abstain';

  if (vendor.blocked) return 'reject';

  const softwareAnswer = answers?.is_software || {};
  const softwareProb = softwareAnswer.noul;

  if (typeof softwareProb !== 'number') return 'abstain';

  let isSoftware;
  if (softwareProb >= NOUL_TRUE) {
    isSoftware = true;
  } else if (softwareProb <= NOUL_FALSE) {
    isSoftware = false;
  } else {
    return 'abstain';
  }

  if (isSoftware && !vendor.approved_software) return 'needs_security';

  const amountAnswer = answers?.amount || {};
  const amountChoice = amountAnswer.choice;
  const amountProb = amountAnswer.probabilities?.[amountChoice] ?? amountAnswer.confidence ?? 0;
  const amountOption = amountOptions.find((option) => option.id === amountChoice);

  if (amountChoice === 'not_listed' || !amountOption) return 'abstain';
  if (amountProb < GATE) return 'abstain';

  const currencyAnswer = answers?.currency || {};
  const currency = currencyAnswer.choice;
  const currencyProb = currencyAnswer.probabilities?.[currency] ?? currencyAnswer.confidence ?? 0;
  const rate = input.rates?.[currency];

  if (currency === 'unclear' || typeof rate !== 'number') return 'abstain';
  if (currencyProb < GATE) return 'abstain';

  const amountUsd = amountOption.amount * rate;
  const isDirector = isDirectorTitle(input.requester?.title);

  if (amountUsd > policy.rejectThreshold) {
    return isDirector && policy.directorException ? 'needs_finance' : 'reject';
  }

  if (amountUsd > policy.financeThreshold) return 'needs_finance';
  if (amountUsd > policy.managerThreshold) return 'needs_manager';

  return 'approve';
}
