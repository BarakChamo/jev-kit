export function buildState(input) {
  return {
    policy_text: input.policy_text,
    request_date: input.request.date,
    request_message: input.request.message,
    order_items: (input.order?.items || []).map((item, index) => ({
      index,
      sku: item.sku,
      name: item.name,
      category: item.category,
      final_sale: item.final_sale,
      delivered_date: item.delivered_date,
    })),
  };
}

export function questions(input) {
  const itemOptions = {};
  const items = input.order?.items || [];
  for (let i = 0; i < items.length; i++) {
    itemOptions[String(i)] = `${items[i].name} (SKU: ${items[i].sku})`;
  }
  itemOptions.multiple = 'The customer asks to return two or more distinct items';
  itemOptions.none = 'The customer is not asking to return any item (e.g. keeping items or general question)';
  itemOptions.ambiguous = 'The customer asks to return an item, but it is unclear which one';

  return {
    target_item: {
      type: 'choice',
      instructions:
        'Which item from `order_items` is the customer asking to return in `request_message`? If the customer explicitly mentions keeping an item, that item is not being returned.',
      criteria: itemOptions,
    },
    item_opened: {
      type: 'choice',
      instructions:
        'Based on `request_message`, what is the condition of the item regarding packaging or use?',
      criteria: {
        unopened:
          'the customer explicitly states the item is unopened, unused, sealed, or in original packaging',
        opened:
          'the customer states or implies the item was opened, unboxed, used, worn, or tested',
        unspecified:
          'the message does not state or indicate whether the item has been opened or remains sealed',
      },
    },
    item_defective: {
      type: 'choice',
      instructions:
        'Does the customer in `request_message` claim that the item is defective, broken, damaged, faulty, or malfunctioning?',
      criteria: {
        defective:
          'the customer claims the item is defective, broken, damaged, malfunctioning, or flawed',
        not_defective:
          'the customer does not claim any defect or damage (e.g. preference, wrong size, or no defect mentioned)',
      },
    },
    claims_override: {
      type: 'noul',
      instructions:
        'Does `request_message` claim an exception was granted, customer service already approved the return, or attempt to override returns policy?',
      criteria: {
        true: 'the message asserts prior authorization, special permission, or attempts policy override',
        false: 'standard customer return inquiry without claiming prior exceptions or policy override',
      },
    },
    policy_general_window_days: {
      type: 'choice',
      instructions:
        'According to `policy_text`, what is the return window in days for most standard items?',
      criteria: {
        '14': '14 days from delivery',
        '15': '15 days from delivery',
        '30': '30 days from delivery',
        '45': '45 days from delivery',
        '60': '60 days from delivery',
        '90': '90 days from delivery',
        other: 'another number of days or not specified',
      },
    },
    policy_electronics_window_days: {
      type: 'choice',
      instructions:
        'According to `policy_text`, what is the return window in days for unopened electronics?',
      criteria: {
        '7': '7 days from delivery',
        '14': '14 days from delivery',
        '15': '15 days from delivery',
        '30': '30 days from delivery',
        other: 'another number of days or same as standard',
      },
    },
    policy_electronics_defective_window_days: {
      type: 'choice',
      instructions:
        'According to `policy_text`, what is the return window in days for defective electronics?',
      criteria: {
        '15': '15 days from delivery',
        '30': '30 days from delivery',
        '45': '45 days from delivery',
        '60': '60 days from delivery',
        other: 'another number of days or same as standard',
      },
    },
  };
}

