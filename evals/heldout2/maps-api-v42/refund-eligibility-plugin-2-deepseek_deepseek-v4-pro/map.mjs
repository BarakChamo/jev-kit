export function buildState(input) {
  const items = (input.order?.items || []).map((item, index) => ({
    index,
    sku: item.sku ?? '',
    name: item.name ?? '',
    category: item.category ?? '',
    final_sale: item.final_sale === true || item.final_sale === 'true',
    price: item.price ?? 0,
    delivered_date: item.delivered_date ?? '',
  }));

  return {
    policy_text: input.policy_text ?? '',
    order: {
      order_id: input.order?.order_id ?? '',
      items,
    },
    request: {
      date: input.request?.date ?? '',
      message: input.request?.message ?? '',
    },
  };
}

function dayOptions(policyText) {
  const nums = new Set([0, 7, 14, 15, 21, 30, 45, 60, 90, 365]);
  const matches = String(policyText || '').match(/\d+/g) || [];
  for (const m of matches) nums.add(Number(m));
  return Object.fromEntries(
    [...nums]
      .sort((a, b) => a - b)
      .map((n) => [String(n), `${n} days`])
  );
}

export function questions(input) {
  const items = input.order?.items || [];
  const q = {};

  const criteria = {};
  items.forEach((item, i) => {
    criteria[String(i)] = `The customer asks to return ${item.name} (SKU ${item.sku})`;
  });
  criteria.ambiguous =
    'The message asks about zero items, more than one item, or is genuinely ambiguous about which item to return';

  q.requested_item = {
    type: 'choice',
    instructions:
      'Which item in `order.items` is the customer asking to return in `request.message`? Use item names and SKUs. If it is not clear which single item, choose ambiguous.',
    criteria,
  };

  const options = dayOptions(input.policy_text);

  items.forEach((item, i) => {
    const itemRef = `\`order.items[${i}].name\` (SKU \`order.items[${i}].sku\`)`;

    q[`unopened_${i}`] = {
      type: 'noul',
      instructions: `Does \`request.message\` state, claim, or imply that ${itemRef} is unopened? Answer true only if the message says it was never opened, is unopened, is sealed, or something equivalent.`,
      criteria: {
        true: 'The message states the item is unopened, never opened, sealed, or similar.',
        false: 'The message does not say the item is unopened.',
      },
    };

    q[`defective_${i}`] = {
      type: 'noul',
      instructions: `Does \`request.message\` state, claim, or imply that ${itemRef} is defective, damaged, broken, or not working?`,
      criteria: {
        true: 'The message states the item is defective, damaged, broken, or not working.',
        false: 'The message does not say the item is defective or damaged.',
      },
    };

    q[`is_gift_card_${i}`] = {
      type: 'noul',
      instructions: `Is ${itemRef} a gift card, based on its name and category?`,
      criteria: {
        true: 'The item is a gift card.',
        false: 'The item is not a gift card.',
      },
    };

    q[`policy_standard_window_${i}`] = {
      type: 'choice',
      instructions: `How many days after delivery does \`policy_text\` give as the return window for ${itemRef} (category \`${item.category}\`) when the item is unopened and not defective? Use a category-specific rule if one is stated; otherwise use the general return window. Choose 0 if the policy makes this item not returnable.`,
      criteria: options,
    };

    q[`policy_defective_window_${i}`] = {
      type: 'choice',
      instructions: `How many days after delivery does \`policy_text\` give as the return window for a defective ${itemRef}? Use the defective-item rule if stated, otherwise the general return window. Choose 0 if the policy makes defective items of this category not returnable.`,
      criteria: options,
    };

    q[`policy_requires_unopened_${i}`] = {
      type: 'noul',
      instructions: `Does \`policy_text\` state that ${itemRef} (category \`${item.category}\`) must be unopened to be returned? Answer true only if unopened is stated as a condition for this item's return.`,
      criteria: {
        true: 'Unopened is stated as a condition for this item category.',
        false: 'No such unopened condition is stated.',
      },
    };
  });

  return q;
}

const GATE = 0.55;

function gateChoice(a) {
  if (!a || typeof a.choice !== 'string') return null;
  const p = a.probabilities?.[a.choice] ?? 1;
  return p >= GATE ? a.choice : null;
}

function gateNoul(a) {
  if (!a || typeof a.noul !== 'number') return null;
  if (a.noul >= GATE) return true;
  if (a.noul <= 1 - GATE) return false;
  return null;
}

function parseDate(s) {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetween(deliveredDate, requestDate) {
  const a = parseDate(deliveredDate);
  const b = parseDate(requestDate);
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000) + 1;
}

export function decide(answers, input) {
  const items = input.order?.items || [];
  if (!items.length) return { eligible: 'abstain' };

  const picked = gateChoice(answers.requested_item);
  if (picked === null || picked === 'ambiguous') return { eligible: 'abstain' };

  const idx = Number(picked);
  const item = items[idx];
  if (!item) return { eligible: 'abstain' };

  if (item.final_sale === true || item.final_sale === 'true') {
    return { eligible: 'no' };
  }

  const nameCategory = `${item.name || ''} ${item.category || ''}`.toLowerCase();
  if (/gift[ _-]?card/.test(nameCategory)) return { eligible: 'no' };

  const giftCard = gateNoul(answers[`is_gift_card_${idx}`]);
  if (giftCard === null) return { eligible: 'abstain' };
  if (giftCard) return { eligible: 'no' };

  const unopened = gateNoul(answers[`unopened_${idx}`]);
  const defective = gateNoul(answers[`defective_${idx}`]);
  if (unopened === null || defective === null) return { eligible: 'abstain' };

  const standardWindow = gateChoice(answers[`policy_standard_window_${idx}`]);
  const defectiveWindow = gateChoice(answers[`policy_defective_window_${idx}`]);
  const requiresUnopened = gateNoul(answers[`policy_requires_unopened_${idx}`]);

  if (standardWindow === null || defectiveWindow === null || requiresUnopened === null) {
    return { eligible: 'abstain' };
  }

  const standardDays = Number(standardWindow);
  const defectiveDays = Number(defectiveWindow);
  if (!Number.isFinite(standardDays) || !Number.isFinite(defectiveDays)) {
    return { eligible: 'abstain' };
  }

  let windowDays;
  if (defective) {
    windowDays = defectiveDays;
  } else if (!unopened && requiresUnopened) {
    return { eligible: 'no' };
  } else {
    windowDays = standardDays;
  }

  if (windowDays <= 0) return { eligible: 'no' };

  const diff = daysBetween(item.delivered_date, input.request?.date);
  if (diff === null) return { eligible: 'abstain' };
  if (diff <= 0) return { eligible: 'no' };

  return { eligible: diff <= windowDays ? 'yes' : 'no' };
}
