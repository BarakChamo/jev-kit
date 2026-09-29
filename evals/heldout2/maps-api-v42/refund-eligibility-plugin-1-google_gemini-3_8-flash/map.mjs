export function buildState(input) {
  return {
    policy_text: input.policy_text,
    order_items: (input.order?.items ?? []).map((item) => ({
      sku: item.sku,
      name: item.name,
      category: item.category,
      final_sale: item.final_sale,
      delivered_date: item.delivered_date,
    })),
    request_message: input.request?.message ?? '',
    request_date: input.request?.date ?? '',
  };
}

export function questions(input) {
  const items = input.order?.items ?? [];
  const itemCriteria = {};
  for (const item of items) {
    itemCriteria[item.sku] = `${item.name} (${item.category || 'item'}, SKU: ${item.sku})`;
  }
  itemCriteria['none'] = 'The customer is not requesting to return any item from `order_items`';
  itemCriteria['ambiguous'] = 'The message mentions multiple items to return, or it is unclear which item from `order_items` is being requested';

  return {
    target_item: {
      type: 'choice',
      instructions: 'Which item in `order_items` is the customer asking to return in `request_message`?',
      criteria: itemCriteria,
    },
    is_defective: {
      type: 'noul',
      instructions: 'Does `request_message` state or claim that the item being returned is defective, faulty, damaged, broken, or not working properly?',
      criteria: {
        true: 'the message asserts that the item is defective, faulty, damaged, broken, or malfunctioning',
        false: 'the message does not state that the item is defective or malfunctioning (e.g. unwanted, wrong size, or no reason given)',
      },
    },
    packaging_status: {
      type: 'choice',
      instructions: 'According to `request_message`, what is the opened or packaging state of the item being returned?',
      criteria: {
        unopened: 'the customer explicitly states the item is unopened, sealed, brand new in box, or never opened',
        opened: 'the customer states or clearly implies the item was opened, unsealed, unpacked, tested, or used',
        unstated: 'the message does not mention whether the item was opened or unopened',
      },
    },
  };
}

export function decide(answers, input) {
  const targetAnswer = answers?.target_item;
  if (!targetAnswer) return { eligible: 'abstain' };

  const chosenSku = targetAnswer.choice;
  const targetProb = targetAnswer.probabilities?.[chosenSku] ?? targetAnswer.confidence ?? 0;

  if (chosenSku === 'ambiguous' || chosenSku === 'none' || targetProb < 0.7) {
    return { eligible: 'abstain' };
  }

  const items = input.order?.items ?? [];
  const item = items.find((it) => it.sku === chosenSku);
  if (!item) {
    return { eligible: 'abstain' };
  }

  const category = (item.category || '').toLowerCase();
  const name = (item.name || '').toLowerCase();
  const isGiftCard = category === 'gift_card' || category.includes('gift card') || name.includes('gift card');

  if (item.final_sale || isGiftCard) {
    return { eligible: 'no' };
  }

  if (!item.delivered_date || !input.request?.date) {
    return { eligible: 'abstain' };
  }

  const [dY, dM, dD] = item.delivered_date.split('-').map(Number);
  const [rY, rM, rD] = input.request.date.split('-').map(Number);
  const delUtc = Date.UTC(dY, dM - 1, dD);
  const reqUtc = Date.UTC(rY, rM - 1, rD);

  if (isNaN(delUtc) || isNaN(reqUtc)) {
    return { eligible: 'abstain' };
  }

  const diffDays = Math.round((reqUtc - delUtc) / (24 * 60 * 60 * 1000));
  const dayCount = diffDays + 1; // Delivery day counts as day 1

  if (dayCount < 1) {
    return { eligible: 'abstain' };
  }

  const isElectronics = category === 'electronics' || category.includes('electronic');

  if (!isElectronics) {
    return { eligible: dayCount <= 30 ? 'yes' : 'no' };
  }

  // Electronics rules
  if (dayCount > 30) {
    return { eligible: 'no' };
  }

  const defProb = answers?.is_defective?.noul ?? 0.5;
  const isDefective = defProb >= 0.7;
  const isNotDefective = defProb <= 0.3;

  if (isDefective) {
    return { eligible: 'yes' };
  }

  if (dayCount > 15) {
    if (isNotDefective) {
      return { eligible: 'no' };
    }
    return { eligible: 'abstain' };
  }

  // Electronics within 15 days, not known to be defective
  const pkgAnswer = answers?.packaging_status;
  const pkgChoice = pkgAnswer?.choice;
  const pkgProb = pkgAnswer?.probabilities?.[pkgChoice] ?? pkgAnswer?.confidence ?? 0;

  if (pkgProb < 0.6) {
    return { eligible: 'abstain' };
  }

  if (pkgChoice === 'unopened') {
    return { eligible: 'yes' };
  }

  if (pkgChoice === 'opened') {
    return isNotDefective ? { eligible: 'no' } : { eligible: 'abstain' };
  }

  return { eligible: 'abstain' };
}
