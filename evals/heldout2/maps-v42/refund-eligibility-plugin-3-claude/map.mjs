// Jev map: decide whether the item a customer asks about in a free-text
// return request is eligible for return under the order's returns policy.

const DAY_OPTIONS = [3, 5, 7, 10, 14, 15, 20, 21, 25, 30, 45, 60, 90, 120];

function windowCriteria(extra) {
  const c = {};
  for (const n of DAY_OPTIONS) {
    c[String(n)] = `policy_text states a return window of ${n} days from delivery for this item's category (not counting any defective-item exception)`;
  }
  c.never = 'policy_text states this item\'s category or type (e.g. final sale, gift card, or an explicitly excluded category) can never be returned, regardless of condition';
  Object.assign(c, extra || {});
  return c;
}

function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function windowDaysFromChoice(choice) {
  if (choice === 'never') return -1;
  const n = parseInt(choice, 10);
  return Number.isFinite(n) ? n : -1;
}

function withinWindow(deliveredDateStr, requestDateStr, windowDays) {
  if (!Number.isFinite(windowDays) || windowDays < 0) return false;
  const delivered = new Date(deliveredDateStr + 'T00:00:00Z');
  const request = new Date(requestDateStr + 'T00:00:00Z');
  const elapsed = daysBetween(delivered, request) + 1; // delivery day counts as day 1
  return elapsed <= windowDays;
}

function noulState(p, high = 0.7, low = 0.3) {
  if (typeof p !== 'number') return null;
  if (p >= high) return true;
  if (p <= low) return false;
  return null;
}

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    items: input.order.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      category: i.category,
      final_sale: i.final_sale,
      delivered_date: i.delivered_date,
    })),
    request_date: input.request.date,
    request_message: input.request.message,
  };
}

export function questions(input) {
  const items = input.order.items;
  const q = {};

  q.target_item = {
    type: 'choice',
    instructions:
      'Based only on state.request_message, which single item from state.items is the customer asking to return? Choose "unclear" if the message does not clearly single out exactly one specific item from state.items for return.',
    criteria: Object.fromEntries([
      ...items.map((i) => [
        i.sku,
        `the message is asking to return the item named "${i.name}" (sku ${i.sku})`,
      ]),
      ['unclear', 'the message does not clearly single out exactly one item from state.items for return'],
    ]),
  };

  for (const i of items) {
    const desc = `an item with sku "${i.sku}" (name "${i.name}", category "${i.category}") in state.items`;

    q[`window_${i.sku}`] = {
      type: 'choice',
      instructions: `Based only on state.policy_text, what is the maximum number of days after delivery within which ${desc} can normally be returned, not counting any special exception for a defective item? Choose "never" if the policy states this item's category or type can never be returned at all.`,
      criteria: windowCriteria(),
    };

    q[`unopened_${i.sku}`] = {
      type: 'noul',
      instructions: `Based only on state.policy_text, does the normal (non-defective) return window for ${desc} require the item to be unopened or unused?`,
      criteria: {
        true: 'policy_text requires the item to be unopened/unused for the normal window to apply',
        false: 'policy_text does not require the item to be unopened/unused for the normal window to apply',
      },
    };

    q[`defect_exception_${i.sku}`] = {
      type: 'noul',
      instructions: `Based only on state.policy_text, does the policy grant an exception allowing return, or a longer window, specifically when ${desc} is defective?`,
      criteria: {
        true: 'policy_text states a defective-item exception for this category',
        false: 'policy_text states no defective-item exception for this category',
      },
    };

    q[`defect_window_${i.sku}`] = {
      type: 'choice',
      instructions: `If ${desc} is defective, based only on state.policy_text, what maximum number of days after delivery does the policy's defective-item exception allow for return? Choose "same_as_normal" if there is no separate defective-item exception, or it does not change the number of days from the normal window. Choose "never" if defective items of this category can still never be returned.`,
      criteria: windowCriteria({
        same_as_normal: 'no separate defective-item exception exists, or it does not change the number of days',
      }),
    };
  }

  q.claims_unopened = {
    type: 'noul',
    instructions:
      'Does state.request_message claim that the item the customer wants to return is unopened, unused, or still sealed?',
    criteria: {
      true: 'the message claims the item is unopened/unused/sealed',
      false: 'the message makes no such claim',
    },
  };

  q.claims_opened = {
    type: 'noul',
    instructions:
      'Does state.request_message state that the item the customer wants to return has been opened, used, or is not in its original unused condition?',
    criteria: {
      true: 'the message states the item was opened/used',
      false: 'the message makes no such statement',
    },
  };

  q.claims_defective = {
    type: 'noul',
    instructions:
      'Does state.request_message claim or imply that the item the customer wants to return is defective, broken, malfunctioning, or not working?',
    criteria: {
      true: 'the message claims or implies the item is defective/broken/malfunctioning',
      false: 'the message makes no such claim',
    },
  };

  return q;
}

export function decide(answers, input) {
  const items = input.order.items;

  const tgt = answers.target_item;
  if (!tgt || tgt.choice === 'unclear' || tgt.confidence < 0.65) {
    return { eligible: 'abstain' };
  }
  const item = items.find((i) => i.sku === tgt.choice);
  if (!item) return { eligible: 'abstain' };

  if (item.final_sale) return { eligible: 'no' };

  const winAns = answers[`window_${item.sku}`];
  if (!winAns || winAns.confidence < 0.6) return { eligible: 'abstain' };
  const winDays = windowDaysFromChoice(winAns.choice);
  if (winDays === -1) return { eligible: 'no' };

  const withinBase = withinWindow(item.delivered_date, input.request.date, winDays);

  const unopenedReq = noulState(answers[`unopened_${item.sku}`]?.noul);
  const claimsUnopened = noulState(answers.claims_unopened?.noul);
  const claimsOpened = noulState(answers.claims_opened?.noul);
  const claimsDefective = noulState(answers.claims_defective?.noul);
  const defectExc = noulState(answers[`defect_exception_${item.sku}`]?.noul);
  const defectWinAns = answers[`defect_window_${item.sku}`];

  if (withinBase) {
    if (unopenedReq === false) return { eligible: 'yes' };
    if (unopenedReq === true) {
      if (claimsOpened === true) {
        // opened item cannot use the base window; fall through to defect path
      } else if (claimsUnopened === true) {
        return { eligible: 'yes' };
      } else {
        return { eligible: 'abstain' };
      }
    } else {
      return { eligible: 'abstain' };
    }
  }

  // Outside the base window, or opened when unopened was required: only a
  // defective-item exception can still make this eligible.
  if (defectExc === true) {
    if (!defectWinAns || defectWinAns.confidence < 0.6) return { eligible: 'abstain' };
    const defectWinDays =
      defectWinAns.choice === 'same_as_normal' ? winDays : windowDaysFromChoice(defectWinAns.choice);
    const withinDefect = withinWindow(item.delivered_date, input.request.date, defectWinDays);
    if (!withinDefect) return { eligible: 'no' };
    if (claimsDefective === true) return { eligible: 'yes' };
    if (claimsDefective === false) return { eligible: 'no' };
    return { eligible: 'abstain' };
  }
  if (defectExc === false) return { eligible: 'no' };
  return { eligible: 'abstain' };
}
