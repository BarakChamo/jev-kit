// Returns-eligibility map for multi-item order return requests.

const TARGET_CONF_T = 0.6;
const TRUE_T = 0.65;
const FALSE_T = 0.35;

const GENERAL_DAYS_DEFAULT = 30;
const ELECTRONICS_DAYS_DEFAULT = 15;
const ELECTRONICS_DEFECTIVE_DAYS_DEFAULT = 30;

function parseDateUTC(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function daysElapsed(deliveredDate, requestDate) {
  return Math.round((parseDateUTC(requestDate) - parseDateUTC(deliveredDate)) / 86400000) + 1;
}

function parsePolicyDays(policyText) {
  const general = policyText.match(/Most items can be returned within (\d+) days/i);
  const electronics = policyText.match(/Electronics can be returned within (\d+) days/i);
  const electronicsDefective = policyText.match(/defective[^)]*\(then within (\d+) days\)/i);
  return {
    general: general ? parseInt(general[1], 10) : GENERAL_DAYS_DEFAULT,
    electronics: electronics ? parseInt(electronics[1], 10) : ELECTRONICS_DAYS_DEFAULT,
    electronicsDefective: electronicsDefective
      ? parseInt(electronicsDefective[1], 10)
      : ELECTRONICS_DEFECTIVE_DAYS_DEFAULT,
  };
}

function isElectronics(item) {
  return /electronics/i.test(item.category);
}

function isGiftCard(item) {
  return /gift.?card/i.test(item.category) || /gift.?card/i.test(item.name);
}

export function buildState(input) {
  const items = input.order.items.map((it) => ({
    sku: it.sku,
    name: it.name,
    category: it.category,
    final_sale: it.final_sale,
    price: it.price,
    delivered_date: it.delivered_date,
    days_since_delivery: daysElapsed(it.delivered_date, input.request.date),
  }));
  return {
    policy_text: input.policy_text,
    order_id: input.order.order_id,
    items,
    request_date: input.request.date,
    request_message: input.request.message,
  };
}

export function questions(input) {
  const items = input.order.items;

  const targetCriteria = {};
  for (const it of items) {
    targetCriteria[it.sku] = `the item named "${it.name}" (SKU ${it.sku})`;
  }
  targetCriteria.unclear =
    'the message does not clearly single out exactly one item from `items` to return (it names none of them, names an item not in `items`, or asks about more than one item)';

  const qs = {
    target_item: {
      type: 'choice',
      instructions:
        'Read `request_message`. Which single item in `items` is the customer asking to return? Match by the item\'s description in the message, not by its position in the list.',
      criteria: targetCriteria,
    },
  };

  for (const it of items) {
    if (!isElectronics(it)) continue;
    qs[`defective_${it.sku}`] = {
      type: 'noul',
      instructions: `Does \`request_message\` describe the item named "${it.name}" (SKU ${it.sku}) as defective, broken, damaged, or otherwise not working?`,
      criteria: {
        true: `the message says or implies "${it.name}" is defective, broken, damaged, or malfunctioning`,
        false: `the message says nothing about "${it.name}" being defective, or says it works fine`,
      },
    };
    qs[`unopened_${it.sku}`] = {
      type: 'noul',
      instructions: `Does \`request_message\` state or imply that the item named "${it.name}" (SKU ${it.sku}) is unopened, unused, or still sealed?`,
      criteria: {
        true: `the message says or implies "${it.name}" is unopened, unused, still in its packaging, or new`,
        false: `the message says "${it.name}" was opened or used, or says nothing about its opened/unused state`,
      },
    };
  }

  return qs;
}

export function decide(answers, input) {
  const items = input.order.items;
  const target = answers.target_item;

  if (!target || target.choice === 'unclear' || target.confidence < TARGET_CONF_T) {
    return { eligible: 'abstain' };
  }

  const item = items.find((it) => it.sku === target.choice);
  if (!item) {
    return { eligible: 'abstain' };
  }

  if (item.final_sale || isGiftCard(item)) {
    return { eligible: 'no' };
  }

  const days = daysElapsed(item.delivered_date, input.request.date);
  const windows = parsePolicyDays(input.policy_text);

  if (!isElectronics(item)) {
    return { eligible: days <= windows.general ? 'yes' : 'no' };
  }

  const defectiveP = answers[`defective_${item.sku}`]?.noul ?? 0;
  const unopenedP = answers[`unopened_${item.sku}`]?.noul ?? 0;

  const defectiveTrue = defectiveP >= TRUE_T;
  const defectiveFalse = defectiveP <= FALSE_T;
  const unopenedTrue = unopenedP >= TRUE_T;
  const unopenedFalse = unopenedP <= FALSE_T;

  if (days > windows.electronicsDefective) {
    return { eligible: 'no' };
  }

  if (days > windows.electronics) {
    if (defectiveTrue) return { eligible: 'yes' };
    if (defectiveFalse) return { eligible: 'no' };
    return { eligible: 'abstain' };
  }

  if (unopenedTrue || defectiveTrue) return { eligible: 'yes' };
  if (unopenedFalse && defectiveFalse) return { eligible: 'no' };
  return { eligible: 'abstain' };
}
