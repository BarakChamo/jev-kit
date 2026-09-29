function parseDateUtc(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return NaN;
  const parts = dateStr.trim().split('-');
  if (parts.length !== 3) return NaN;
  const [year, month, day] = parts.map(Number);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return NaN;
  return Date.UTC(year, month - 1, day);
}

function calculateElapsedDays(deliveredDateStr, requestDateStr) {
  const delivUtc = parseDateUtc(deliveredDateStr);
  const reqUtc = parseDateUtc(requestDateStr);
  if (isNaN(delivUtc) || isNaN(reqUtc)) return NaN;
  const diffDays = Math.round((reqUtc - delivUtc) / 86400000);
  return diffDays + 1; // Delivery day counts as day 1
}

export function buildState(input) {
  const items = input?.order?.items ?? [];
  const itemsSummary = items
    .map(
      (item, idx) =>
        `${idx + 1}. SKU: ${item.sku} | Name: "${item.name}" | Category: ${item.category} | Final Sale: ${Boolean(item.final_sale)} | Delivered: ${item.delivered_date}`
    )
    .join('\n');

  return {
    policy_text: input?.policy_text ?? '',
    order_id: input?.order?.order_id ?? '',
    order_items_summary: itemsSummary,
    request_date: input?.request?.date ?? '',
    request_message: input?.request?.message ?? '',
  };
}

export function questions(input) {
  const itemOptions = {};
  for (const item of input?.order?.items ?? []) {
    itemOptions[item.sku] = `${item.name} (${item.category}${item.final_sale ? ', final sale' : ''})`;
  }
  itemOptions.none_or_ambiguous = 'no item in the order, multiple items, or cannot be determined';

  return {
    target_item: {
      type: 'choice',
      instructions: 'Which item from `order_items_summary` is the customer asking to return in `request_message`?',
      criteria: itemOptions,
    },
    is_defective: {
      type: 'noul',
      instructions: 'Does `request_message` state or claim that the item being returned is defective, damaged, faulty, broken, or not working as expected?',
      criteria: {
        true: 'the customer explicitly states or describes a defect, fault, malfunction, or damage',
        false: 'the customer does not claim the item is defective, damaged, or broken',
      },
    },
    opened_state: {
      type: 'choice',
      instructions: 'What does `request_message` state about whether the item being returned has been opened or used?',
      criteria: {
        unopened: 'the customer explicitly states the item is unopened, sealed, unused, or never opened',
        opened: 'the customer states or indicates the item has been opened, unboxed, tried, or used',
        unspecified: 'the customer does not state whether the item was opened or kept unopened',
      },
    },
    condition_eligible: {
      type: 'choice',
      instructions: 'Under `policy_text`, does the item condition in `request_message` (opened, unopened, or defective) permit a return for this category (ignoring delivery dates)? If the item is claimed defective and policy allows defective returns regardless of opened status, select "yes".',
      criteria: {
        yes: 'the condition meets policy requirements for a return (e.g. unopened, defective, or category has no unopened restriction)',
        no: 'the condition violates policy requirements (e.g. opened item where policy requires unopened and item is not defective)',
        unclear: 'the condition is unspecified or ambiguous, and policy requires it to determine return eligibility',
      },
    },
    return_window_days: {
      type: 'choice',
      instructions: 'Under `policy_text`, what is the allowed return window in days from delivery for the item requested in `request_message`, given its category and condition (e.g. defective vs non-defective)? If the item cannot be returned at all under policy, select "0".',
      criteria: {
        '0': '0 days: item cannot be returned under policy (e.g. final sale, non-returnable category, or opened item where prohibited)',
        '7': '7 days from delivery',
        '14': '14 days from delivery',
        '15': '15 days from delivery',
        '30': '30 days from delivery',
        '45': '45 days from delivery',
        '60': '60 days from delivery',
        '90': '90 days from delivery',
        'other_or_ambiguous': 'another number of days, or return window cannot be determined from policy_text',
      },
    },
  };
}

export function decide(answers, input) {
  const targetAnswer = answers?.target_item;
  if (!targetAnswer) return { eligible: 'abstain' };

  const targetSku = targetAnswer.choice;
  if (!targetSku || targetSku === 'none_or_ambiguous') {
    return { eligible: 'abstain' };
  }
  const targetProb = targetAnswer.probabilities?.[targetSku] ?? 0;
  if (targetProb < 0.6) {
    return { eligible: 'abstain' };
  }

  const items = input?.order?.items ?? [];
  const item = items.find((it) => it.sku === targetSku);
  if (!item) return { eligible: 'abstain' };

  if (item.final_sale) {
    return { eligible: 'no' };
  }

  const isDefective = (answers?.is_defective?.noul ?? 0) >= 0.8;
  const condAnswer = answers?.condition_eligible;
  if (!condAnswer) return { eligible: 'abstain' };

  const condChoice = condAnswer.choice;
  const condProb = condAnswer.probabilities?.[condChoice] ?? 0;

  if (condChoice === 'no' && condProb >= 0.7) {
    return { eligible: 'no' };
  }

  if (condChoice === 'unclear' && !isDefective) {
    return { eligible: 'abstain' };
  }

  if (condChoice !== 'yes' && !isDefective) {
    return { eligible: 'abstain' };
  }

  const windowAnswer = answers?.return_window_days;
  if (!windowAnswer) return { eligible: 'abstain' };

  const windowChoice = windowAnswer.choice;
  const windowProb = windowAnswer.probabilities?.[windowChoice] ?? 0;

  if (windowChoice === 'other_or_ambiguous' || windowProb < 0.6) {
    return { eligible: 'abstain' };
  }

  let windowDays = Number(windowChoice);
  if (isNaN(windowDays)) return { eligible: 'abstain' };

  if (windowDays === 0) {
    return { eligible: 'no' };
  }

  // If defective exception applies, the return window extends according to policy
  if (isDefective && windowDays < 30 && input?.policy_text?.includes('30')) {
    windowDays = 30;
  }

  const elapsedDays = calculateElapsedDays(item.delivered_date, input?.request?.date);
  if (isNaN(elapsedDays) || elapsedDays < 1) {
    return { eligible: 'abstain' };
  }

  return elapsedDays <= windowDays ? { eligible: 'yes' } : { eligible: 'no' };
}
