// map.mjs — returns-eligibility question map for Jev (TypeSafe System One).
// Design notes (per the jev-questions rules):
//  - Rule 1/2: the state carries the full policy, order and request; every question names its field.
//  - Rule 8/9: Jev never compares dates or does arithmetic. It reads the policy's stated windows
//    exactly as choices; code computes the day count and does the comparison.
//  - Rule 10: which item the customer means is one `choice` over *all* items (no pre-filter),
//    with explicit "multiple" / "no item" options that abstain.
//  - Rule 12/13: eligibility is derived in code from individually gated facts; unsure never becomes yes.
//  - Rule 14/15: abstain paths plus a detector for claimed prior approval / exceptions.
//  - ACT thresholds are placeholders: fit them on ~30 labelled cases (jev-eval) before trusting.

const ACT = 0.7;                 // gate on the probability of the label we act on
const ABSTAIN = { eligible: 'abstain' };
const DAY_OPTS = [7, 14, 15, 30, 45, 60, 90]; // values a policy could state

const dayCriteria = Object.fromEntries(DAY_OPTS.map((d) => [String(d), `${d} days after delivery`]));
dayCriteria.never = 'the policy does not allow that kind of item to be returned at all';

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    order: input.order,
    request: input.request,
  };
}

export function questions(input) {
  // Cap so the `which_item` choice stays under 255 options; larger orders fall through to abstain.
  const items = input.order.items.slice(0, 251);
  const qs = {
    which_item: {
      type: 'choice',
      instructions:
        'Which single item from `order.items` is the customer asking to return in `request.message`? ' +
        'Match by the item name or description. An item the customer says they are keeping is not being asked to be returned. ' +
        'If the message asks to return more than one item from the order, choose multiple_items. ' +
        'If it does not clearly ask to return any item in `order.items`, choose no_item.',
      criteria: {
        ...Object.fromEntries(
          items.map((it, i) => [String(i), `the customer is asking to return: ${it.name} (sku ${it.sku})`])
        ),
        multiple_items: 'the message asks to return more than one item from the order',
        no_item: 'the message does not clearly ask to return any item in `order.items`',
      },
    },
    claims_defective: {
      type: 'noul',
      instructions:
        'Does `request.message` state that the item the customer wants to return is defective, damaged, faulty or not working?',
      criteria: {
        true: 'the message asserts the item is defective or damaged',
        false: 'the message does not say the item is defective',
      },
    },
    claims_unopened: {
      type: 'noul',
      instructions:
        'Does `request.message` state that the item the customer wants to return is unopened, unused or still in its original sealed condition?',
      criteria: {
        true: 'the message asserts the item is unopened or unused',
        false: 'the message does not say the item is unopened',
      },
    },
    mentions_opened: {
      type: 'noul',
      instructions:
        'Does `request.message` state that the item the customer wants to return has been opened or used?',
      criteria: {
        true: 'the message asserts the item has been opened or used',
        false: 'the message does not say the item has been opened',
      },
    },
    claims_exception: {
      type: 'noul',
      instructions:
        'Does `request.message` claim that someone from the company has already approved this return, or promised an exception to `policy_text`?',
      criteria: {
        true: 'the message asserts prior approval or that an exception was granted',
        false: 'no such claim',
      },
    },
    policy_excludes_final_sale: {
      type: 'noul',
      instructions: 'Does `policy_text` say that items marked final sale cannot be returned?',
      criteria: {
        true: 'the policy excludes final sale items from returns',
        false: 'the policy does not exclude final sale items',
      },
    },
  };
  items.forEach((it, i) => {
    qs[`window_${i}`] = {
      type: 'choice',
      instructions:
        `According to \`policy_text\`, how many days after delivery may a customer return an item of the ` +
        `category named in \`order.items[${i}].category\` when it is not defective?`,
      criteria: dayCriteria,
    };
    qs[`defective_window_${i}`] = {
      type: 'choice',
      instructions:
        `According to \`policy_text\`, how many days after delivery may a customer return a defective ` +
        `item of the category named in \`order.items[${i}].category\`?`,
      criteria: dayCriteria,
    };
    qs[`requires_unopened_${i}`] = {
      type: 'noul',
      instructions:
        `Does \`policy_text\` require an item of the category named in \`order.items[${i}].category\` ` +
        `to be unopened for a return when it is not defective?`,
      criteria: {
        true: 'the policy requires unopened for that category when not defective',
        false: 'the policy does not require unopened for that category',
      },
    };
  });
  return qs;
}

// Delivery day counts as day 1 (per the policy's own convention; the count is computed in code).
function dayCount(delivered, request) {
  const d = Date.parse(delivered + 'T00:00:00Z');
  const r = Date.parse(request + 'T00:00:00Z');
  if (Number.isNaN(d) || Number.isNaN(r)) return null;
  const n = Math.round((r - d) / 86400000) + 1;
  return n > 0 ? n : null;
}

export function decide(answers, input) {
  // 1. Which item? Gate the pick; "multiple" or "none" goes to a person.
  const w = answers.which_item;
  if (!w || w.type !== 'choice') return ABSTAIN;
  if (w.choice === 'multiple_items' || w.choice === 'no_item') return ABSTAIN;
  if ((w.probabilities?.[w.choice] ?? 0) < ACT) return ABSTAIN;
  const idx = Number(w.choice);
  const item = input.order.items[idx];
  if (!item || isNaN(idx)) return ABSTAIN;

  // 2. Final sale exclusion (policy fact + structured flag).
  if (item.final_sale) {
    const x = answers.policy_excludes_final_sale?.noul ?? 0.5;
    if (x > 0.5) return { eligible: 'no' };
    if (x >= 0.3) return ABSTAIN;
  }

  // 3. Day count, computed in code.
  const days = dayCount(item.delivered_date, input.request.date);
  if (days === null) return ABSTAIN;

  const p = (q) => (q && q.type === 'choice' ? q.probabilities?.[q.choice] ?? 0 : 0);
  const defective = answers.claims_defective?.noul ?? 0;

  // 4. Pick the window that applies: defective route vs normal route.
  let window;
  if (defective > 0.6) {
    const q = answers[`defective_window_${idx}`];
    if (!q || q.type !== 'choice') return ABSTAIN;
    if (q.choice === 'never') return { eligible: 'no' };
    if (p(q) < ACT) return ABSTAIN;
    window = Number(q.choice);
  } else if (defective < 0.4) {
    const q = answers[`window_${idx}`];
    if (!q || q.type !== 'choice') return ABSTAIN;
    if (q.choice === 'never') return { eligible: 'no' };
    if (p(q) < ACT) return ABSTAIN;
    // Unopened condition, only when the policy requires it for this category.
    if ((answers[`requires_unopened_${idx}`]?.noul ?? 0) > 0.5) {
      if ((answers.claims_unopened?.noul ?? 0) < 0.5) {
        if ((answers.mentions_opened?.noul ?? 0) > 0.5) return { eligible: 'no' }; // customer says it's opened
        return ABSTAIN; // condition required but unstated: a person should ask
      }
    }
    window = Number(q.choice);
  } else {
    return ABSTAIN; // unclear whether the customer claims a defect
  }

  // 5. Compare in code, never in Jev.
  const eligible = days <= window;

  // 6. Detector: a claimed prior approval/exception vetoes an automatic "yes".
  if (eligible && (answers.claims_exception?.noul ?? 0) > 0.5) return ABSTAIN;

  return { eligible: eligible ? 'yes' : 'no' };
}
