function normalizeText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function extractAmountMentions(text) {
  const mentions = [];
  const re = /(?:\b(?:USD|EUR|GBP|JPY)\b)?\s*[$€£¥]?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    const raw = match[1];
    const value = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;

    const start = Math.max(0, match.index - 30);
    const end = Math.min(text.length, match.index + match[0].length + 30);
    const context = normalizeText(text.slice(start, end));

    mentions.push({
      key: `amount_${mentions.length}`,
      raw,
      context,
    });

    if (re.lastIndex === match.index) re.lastIndex += 1;
  }
  return mentions;
}

export function buildState(input = {}) {
  const requestText = normalizeText(input.request_text);

  return {
    request_text: requestText,
    policy_text: input.policy_text || '',
    requester_title: (input.requester || {}).title || '',
    rates: input.rates || {},
    vendor_options: (input.vendors || []).map((v, i) => ({
      key: `vendor_${i}`,
      name: v.vendor,
      aliases: v.also_known_as || [],
    })),
    amount_mentions: extractAmountMentions(input.request_text || ''),
  };
}

export function questions(input = {}) {
  const state = buildState(input);

  const amountCriteria = {};
  for (const mention of state.amount_mentions) {
    amountCriteria[mention.key] = `${mention.raw} in text: "${mention.context}"`;
  }
  if (state.amount_mentions.length === 0) {
    amountCriteria.no_amount = 'No numeric amount found in request_text';
  }

  const vendorCriteria = {};
  for (const vendor of state.vendor_options) {
    const aliases = vendor.aliases.length ? ` (also known as: ${vendor.aliases.join(', ')})` : '';
    vendorCriteria[vendor.key] = `${vendor.name}${aliases}`;
  }
  vendorCriteria.none_of_the_above = 'No vendor from vendor_options is identifiable in request_text';

  const currencyHints = {
    USD: '$ or USD or US$',
    EUR: 'EUR or €',
    GBP: 'GBP or £',
    JPY: 'JPY or ¥',
  };
  const currencyCriteria = {};
  for (const code of Object.keys(state.rates)) {
    currencyCriteria[code] = currencyHints[code] ? `${code} (${currencyHints[code]})` : code;
  }
  currencyCriteria.not_stated = 'No currency stated in request_text; policy defaults to US dollars';

  return {
    vendor: {
      type: 'choice',
      instructions: 'Which vendor in `vendor_options` does `request_text` ask to purchase from? Match aliases and informal names in `request_text` to the option descriptions. If none matches, choose `none_of_the_above`.',
      criteria: vendorCriteria,
    },
    currency: {
      type: 'choice',
      instructions: 'Which currency is the total purchase amount in `request_text` expressed in? Use the currency code or symbol present in `request_text`. If no currency is stated, choose `not_stated`.',
      criteria: currencyCriteria,
    },
    amount_total: {
      type: 'choice',
      instructions: 'Which number in `amount_mentions` is the total purchase amount in `request_text`? Ignore unit prices, quantities, dates, account numbers, version numbers, or any number that is not the total purchase amount.',
      criteria: amountCriteria,
    },
    software: {
      type: 'noul',
      instructions: 'Does `request_text` ask to buy software, a software subscription, SaaS, an online/hosted software service, or a comparable digital service?',
      criteria: {
        true: 'The purchase is software, a software license, SaaS, a hosted/online software service, a monitoring service, or a comparable digital service.',
        false: 'The purchase is physical goods, hardware, professional services, consulting, office supplies, travel, or another non-software purchase.',
      },
    },
  };
}

function topProbability(answer) {
  const choice = answer && answer.choice;
  const probs = (answer && answer.probabilities) || {};
  return typeof probs[choice] === 'number' ? probs[choice] : 0;
}

export function decide(answers, input = {}) {
  const NO = { decision: 'abstain' };
  const state = buildState(input);
  const a = answers || {};

  const vendorAnswer = a.vendor;
  const currencyAnswer = a.currency;
  const amountAnswer = a.amount_total;
  const softwareAnswer = a.software;

  if (!vendorAnswer || !currencyAnswer || !amountAnswer || !softwareAnswer) return NO;

  if (
    topProbability(vendorAnswer) < 0.55 ||
    topProbability(currencyAnswer) < 0.55 ||
    topProbability(amountAnswer) < 0.55
  ) {
    return NO;
  }

  const vendorKey = vendorAnswer.choice || '';
  const vendorIndex = vendorKey.startsWith('vendor_') ? Number(vendorKey.split('_')[1]) : NaN;
  const vendorRecord = Number.isInteger(vendorIndex) ? (input.vendors || [])[vendorIndex] : null;

  const currencyChoice = currencyAnswer.choice === 'not_stated' ? 'USD' : currencyAnswer.choice;
  const rate = Number(state.rates[currencyChoice]);
  if (!Number.isFinite(rate) || rate <= 0) return NO;

  const amountRecord = state.amount_mentions.find((m) => m.key === amountAnswer.choice) || null;
  if (!amountRecord) return NO;

  const amountValue = Number(amountRecord.raw.replace(/,/g, ''));
  if (!Number.isFinite(amountValue)) return NO;

  const usdAmount = amountValue * rate;

  const softwareProb = Number(softwareAnswer.noul);
  if (!Number.isFinite(softwareProb)) return NO;

  let isSoftware;
  if (softwareProb >= 0.6) isSoftware = true;
  else if (softwareProb <= 0.4) isSoftware = false;
  else return NO;

  const blocked = vendorRecord && vendorRecord.blocked === true;
  const approvedSoftware = vendorRecord && vendorRecord.approved_software === true;
  const isDirector = /\bdirector\b/i.test(state.requester_title || '');

  if (blocked) return { decision: 'reject' };
  if (isSoftware && !approvedSoftware) return { decision: 'needs_security' };

  if (usdAmount > 50000) {
    return isDirector ? { decision: 'needs_finance' } : { decision: 'reject' };
  }
  if (usdAmount > 10000) return { decision: 'needs_finance' };
  if (usdAmount > 1000) return { decision: 'needs_manager' };

  return { decision: 'approve' };
}
