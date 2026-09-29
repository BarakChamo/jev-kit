const CHOICE_GATE = 0.8;
const SOFTWARE_TRUE = 0.8;
const SOFTWARE_FALSE = 0.2;

function choiceProbability(answer) {
  if (!answer) return 0;
  if (answer.probabilities && typeof answer.probabilities[answer.choice] === 'number') {
    return answer.probabilities[answer.choice];
  }
  if (typeof answer.confidence === 'number') return answer.confidence;
  return 0;
}

function normalizeNumberToken(token) {
  const cleaned = String(token).replace(/,/g, '');
  const match = cleaned.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed)) return null;
  return String(parsed);
}

function extractAmountNumbers(text) {
  const numbers = new Set();
  const patterns = [
    /(?:USD|EUR|GBP|JPY)\s*\$?\s*\d[\d,]*(?:\.\d+)?/gi,
    /[$€£¥]\s*\d[\d,]*(?:\.\d+)?/g,
    /\d[\d,]*(?:\.\d+)?\s*(?:USD|EUR|GBP|JPY|dollars?|euros?|pounds?|yen)/gi,
    /\b\d[\d,]*(?:\.\d+)?\b/g,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const normalized = normalizeNumberToken(match[0]);
      if (normalized) numbers.add(normalized);
      if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
    }
  }

  return [...numbers].slice(0, 254);
}

function buildVendorOptions(vendors) {
  const options = {};
  for (const vendor of vendors) {
    options[vendor.vendor] = `Vendor listed in \`vendors\`: ${vendor.vendor}`;
    for (const alias of vendor.also_known_as || []) {
      options[alias] = `Alias for ${vendor.vendor}`;
    }
  }
  options.other_vendor = 'A vendor not listed in `vendors`, or the vendor cannot be determined';
  return options;
}

function buildCurrencyOptions(rates = {}) {
  const options = {};
  for (const currency of Object.keys(rates)) {
    options[currency] = `${currency} currency`;
  }
  options.other = 'Any currency not listed in `rates` or cannot be determined';
  return options;
}

function buildAmountOptions(text) {
  const numbers = extractAmountNumbers(text);
  const options = {};
  for (const number of numbers) {
    options[number] = `The number ${number} as stated in \`request_text\``;
  }
  options.other_amount = 'The total purchase amount is not one of these numbers, or cannot be determined';
  return options;
}

function findVendor(vendors, choice) {
  if (!choice || choice === 'other_vendor') return null;
  const wanted = String(choice).trim().toLowerCase();
  for (const vendor of vendors) {
    const names = [vendor.vendor, ...(vendor.also_known_as || [])];
    if (names.some((name) => name.trim().toLowerCase() === wanted)) return vendor;
  }
  return null;
}

function isDirector(requester) {
  const title = String(requester?.title || '').trim().toLowerCase();
  return /\bdirector\b/.test(title);
}

export function buildState(input) {
  return {
    request_text: input.request_text,
    vendors: (input.vendors || []).map((vendor) => ({
      vendor: vendor.vendor,
      also_known_as: vendor.also_known_as || [],
    })),
    rates: input.rates || {},
  };
}

export function questions(input) {
  return {
    vendor_choice: {
      type: 'choice',
      instructions: 'Which vendor in `vendors` does `request_text` ask to purchase from? Use the exact vendor name or alias. If `request_text` describes a vendor not listed in `vendors`, choose `other_vendor`.',
      criteria: buildVendorOptions(input.vendors || []),
    },
    is_software: {
      type: 'noul',
      instructions: 'Does the purchase described in `request_text` include any software, SaaS, a subscription to a software or online service, or a software license?',
      criteria: {
        true: 'The purchase includes software or an online/software service or subscription',
        false: 'The purchase is hardware, physical goods, consulting, or another non-software item',
      },
    },
    currency_choice: {
      type: 'choice',
      instructions: 'Which currency is the total purchase amount in `request_text` expressed in? Supported currencies are listed in `rates`. If no other currency is specified, choose USD.',
      criteria: buildCurrencyOptions(input.rates || {}),
    },
    amount_choice: {
      type: 'choice',
      instructions: 'Which number in `request_text` is the total purchase amount? Do not choose quantities, unit prices, dates, or any number that is not the total purchase amount. If the total purchase amount is not listed as one of these numbers, choose `other_amount`.',
      criteria: buildAmountOptions(input.request_text || ''),
    },
  };
}

export function decide(answers, input) {
  const vendorAnswer = answers.vendor_choice;
  const vendorProb = choiceProbability(vendorAnswer);
  if (vendorProb < CHOICE_GATE) return { decision: 'abstain' };

  const vendor = findVendor(input.vendors || [], vendorAnswer.choice);
  if (!vendor) return { decision: 'abstain' };

  // Rule 1: blocked vendor
  if (vendor.blocked) return { decision: 'reject' };

  // Rule 2: software from a vendor not on the approved-software list
  if (!vendor.approved_software) {
    const softwareAnswer = answers.is_software;
    const softwareTrue = softwareAnswer?.noul;
    if (typeof softwareTrue !== 'number') return { decision: 'abstain' };

    if (softwareTrue >= SOFTWARE_TRUE) {
      return { decision: 'needs_security' };
    }
    if (softwareTrue <= SOFTWARE_FALSE) {
      // Not software; continue to amount rules.
    } else {
      return { decision: 'abstain' };
    }
  }

  // Amount is required for rules 3, 4 and 5
  const amountAnswer = answers.amount_choice;
  const amountProb = choiceProbability(amountAnswer);
  if (amountProb < CHOICE_GATE) return { decision: 'abstain' };

  const amount = Number(amountAnswer.choice);
  if (!Number.isFinite(amount)) return { decision: 'abstain' };

  const currencyAnswer = answers.currency_choice;
  const currencyProb = choiceProbability(currencyAnswer);
  if (currencyProb < CHOICE_GATE) return { decision: 'abstain' };

  const currency = currencyAnswer.choice;
  const numericRate = Number(input.rates?.[currency]);
  if (!currency || !Number.isFinite(numericRate)) return { decision: 'abstain' };

  const amountUsd = amount * numericRate;
  if (!Number.isFinite(amountUsd)) return { decision: 'abstain' };

  const requesterIsDirector = isDirector(input.requester);

  // Rule 3: above 50,000 USD
  if (amountUsd > 50000) {
    return { decision: requesterIsDirector ? 'needs_finance' : 'reject' };
  }

  // Rule 4: above 10,000 USD
  if (amountUsd > 10000) return { decision: 'needs_finance' };

  // Rule 5: above 1,000 USD
  if (amountUsd > 1000) return { decision: 'needs_manager' };

  // Rule 6: anything else
  return { decision: 'approve' };
}