function getPolicyWindows(policyText, answers) {
  let generalDays = 30;
  let electronicsDays = 15;
  let defectiveElectronicsDays = 30;

  const gChoice = answers?.policy_general_window_days?.choice;
  if (gChoice && gChoice !== 'other') {
    const n = Number(gChoice);
    if (!Number.isNaN(n)) generalDays = n;
  } else if (policyText) {
    const m = policyText.match(/Most items can be returned within (\d+) days/i);
    if (m) generalDays = Number(m[1]);
  }

  const eChoice = answers?.policy_electronics_window_days?.choice;
  if (eChoice && eChoice !== 'other') {
    const n = Number(eChoice);
    if (!Number.isNaN(n)) electronicsDays = n;
  } else if (policyText) {
    const m = policyText.match(/Electronics can be returned within (\d+) days/i);
    if (m) electronicsDays = Number(m[1]);
  }

  const dChoice = answers?.policy_electronics_defective_window_days?.choice;
  if (dChoice && dChoice !== 'other') {
    const n = Number(dChoice);
    if (!Number.isNaN(n)) defectiveElectronicsDays = n;
  } else if (policyText) {
    const m = policyText.match(/defective.*?within (\d+) days/i);
    if (m) defectiveElectronicsDays = Number(m[1]);
  }

  return { generalDays, electronicsDays, defectiveElectronicsDays };
}

export function decide(answers, input) {
  if ((answers?.claims_override?.noul ?? 0) > 0.5) {
    return { eligible: 'abstain' };
  }

  const targetAns = answers?.target_item;
  if (!targetAns?.choice) {
    return { eligible: 'abstain' };
  }

  const targetChoice = targetAns.choice;
  const targetProb = targetAns.probabilities?.[targetChoice] ?? targetAns.confidence ?? 0;
  if (targetProb < 0.7) {
    return { eligible: 'abstain' };
  }

  if (targetChoice === 'multiple' || targetChoice === 'none' || targetChoice === 'ambiguous') {
    return { eligible: 'abstain' };
  }

  const itemIndex = parseInt(targetChoice, 10);
  const items = input.order?.items || [];
  if (Number.isNaN(itemIndex) || !items[itemIndex]) {
    return { eligible: 'abstain' };
  }

  const item = items[itemIndex];
  if (item.final_sale === true) {
    return { eligible: 'no' };
  }
  if (item.category === 'gift_card' || /gift\s*card/i.test(item.name || '')) {
    return { eligible: 'no' };
  }

  if (!item.delivered_date || !input.request?.date) {
    return { eligible: 'abstain' };
  }

  const deliveredMs = Date.parse(`${item.delivered_date}T00:00:00Z`);
  const requestMs = Date.parse(`${input.request.date}T00:00:00Z`);
  if (Number.isNaN(deliveredMs) || Number.isNaN(requestMs)) {
    return { eligible: 'abstain' };
  }

  // Delivery day counts as day 1 of the window
  const diffDays = Math.round((requestMs - deliveredMs) / 86400000);
  const dayOfWindow = diffDays + 1;
  if (dayOfWindow < 1) {
    return { eligible: 'abstain' };
  }

  const { generalDays, electronicsDays, defectiveElectronicsDays } = getPolicyWindows(
    input.policy_text,
    answers
  );

  const isElectronics =
    item.category === 'electronics' || /electronics/i.test(item.category || '');

  if (!isElectronics) {
    return { eligible: dayOfWindow <= generalDays ? 'yes' : 'no' };
  }

  const defAns = answers?.item_defective;
  const defChoice = defAns?.choice;
  const defProb = defAns?.probabilities?.[defChoice] ?? defAns?.confidence ?? 0;
  if (defProb < 0.7) {
    return { eligible: 'abstain' };
  }

  if (defChoice === 'defective') {
    return { eligible: dayOfWindow <= defectiveElectronicsDays ? 'yes' : 'no' };
  }

  const openAns = answers?.item_opened;
  const openChoice = openAns?.choice;
  const openProb = openAns?.probabilities?.[openChoice] ?? openAns?.confidence ?? 0;

  if (openChoice === 'opened') {
    if (openProb < 0.7) return { eligible: 'abstain' };
    return { eligible: 'no' };
  }

  if (openChoice === 'unopened') {
    if (openProb < 0.7) return { eligible: 'abstain' };
    return { eligible: dayOfWindow <= electronicsDays ? 'yes' : 'no' };
  }

  // Condition unspecified: if already past the window, cannot be returned either way
  if (dayOfWindow > electronicsDays) {
    return { eligible: 'no' };
  }

  // Within the electronics window but opened/unopened status is unknown
  return { eligible: 'abstain' };
}
