// Returns-eligibility question map for Jev (TypeSafe System One).
//
// Every clause of the policy maps to a carrier (checked while writing, per the map checklist):
//  - "most items can be returned within N days of delivery" -> `standard_window_days` (read exactly) + day count in code
//  - "electronics within N days if unopened, unless defective (then M days)"
//       -> item.category (code), `electronics_window_days`, `defective_window_days`,
//          `opened_status`, `states_defective`
//  - "final sale and gift cards cannot be returned" -> item.final_sale (code), `is_gift_card`
//  - "delivery day counts as day 1" -> `delivery_day_counts_day_one`
// All date arithmetic and window comparisons happen in code; Jev only reports what is true.
// GATE is a placeholder: fit it per question with jev-audit before trusting it.
const GATE = 0.8;      // choice gates (start value; measure it)
const YES = 0.7;       // noul counted as true
const NO = 0.3;        // noul counted as false
const DAY_OPTIONS = ['7', '14', '15', '30', '45', '60', '90'];
const NONE_KEY = 'no_single_item';

export function buildState(input) {
  // Send the whole case, source included; no pre-filtering of items.
  return {
    policy_text: input.policy_text,
    order: input.order,
    request: input.request,
  };
}

export function questions(input) {
  const items = input.order?.items ?? [];
  const itemCriteria = {};
  items.forEach((it, i) => {
    itemCriteria[String(i)] = `${it.sku ?? 'item ' + (i + 1)} — ${it.name ?? 'unnamed item'}`;
  });
  itemCriteria[NONE_KEY] =
    'The message asks to return no single item from `order.items`, or it is not clear which item it means (it asks about several items, or names a product that is not in the order).';
  const dayCriteria = Object.fromEntries(DAY_OPTIONS.map((d) => [d, `${d} days after delivery`]));
  return {
    target_item: {
      type: 'choice',
      instructions:
        'Which item in `order.items` does the message in `request.message` ask to return? The options describe the items by SKU and name. Ignore items the message only mentions keeping or being happy with. If the message asks to return more than one item, or names something not in the order, choose the last option.',
      criteria: itemCriteria,
    },
    standard_window_days: {
      type: 'choice',
      instructions: 'According to `policy_text`, within how many days of delivery can most items be returned?',
      criteria: dayCriteria,
    },
    electronics_window_days: {
      type: 'choice',
      instructions:
        'According to `policy_text`, within how many days of delivery can electronics be returned when they are not defective? If `policy_text` sets no special window for electronics, choose same_as_standard.',
      criteria: {
        ...dayCriteria,
        same_as_standard: 'No special window for electronics in `policy_text`; the standard window applies.',
      },
    },
    defective_window_days: {
      type: 'choice',
      instructions:
        'According to `policy_text`, within how many days of delivery can a defective item be returned? If `policy_text` sets no special window for defective items, choose same_as_standard.',
      criteria: {
        ...dayCriteria,
        same_as_standard: 'No special window for defective items in `policy_text`; the standard window applies.',
      },
    },
    delivery_day_counts_day_one: {
      type: 'noul',
      instructions: 'Does `policy_text` state that the delivery day counts as day 1 of the return window?',
      criteria: { true: 'the policy text says the delivery day is day 1', false: 'it does not say that' },
    },
    is_gift_card: {
      type: 'noul',
      instructions:
        "Is the item in `order.items` that `request.message` asks to return a gift card or similar stored-value card? Judge only from that item's `name` and `category` fields.",
      criteria: { true: 'the item is a gift card', false: 'the item is not a gift card' },
    },
    opened_status: {
      type: 'choice',
      instructions:
        'What does the message in `request.message` say about whether the item it asks to return has been opened?',
      criteria: {
        states_unopened: 'The message states the item is unopened, unused or still sealed in its packaging.',
        states_opened: 'The message states the item has been opened, used, or taken out of its packaging.',
        says_nothing: 'The message says nothing about whether the item has been opened.',
      },
    },
    states_defective: {
      type: 'noul',
      instructions:
        'Does the message in `request.message` state that the item it asks to return is defective, damaged, faulty, or not working?',
      criteria: { true: 'the message states a defect', false: 'the message states no defect' },
    },
  };
}

function readWindow(a, fallback) {
  if (a?.type !== 'choice') return null;
  if ((a.probabilities?.[a.choice] ?? 0) < GATE) return null;
  if (a.choice === 'same_as_standard') return fallback ?? null;
  const n = Number(a.choice);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function readOpened(a) {
  if (a?.type !== 'choice') return null;
  if ((a.probabilities?.[a.choice] ?? 0) < GATE) return null;
  if (a.choice === 'states_unopened') return false;
  if (a.choice === 'states_opened') return true;
  return null; // says_nothing, or below the gate
}

function claimState(a) {
  const p = a?.noul;
  if (p == null) return 'unknown';
  if (p >= YES) return 'yes';
  if (p <= NO) return 'no';
  return 'unknown';
}

export function decide(answers, input) {
  const ABSTAIN = { eligible: 'abstain' };

  // Which item, with a gate on the picked label.
  const t = answers.target_item;
  if (t?.type !== 'choice' || t.choice === NONE_KEY) return ABSTAIN;
  if ((t.probabilities?.[t.choice] ?? 0) < GATE) return ABSTAIN;
  const item = input.order?.items?.[Number(t.choice)];
  if (!item?.delivered_date) return ABSTAIN;

  // Windows, read from the policy text.
  const std = readWindow(answers.standard_window_days);
  if (std == null) return ABSTAIN;
  const elecWin = readWindow(answers.electronics_window_days, std);
  const defWin = readWindow(answers.defective_window_days, std);
  if ((answers.delivery_day_counts_day_one?.noul ?? 0) < YES) return ABSTAIN;

  // Exclusions.
  if (item.final_sale === true) return { eligible: 'no' };
  const gc = answers.is_gift_card?.noul;
  if (gc == null) return ABSTAIN;
  if (gc >= YES) return { eligible: 'no' };
  if (gc > NO) return ABSTAIN;

  // Day arithmetic in code: delivery day counts as day 1.
  const delivered = Date.parse(item.delivered_date);
  const requested = Date.parse(input.request?.date);
  if (!Number.isFinite(delivered) || !Number.isFinite(requested)) return ABSTAIN;
  const days = Math.round((requested - delivered) / 86400000) + 1;
  if (days < 1) return ABSTAIN;

  const isElectronics = /electron/i.test(String(item.category ?? ''));
  if (!isElectronics) return { eligible: days <= std ? 'yes' : 'no' };

  // Electronics branch.
  if (elecWin == null || defWin == null) return ABSTAIN;
  const defective = claimState(answers.states_defective);
  if (defective === 'yes') return { eligible: days <= defWin ? 'yes' : 'no' };
  if (days > Math.max(elecWin, defWin)) return { eligible: 'no' };
  if (elecWin === std && defWin === std) return { eligible: days <= std ? 'yes' : 'no' }; // no special electronics rule
  const opened = readOpened(answers.opened_status);
  if (opened === false) return { eligible: days <= elecWin ? 'yes' : 'no' };
  if (opened === true) return defective === 'no' ? { eligible: 'no' } : ABSTAIN; // maybe defective: a person decides
  return ABSTAIN; // opened status unverified where the policy requires it
}
