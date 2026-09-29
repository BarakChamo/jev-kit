const ITEM_PROB_THRESHOLD = 0.8;
const POLICY_PROB_THRESHOLD = 0.8;
const FACT_PROB_THRESHOLD = 0.8;

export function buildState(input) {
  const items = (input.order?.items ?? []).map((item, index) => ({
    index,
    sku: item.sku ?? '',
    name: item.name ?? '',
    category: item.category ?? '',
    final_sale: Boolean(item.final_sale),
    delivered_date: item.delivered_date ?? '',
  }));

  return {
    policy_text: input.policy_text ?? '',
    request_message: input.request?.message ?? '',
    request_date: input.request?.date ?? '',
    order_items: items,
  };
}

export function questions(input) {
  const items = input.order?.items ?? [];

  const itemCriteria = {};
  items.forEach((item, i) => {
    const finalSale = item.final_sale ? ', final sale' : '';
    itemCriteria[`item_${i}`] =
      `${item.name} (SKU ${item.sku}, category ${item.category}${finalSale}, delivered ${item.delivered_date})`;
  });
  itemCriteria.ambiguous =
    'The message does not identify one specific item, or identifies more than one item as the return.';

  const dayChoices = {};
  for (let d = 1; d <= 90; d += 1) {
    dayChoices[String(d)] = null;
  }

  const defectiveDayChoices = {
    ...dayChoices,
    '0': 'No separate defective-electronics return window is stated.',
  };

  return {
    requested_item: {
      type: 'choice',
      instructions:
        'Which item in `order_items` is the customer asking to return in `request_message`? Choose the item named or described as the return. Other items mentioned only as being kept are not the answer.',
      criteria: itemCriteria,
    },
    general_window_days: {
      type: 'choice',
      instructions:
        'How many days is the standard return window for most items stated in `policy_text`? Answer with the number only.',
      criteria: dayChoices,
    },
    electronics_window_days: {
      type: 'choice',
      instructions:
        'How many days is the return window for unopened electronics stated in `policy_text`? Answer with the number only.',
      criteria: dayChoices,
    },
    electronics_defective_window_days: {
      type: 'choice',
      instructions:
        'How many days is the return window for defective electronics stated in `policy_text`? If the policy does not state a separate defective-electronics window, choose 0.',
      criteria: defectiveDayChoices,
    },
    delivery_day_counts: {
      type: 'noul',
      instructions:
        'Does `policy_text` state that the delivery day counts as day 1 of the return window?',
      criteria: {
        true: 'It says the delivery day counts as day 1, or the return window includes the delivery day.',
        false: 'It states a different convention or does not specify.',
      },
    },
    is_defective: {
      type: 'noul',
      instructions:
        'Does `request_message` state that the item the customer asks to return is defective, broken, damaged, faulty, or not working?',
      criteria: {
        true: 'The message says the item is defective, broken, damaged, faulty, or not working.',
        false: 'The message does not say the item is defective or broken.',
      },
    },
    was_unopened: {
      type: 'noul',
      instructions:
        'Does `request_message` state that the item the customer asks to return is unopened, sealed, never opened, or never used?',
      criteria: {
        true: 'The message says the item is unopened, sealed, never opened, or never used.',
        false: 'The message does not say the item is unopened or sealed.',
      },
    },
  };
}

export function decide(answers, input) {
  if (!answers) return { eligible: 'abstain' };

  const requestedChoice = topChoice(answers.requested_item, ITEM_PROB_THRESHOLD);
  if (!requestedChoice || requestedChoice === 'ambiguous') {
    return { eligible: 'abstain' };
  }

  const itemIndex = Number(requestedChoice.startsWith('item_')
    ? requestedChoice.slice('item_'.length)
    : requestedChoice);
  const item = input.order?.items?.[itemIndex];
  if (!item) return { eligible: 'abstain' };

  if (item.final_sale) return { eligible: 'no' };
  if (isGiftCard(item)) return { eligible: 'no' };

  const generalDays = parsePolicyDays(answers.general_window_days);
  const electronicsDays = parsePolicyDays(answers.electronics_window_days);
  const defectiveElectronicsDays = parsePolicyDays(answers.electronics_defective_window_days);

  if (
    generalDays == null ||
    electronicsDays == null ||
    defectiveElectronicsDays == null
  ) {
    return { eligible: 'abstain' };
  }

  const inclusive = tri(answers.delivery_day_counts?.noul);
  if (inclusive === 'abstain') return { eligible: 'abstain' };

  const delivered = parseDate(item.delivered_date);
  const requested = parseDate(input.request?.date);
  if (!delivered || !requested) return { eligible: 'abstain' };
  if (requested < delivered) return { eligible: 'abstain' };

  const elapsed = Math.round((requested - delivered) / 86400000) + (inclusive ? 1 : 0);

  const isElectronics = (item.category || '').toLowerCase() === 'electronics';

  if (!isElectronics) {
    return { eligible: elapsed <= generalDays ? 'yes' : 'no' };
  }

  const defective = tri(answers.is_defective?.noul);
  const unopened = tri(answers.was_unopened?.noul);

  if (defective === 'abstain') return { eligible: 'abstain' };

  if (defective) {
    if (defectiveElectronicsDays === 0) return { eligible: 'abstain' };
    return { eligible: elapsed <= defectiveElectronicsDays ? 'yes' : 'no' };
  }

  if (unopened === 'abstain') return { eligible: 'abstain' };
  if (!unopened) return { eligible: 'no' };

  return { eligible: elapsed <= electronicsDays ? 'yes' : 'no' };
}

function topChoice(answer, threshold) {
  if (!answer || typeof answer.choice !== 'string' || !answer.probabilities) return null;
  const p = answer.probabilities[answer.choice];
  return typeof p === 'number' && p >= threshold ? answer.choice : null;
}

function parsePolicyDays(answer) {
  const choice = topChoice(answer, POLICY_PROB_THRESHOLD);
  if (choice == null) return null;
  const n = Number(choice);
  return Number.isFinite(n) ? n : null;
}

function tri(noul, threshold = FACT_PROB_THRESHOLD) {
  if (typeof noul !== 'number' || Number.isNaN(noul)) return 'abstain';
  if (noul >= threshold) return true;
  if (noul <= 1 - threshold) return false;
  return 'abstain';
}

function parseDate(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function isGiftCard(item) {
  const hay = `${item.name ?? ''} ${item.category ?? ''} ${item.sku ?? ''}`;
  return /gift[-_ ]?cards?/i.test(hay);
}
