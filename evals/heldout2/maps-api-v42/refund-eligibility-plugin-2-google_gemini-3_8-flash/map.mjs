function getDayNumber(deliveredDateStr, requestDateStr) {
  if (!deliveredDateStr || !requestDateStr) return null;
  const [y1, m1, d1] = deliveredDateStr.split('-').map(Number);
  const [y2, m2, d2] = requestDateStr.split('-').map(Number);
  if (!y1 || !m1 || !d1 || !y2 || !m2 || !d2) return null;
  const utc1 = Date.UTC(y1, m1 - 1, d1);
  const utc2 = Date.UTC(y2, m2 - 1, d2);
  const diffDays = Math.round((utc2 - utc1) / 86400000);
  return diffDays + 1;
}

function isGiftCard(item) {
  const cat = (item.category || '').toLowerCase();
  const name = (item.name || '').toLowerCase();
  return cat.includes('gift') || name.includes('gift card') || name.includes('gift certificate');
}

export function buildState(input) {
  return {
    customer_message: input.request?.message ?? '',
    order_items: (input.order?.items ?? []).map((it) => ({
      sku: it.sku,
      name: it.name,
      category: it.category,
    })),
  };
}

export function questions(input) {
  const itemOptions = Object.fromEntries(
    (input.order?.items ?? []).map((it) => [it.sku, `${it.name} (${it.category})`])
  );

  return {
    target_item: {
      type: 'choice',
      instructions: 'Which item from `order_items` is the customer asking to return in `customer_message`?',
      criteria: {
        ...itemOptions,
        none: 'the customer is not asking to return any item from the order',
        multiple: 'the customer is asking to return more than one item from the order',
        ambiguous: 'the message is unclear or ambiguous about which item from the order is being returned',
      },
    },
    opened_state: {
      type: 'choice',
      instructions: 'Does `customer_message` state whether the item being returned has been opened, unboxed, or used?',
      criteria: {
        unopened: 'the message explicitly states the item is unopened, sealed, brand new, or never opened',
        opened: 'the message states or implies the item was opened, unboxed, tried, or used',
        not_mentioned: 'the message does not state or mention whether the item was opened',
        ambiguous: 'the message is contradictory or unclear about whether the item was opened',
      },
    },
    defect_state: {
      type: 'choice',
      instructions: 'Does `customer_message` report that the item being returned is defective, damaged, or not working properly?',
      criteria: {
        defective: 'the customer reports a defect, fault, damage, or malfunction with the item',
        not_defective: 'the customer does not report any defect or damage (e.g. wrong size, unwanted, changed mind, or no reason given)',
        ambiguous: 'the message is unclear or contradictory about whether a defect or damage is reported',
      },
    },
  };
}

export function decide(answers, input) {
  const targetAns = answers?.target_item;
  const targetChoice = targetAns?.choice;
  const targetProb = targetAns?.probabilities?.[targetChoice] ?? 0;

  if (!targetChoice || targetProb < 0.75) {
    return { eligible: 'abstain' };
  }

  const items = input.order?.items ?? [];
  const item = items.find((it) => it.sku === targetChoice);
  if (!item) {
    return { eligible: 'abstain' };
  }

  if (item.final_sale === true || isGiftCard(item)) {
    return { eligible: 'no' };
  }

  const dayNumber = getDayNumber(item.delivered_date, input.request?.date);
  if (dayNumber === null || dayNumber < 1) {
    return { eligible: 'abstain' };
  }

  const isElectronics = (item.category || '').toLowerCase() === 'electronics';

  if (!isElectronics) {
    return { eligible: dayNumber <= 30 ? 'yes' : 'no' };
  }

  if (dayNumber > 30) {
    return { eligible: 'no' };
  }

  const defectAns = answers?.defect_state;
  const defectChoice = defectAns?.choice;
  const defectProb = defectAns?.probabilities?.[defectChoice] ?? 0;

  const openedAns = answers?.opened_state;
  const openedChoice = openedAns?.choice;
  const openedProb = openedAns?.probabilities?.[openedChoice] ?? 0;

  const isDefective = defectChoice === 'defective' && defectProb >= 0.7;
  const isNotDefective = defectChoice === 'not_defective' && defectProb >= 0.7;
  const isUnopened = openedChoice === 'unopened' && openedProb >= 0.7;
  const isOpened = openedChoice === 'opened' && openedProb >= 0.7;

  if (isDefective) {
    return { eligible: 'yes' };
  }

  if (dayNumber <= 15 && isUnopened) {
    return { eligible: 'yes' };
  }

  if (dayNumber > 15 && isNotDefective) {
    return { eligible: 'no' };
  }

  if (dayNumber <= 15 && isOpened && isNotDefective) {
    return { eligible: 'no' };
  }

  return { eligible: 'abstain' };
}
