export function buildState(input) {
  return {
    request_text: input.request_text,
    rates: input.rates,
    vendors: input.vendors,
  };
}

export function questions(input) {
  const vendors = input.vendors || [];
  const vendorOptions = {};

  vendors.forEach((v, i) => {
    const aliases = Array.isArray(v.also_known_as) && v.also_known_as.length
      ? ` (also known as: ${v.also_known_as.join(', ')})`
      : '';
    vendorOptions[`vendor_${i}`] = `${v.vendor}${aliases}`;
  });

  vendorOptions.other = 'A single vendor that is not in the listed vendors above';
  vendorOptions.ambiguous = 'Multiple vendors are mentioned, or the request is unclear about which single vendor is being used';

  return {
    vendor: {
      type: 'choice',
      instructions: 'Identify the vendor from whom the purchase is being made in the request. Use aliases when present. If the vendor is not listed choose "other". If multiple vendors are mentioned or the vendor is ambiguous choose "ambiguous".',
      criteria: vendorOptions,
    },
    software: {
      type: 'noul',
      instructions: 'Does the request describe a purchase of software? Consider software, SaaS, cloud subscription, app, license, platform, or digital service.',
      criteria: {
        true: 'The request is for software, SaaS, a subscription to software or a digital service, an app, a license, or a platform.',
        false: 'The request is not for software (for example, hardware, physical goods, consulting, or non-software services).',
      },
    },
    amount_bucket: {
      type: 'choice',
      instructions: 'Extract the total purchase amount from the request and convert it to US dollars using the rates in the state. Choose the bucket containing the USD amount. Use strict thresholds: above 1,000; above 10,000; above 50,000.',
      criteria: {
        lte_1000: 'USD amount is at most 1,000 (<= 1,000)',
        '1001_10000': 'USD amount is greater than 1,000 and at most 10,000 (> 1,000 and <= 10,000)',
        '10001_50000': 'USD amount is greater than 10,000 and at most 50,000 (> 10,000 and <= 50,000)',
        gt_50000: 'USD amount is greater than 50,000 (> 50,000)',
        unknown: 'The total purchase amount cannot be determined from the request',
      },
    },
  };
}

export function decide(answers, input) {
  const MIN_CHOICE_CONFIDENCE = 0.65;
  const SOFTWARE_TRUE_PROB = 0.65;
  const SOFTWARE_FALSE_PROB = 0.35;

  const vendorAnswer = answers && answers.vendor;
  if (!vendorAnswer || vendorAnswer.type !== 'choice' || typeof vendorAnswer.confidence !== 'number') {
    return 'abstain';
  }
  if (vendorAnswer.confidence < MIN_CHOICE_CONFIDENCE) {
    return 'abstain';
  }

  const vendorKey = vendorAnswer.choice;
  let vendor = null;

  if (vendorKey === 'other') {
    vendor = null;
  } else if (vendorKey === 'ambiguous') {
    return 'abstain';
  } else if (typeof vendorKey === 'string' && vendorKey.startsWith('vendor_')) {
    const index = Number(vendorKey.slice('vendor_'.length));
    const vendors = input.vendors || [];
    if (Number.isInteger(index) && index >= 0 && index < vendors.length) {
      vendor = vendors[index];
    } else {
      return 'abstain';
    }
  } else {
    return 'abstain';
  }

  // Rule 1: blocked vendor
  if (vendor && vendor.blocked) {
    return 'reject';
  }

  const softwareAnswer = answers && answers.software;
  if (!softwareAnswer || softwareAnswer.type !== 'noul' || typeof softwareAnswer.noul !== 'number') {
    return 'abstain';
  }

  const softwareProb = softwareAnswer.noul;
  let isSoftware;

  if (softwareProb >= SOFTWARE_TRUE_PROB) {
    isSoftware = true;
  } else if (softwareProb <= SOFTWARE_FALSE_PROB) {
    isSoftware = false;
  } else {
    return 'abstain';
  }

  // Rule 2: software purchase from vendor not on approved-software list
  if (isSoftware && !(vendor && vendor.approved_software)) {
    return 'needs_security';
  }

  const amountAnswer = answers && answers.amount_bucket;
  if (!amountAnswer || amountAnswer.type !== 'choice' || typeof amountAnswer.confidence !== 'number') {
    return 'abstain';
  }
  if (amountAnswer.confidence < MIN_CHOICE_CONFIDENCE) {
    return 'abstain';
  }

  const bucket = amountAnswer.choice;
  if (!['lte_1000', '1001_10000', '10001_50000', 'gt_50000'].includes(bucket)) {
    return 'abstain';
  }

  const isDirector = /director/i.test((input.requester && input.requester.title) || '');

  // Rule 3: above 50,000
  if (bucket === 'gt_50000') {
    return isDirector ? 'needs_finance' : 'reject';
  }

  // Rule 4: above 10,000
  if (bucket === '10001_50000') {
    return 'needs_finance';
  }

  // Rule 5: above 1,000
  if (bucket === '1001_10000') {
    return 'needs_manager';
  }

  // Rule 6: anything else
  return 'approve';
}
