// map.mjs — Jev (TypeSafe System One) question map for return-request eligibility.
//
// One request per case: one long state, many small scoped questions. Jev reads stated
// facts — which item `request.message` asks to return, what that message says about the
// item's condition, and the numbers, condition and exclusions `policy_text` states.
// Every date, window and comparison is computed here in code; gates act on the
// probability of the label acted on (never the confidence scalar), and an unsure case
// becomes "abstain", never "yes".
//
// Policy-clause coverage (re-check this list whenever the policy changes):
//   general window        -> general_window_days      + within() in code
//   electronics window    -> electronics_window_days  + item.category
//   unopened condition    -> unopened_required        + condition_<i>
//   defective window      -> defective_window_days   + defective_<i>
//   final-sale exclusion  -> final_sale_excluded      + item.final_sale
//   gift-card exclusion   -> gift_cards_excluded      + gift_card_<i>
//   delivery-day counting -> counting_convention      + day arithmetic in code

const DAY_OPTIONS = [5, 7, 10, 14, 15, 20, 21, 25, 28, 30, 45, 60, 90, 120, 180, 365];

// Starting-point gates; fit each on labelled cases with jev-audit before trusting them.
const GATES = {
  item: 0.75, // the item picked is the one the message asks to return
  counting: 0.7, // how the policy counts the window
  policy: 0.8, // a window in days, as stated
  condition: 0.6, // what the message says about the item being opened
  defective: 0.6, // the message states a defect
  giftCard: 0.6, // the item is a gift card
};

const ABSTAIN = { eligible: 'abstain' };

const GIFT_CARD_RE =
  /\bgift\s*card\b|\bgiftcard\b|\be-?gift\b|\bgift\s*voucher\b|\bstore\s*credit\b|\bprepaid\s*card\b/i;

const esc = (s) => String(s ?? '').replace(/`/g, "'");
const dayCriteria = () =>
  Object.fromEntries(DAY_OPTIONS.map((d) => [String(d), `${d} days after delivery`]));

export function buildState(input) {
  return {
    policy_text: input.policy_text, // the policy verbatim: the source of every rule
    order: input.order, // the whole order, every item: no pre-filtering
    request: input.request, // the request date and the customer's message, unedited
  };
}

export function questions(input) {
  const items = input.order?.items ?? [];

  const q = {
    // One choice over every item picks the referent (a noul per item would let a
    // mentioned-but-kept item win); "unclear" is the abstain option.
    which_item: {
      type: 'choice',
      instructions:
        'Which single item in `order.items` does the customer ask to RETURN in `request.message`? An item the customer mentions only to say they are keeping it or like it does not count.',
      criteria: {
        ...Object.fromEntries(items.map((it, i) => [String(i), `${it.name} (SKU ${it.sku})`])),
        multiple: 'the message asks to return more than one item',
        unclear:
          'the message does not clearly identify one single item in `order.items` to return: it names no item, more than one item fits equally well, or it names an item that is not in the order',
      },
    },

    counting_convention: {
      type: 'choice',
      instructions: 'How does `policy_text` say a return window is counted from the delivery date?',
      criteria: {
        delivery_day_is_day_1:
          'the delivery day itself is day 1 of the window, so a request made on day 30 of a 30-day window is within it and one made on day 31 is not',
        window_starts_the_day_after_delivery:
          'the window starts the day after delivery, so the delivery day is day 0',
      },
    },

    // Stated numbers read exactly as choices, never banded.
    general_window_days: {
      type: 'choice',
      instructions:
        'How many days after delivery does `policy_text` say most items can be returned within? Give the number of days stated for items with no special rule.',
      criteria: dayCriteria(),
    },
    electronics_window_days: {
      type: 'choice',
      instructions:
        'How many days after delivery does `policy_text` say electronics can be returned within when they are not defective? Choose no_special_rule if `policy_text` gives electronics no special window.',
      criteria: {
        ...dayCriteria(),
        no_special_rule: '`policy_text` gives electronics no special return window',
      },
    },
    defective_window_days: {
      type: 'choice',
      instructions:
        'How many days after delivery does `policy_text` say a defective item can be returned within, where it gives defective items a window of their own? Choose no_special_rule if `policy_text` gives defective items no window of their own.',
      criteria: {
        ...dayCriteria(),
        no_special_rule: '`policy_text` gives defective items no return window of their own',
      },
    },

    // The policy's condition and exclusions, read as stated facts.
    unopened_required: {
      type: 'noul',
      instructions:
        'Does `policy_text` say electronics can be returned only if they are unopened (still sealed or unused)?',
      criteria: {
        true: '`policy_text` states an unopened condition for returning electronics',
        false: '`policy_text` states no unopened condition for returning electronics',
      },
    },
    final_sale_excluded: {
      type: 'noul',
      instructions: 'Does `policy_text` say items marked final sale cannot be returned?',
      criteria: {
        true: '`policy_text` excludes final-sale items from returns',
        false: '`policy_text` does not exclude final-sale items from returns',
      },
    },
    gift_cards_excluded: {
      type: 'noul',
      instructions: 'Does `policy_text` say gift cards cannot be returned?',
      criteria: {
        true: '`policy_text` excludes gift cards from returns',
        false: '`policy_text` does not exclude gift cards from returns',
      },
    },
  };

  // The chosen item is known only after the parallel pass, so these exist for every
  // item; the code in decide() reads only the chosen one.
  items.forEach((it, i) => {
    const label = `\`order.items[${i}].name\` ("${esc(it.name)}")`;
    q[`condition_${i}`] = {
      type: 'choice',
      instructions: `What does \`request.message\` say about whether the item named in ${label} has been opened?`,
      criteria: {
        says_unopened: 'the message states this item was not opened (still sealed or unused)',
        says_opened: 'the message states this item has been opened or used',
        says_nothing: 'the message says nothing about whether this item was opened',
      },
    };
    q[`defective_${i}`] = {
      type: 'noul',
      instructions: `Does \`request.message\` say that the item named in ${label} is defective, damaged or not working? The item itself, not just its packaging.`,
      criteria: {
        true: 'the message states this item is defective, damaged, faulty or not working',
        false: 'the message does not state that this item is defective',
      },
    };
    q[`gift_card_${i}`] = {
      type: 'noul',
      instructions: `Is the item described by \`order.items[${i}]\` a gift card or store credit (a prepaid card to spend), rather than physical merchandise?`,
      criteria: {
        true: 'this item is a gift card or store credit',
        false: 'this item is physical merchandise, not a gift card or store credit',
      },
    };
  });

  return q;
}

