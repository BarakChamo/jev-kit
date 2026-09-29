// Jev map: per-item return eligibility from a free-text request against a multi-item order.

function keyFor(sku) {
  return sku.replace(/[^a-zA-Z0-9]/g, '_');
}

function elapsedDays(deliveredDateStr, requestDateStr) {
  const delivered = new Date(deliveredDateStr + 'T00:00:00Z');
  const requested = new Date(requestDateStr + 'T00:00:00Z');
  const diffDays = Math.round((requested - delivered) / 86400000);
  return diffDays + 1; // delivery day counts as day 1
}

function dayOptions(max) {
  const criteria = {};
  for (let n = 1; n <= max; n++) criteria[String(n)] = `${n} days`;
  return criteria;
}
const DAY_CRITERIA = dayOptions(180);

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    order_id: input.order.order_id,
    items: input.order.items.map((it) => ({
      sku: it.sku,
      name: it.name,
      category: it.category,
      final_sale: it.final_sale,
      price: it.price,
      delivered_date: it.delivered_date,
    })),
    request_date: input.request.date,
    message: input.request.message,
  };
}

export function questions(input) {
  const q = {
    unclear_request: {
      type: 'noul',
      instructions:
        'Is the customer message in `message` too unclear, contradictory, or ambiguous to tell which single item in `items` the customer wants to return, or to tell its condition well enough to decide?',
      criteria: {
        true: 'cannot tell which item, or key facts about it, from the message',
        false: 'the message clearly points to one item and states enough about it',
      },
    },
  };

  for (const item of input.order.items) {
    const k = keyFor(item.sku);
    const label = `"${item.name}" (sku ${item.sku})`;

    q[`requested_${k}`] = {
      type: 'noul',
      instructions: `Does the customer message in \`message\` ask to return the item ${label}?`,
      criteria: {
        true: 'the message asks to return this specific item',
        false: 'the message does not ask to return this item (not mentioned, mentioned only in passing, or explicitly being kept)',
      },
    };

    q[`defective_claim_${k}`] = {
      type: 'noul',
      instructions: `Does the customer message in \`message\` claim that the item ${label} is defective, broken, damaged, or not working?`,
      criteria: {
        true: 'the message claims this item is defective/broken/not working',
        false: 'the message makes no such claim about this item',
      },
    };

    q[`opened_claim_${k}`] = {
      type: 'choice',
      instructions: `Does the customer message in \`message\` say anything about whether the item ${label} has been opened, used, or is still sealed/unused?`,
      criteria: {
        unopened: 'the message states or clearly implies this item has not been opened or used',
        opened: 'the message states or implies this item has been opened, used, or tried',
        unstated: "the message says nothing about this item's opened/used condition",
      },
    };

    q[`window_days_${k}`] = {
      type: 'choice',
      instructions: `According to the return policy in \`policy_text\`, how many days after delivery can an item in category "${item.category}" (the category of ${label}) normally be returned, assuming it is not defective? Read the number the policy states; do not compute anything.`,
      criteria: DAY_CRITERIA,
    };

    q[`defective_window_days_${k}`] = {
      type: 'choice',
      instructions: `According to the return policy in \`policy_text\`, how many days after delivery can an item in category "${item.category}" (the category of ${label}) be returned if it IS defective? If the policy gives no separate window for defective items in this category, answer the same number as the normal (non-defective) window.`,
      criteria: DAY_CRITERIA,
    };

    q[`requires_unopened_${k}`] = {
      type: 'noul',
      instructions: `According to the return policy in \`policy_text\`, must an item in category "${item.category}" (the category of ${label}) be unopened/unused to qualify for the normal (non-defective) return window?`,
      criteria: {
        true: 'the policy requires the item to be unopened/unused for that window',
        false: 'the policy has no such requirement for that category',
      },
    };
  }

  return q;
}

function resolveBool(prob, highT = 0.7, lowT = 0.3) {
  if (prob >= highT) return true;
  if (prob <= lowT) return false;
  return null;
}

export function decide(answers, input) {
  if (answers.unclear_request.noul >= 0.6) return { eligible: 'abstain' };

  const items = input.order.items;
  let best = null;
  let bestProb = -Infinity;
  let secondProb = -Infinity;
  for (const item of items) {
    const p = answers[`requested_${keyFor(item.sku)}`].noul;
    if (p > bestProb) {
      secondProb = bestProb;
      bestProb = p;
      best = item;
    } else if (p > secondProb) {
      secondProb = p;
    }
  }
  if (!best || bestProb < 0.55 || bestProb - secondProb < 0.15) {
    return { eligible: 'abstain' };
  }

  if (best.final_sale) return { eligible: 'no' };

  const k = keyFor(best.sku);
  const windowAns = answers[`window_days_${k}`];
  const defWindowAns = answers[`defective_window_days_${k}`];
  if (windowAns.confidence < 0.5 || defWindowAns.confidence < 0.5) {
    return { eligible: 'abstain' };
  }
  const windowBase = parseInt(windowAns.choice, 10);
  const windowDefective = parseInt(defWindowAns.choice, 10);

  const elapsed = elapsedDays(best.delivered_date, input.request.date);

  const isDefective = resolveBool(answers[`defective_claim_${k}`].noul);
  const requiresUnopened = resolveBool(answers[`requires_unopened_${k}`].noul);

  const openedAns = answers[`opened_claim_${k}`];
  let isUnopened = null;
  if (openedAns.confidence >= 0.55) {
    if (openedAns.choice === 'unopened') isUnopened = true;
    else if (openedAns.choice === 'opened') isUnopened = false;
  }

  const eligibleDefectivePath = elapsed <= windowDefective;

  let nonDefectiveOk;
  if (requiresUnopened === false) {
    nonDefectiveOk = elapsed <= windowBase;
  } else if (requiresUnopened === true) {
    if (isUnopened === true) nonDefectiveOk = elapsed <= windowBase;
    else if (isUnopened === false) nonDefectiveOk = false;
    else nonDefectiveOk = null;
  } else {
    nonDefectiveOk = elapsed > windowBase ? false : null;
  }

  let result;
  if (isDefective === true) {
    result = eligibleDefectivePath;
  } else if (isDefective === false) {
    result = nonDefectiveOk;
  } else {
    result = nonDefectiveOk !== null && nonDefectiveOk === eligibleDefectivePath ? nonDefectiveOk : null;
  }

  if (result === null) return { eligible: 'abstain' };
  return { eligible: result ? 'yes' : 'no' };
}