export function decide(answers, input) {
  const items = input.order?.items ?? [];

  // 1) Which item is the request about?
  const w = answers.which_item;
  if (!w || !w.choice || w.choice === 'unclear' || w.choice === 'multiple') return ABSTAIN;
  const idx = Number(w.choice);
  if (!Number.isInteger(idx) || idx < 0 || idx >= items.length) return ABSTAIN;
  if ((w.probabilities?.[w.choice] ?? 0) < GATES.item) return ABSTAIN;
  const item = items[idx];

  // 2) How the window is counted.
  const c = answers.counting_convention;
  if (!c || !c.choice || (c.probabilities?.[c.choice] ?? 0) < GATES.counting) return ABSTAIN;
  const deliveryDayIsDay1 = c.choice === 'delivery_day_is_day_1';

  // 3) Exclusions are absolute: they beat every window and condition.
  if (item.final_sale === true && (answers.final_sale_excluded?.noul ?? 0) >= 0.5) {
    return { eligible: 'no' };
  }
  const giftCard =
    (answers[`gift_card_${idx}`]?.noul ?? 0) >= GATES.giftCard ||
    GIFT_CARD_RE.test(`${item.category ?? ''} ${item.name ?? ''} ${item.sku ?? ''}`);
  if (giftCard && (answers.gift_cards_excluded?.noul ?? 0) >= 0.5) {
    return { eligible: 'no' };
  }

  // 4) Dates: read exactly, all arithmetic here.
  const delivered = Date.parse(item.delivered_date);
  const requested = Date.parse(input.request?.date);
  if (!Number.isFinite(delivered) || !Number.isFinite(requested)) return ABSTAIN;
  const diff = Math.round((requested - delivered) / 86400000);
  if (diff < 0) return ABSTAIN; // the request predates delivery: a person should look
  const day = deliveryDayIsDay1 ? diff + 1 : diff; // day of the window the request falls on
  const within = (d) => day <= d;

  // 5) The windows the policy states, each gated on its own probability.
  const readWindow = (key) => {
    const a = answers[key];
    if (!a || !a.choice || a.choice === 'no_special_rule') return { d: null, p: 1 };
    const d = Number(a.choice);
    return Number.isInteger(d) ? { d, p: a.probabilities?.[a.choice] ?? 0 } : { d: null, p: 0 };
  };
  const generalWin = readWindow('general_window_days');
  const elecWin = readWindow('electronics_window_days');
  const defectWin = readWindow('defective_window_days');

  const isElectronics = /electronic/i.test(String(item.category ?? ''));
  const unopenedRequired = (answers.unopened_required?.noul ?? 0) >= 0.5;
  const useElectronics = isElectronics && elecWin.d != null;
  const win = useElectronics ? elecWin : generalWin;
  if (win.d == null || win.p < GATES.policy) return ABSTAIN;

  // 6) What the message says about the chosen item's condition.
  const cond = answers[`condition_${idx}`];
  const condTop = cond?.choice ?? '';
  const condKnown = (cond?.probabilities?.[condTop] ?? 0) >= GATES.condition;

  const defP = answers[`defective_${idx}`]?.noul ?? 0;
  const statesDefect = defP >= GATES.defective;
  const defectUncertain = defP > 0.35 && !statesDefect;
  // A half-stated defect that would flip the answer goes to a person; doubt never relaxes a "no".
  const defectCouldFlip = defectUncertain && defectWin.d != null && within(defectWin.d);

  // A stated defect uses the defective window and overrides the unopened condition.
  if (statesDefect && defectWin.d != null) {
    if (defectWin.p < GATES.policy) return ABSTAIN;
    return { eligible: within(defectWin.d) ? 'yes' : 'no' };
  }

  // Outside the item's own window: only a defect could save it.
  if (!within(win.d)) return defectCouldFlip ? ABSTAIN : { eligible: 'no' };

  // Inside the window: eligible unless the policy conditions on unopened.
  if (!useElectronics || !unopenedRequired) return { eligible: 'yes' };
  if (condTop === 'says_unopened' && condKnown) return { eligible: 'yes' };
  if (condTop === 'says_opened' && condKnown) {
    return defectCouldFlip ? ABSTAIN : { eligible: 'no' };
  }
  return ABSTAIN; // the policy requires unopened and the message does not say
}
