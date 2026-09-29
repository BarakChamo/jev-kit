// map.mjs — Jev question map: is the item a free-text return request asks about eligible
// for return under the returns policy in `policy_text`?
//
// Policy clauses -> where each one is carried (one test case per clause, exclusions included):
//   1 "most items ... within N days"          -> `window_most_days` (exact read); dates compared in code
//   2 "electronics ... N days ... only if unopened, unless defective (then M days)"
//     -> `window_electronics_days`, `window_defective_days` (exact reads); `electronics_<i>`;
//        `defect_stated`, `opened_status` (what `message` states); combined in code
//   3 "final sale and gift cards cannot be returned" -> item `final_sale` field (code), `gift_card_<i>`
//   "the delivery day counts as day 1"        -> dayNumberOf() in code
// Clause 3 has no exceptions pinned. Clause 2's defective case lifts the unopened requirement.
// Windows are read from `policy_text` per case; the clause structure is pinned here.
// Gates below are placeholders: fit them per question with jev-audit on ~30 labelled cases.

const DAY_MS = 86400000;

const GATE = {
  identify: 0.8,                              // choice over every item + 3 non-item outcomes
  window: 0.7,                               // exact day count read from `policy_text`
  opened: 0.8,                               // 3-way choice
  defectYes: 0.7, defectNo: 0.3,              // noul
  electronicsYes: 0.9, electronicsNo: 0.5,   // noul; fallback when `category` is not a code match
  giftCardYes: 0.7, giftCardNo: 0.3,          // noul
};

export function buildState(input) {
  const order = input?.order ?? {};
  return {
    policy_text: input?.policy_text ?? '',
    order: { order_id: order.order_id ?? null, items: Array.isArray(order.items) ? order.items : [] },
    request: { date: input?.request?.date ?? null, message: input?.request?.message ?? '' },
  };
}

export function questions(input) {
  const items = Array.isArray(input?.order?.items) ? input.order.items : [];

  const dayCriteria = {};
  for (let d = 1; d <= 120; d++) dayCriteria[String(d)] = `${d} days`;
  dayCriteria.not_stated_in_days = 'the policy does not state this window as a number of days';

  const itemCriteria = {};
  for (let i = 0; i < items.length; i++) {
    const it = items[i] ?? {};
    itemCriteria[`item_${i}`] =
      `${it.name ?? 'unnamed item'} — SKU ${it.sku ?? '(no sku)'} (category: ${it.category ?? 'unknown'})`;
  }

  const q = {
    target_item: {
      type: 'choice',
      instructions: 'Which item in `order.items` does the message in `message` ask to return, exchange, or get a refund for? Read the whole message. A sentence about an item the customer is keeping (for example calling it great) is not a return request. If the message asks to return more than one item, or could mean more than one item without saying which, or does not ask to return any item from this order, use one of the last three options.',
      criteria: {
        ...itemCriteria,
        none_of_them: 'the message does not ask to return, exchange, or get a refund for any item in `order.items`',
        more_than_one: 'the message asks to return more than one item from `order.items`',
        unclear_which: 'the message could mean more than one item from `order.items` and does not say which',
      },
    },
    window_most_days: {
      type: 'choice',
      instructions: 'Read `policy_text`. How many days after delivery does it say most items can be returned within? Give the exact number of days stated for items in general.',
      criteria: dayCriteria,
    },
    window_electronics_days: {
      type: 'choice',
      instructions: 'Read `policy_text`. How many days after delivery does it say electronics can be returned within, when the electronics item is not defective? Give the exact number of days stated for electronics.',
      criteria: dayCriteria,
    },
    window_defective_days: {
      type: 'choice',
      instructions: 'Read `policy_text`. When an electronics item is defective, how many days after delivery does it say the item can be returned within? If `policy_text` states no separate window for defective items, choose not_stated_in_days.',
      criteria: dayCriteria,
    },
    defect_stated: {
      type: 'noul',
      instructions: 'Does the message in `message` state that the item it asks to return is defective or faulty — for example broken, does not work, stopped working, arrived damaged, or missing parts? Only defects in the item being returned count: any statement about another item in the order that the customer is keeping does not count. Returning because of a change of mind, wrong size, wrong colour, or not liking the item is not a defect.',
      criteria: {
        true: 'the message states a defect or fault in the item being returned',
        false: 'the message states no defect in the item being returned',
      },
    },
    opened_status: {
      type: 'choice',
      instructions: 'What does the message in `message` say about whether the item it asks to return has been opened? Only statements about the item being returned count; statements about other items in the order do not. Opening for any reason, including to try or inspect the item, counts as opened.',
      criteria: {
        unopened: 'the message says the item being returned is unopened — never opened, still sealed, or in unopened packaging',
        opened: 'the message says the item being returned has been opened',
        not_stated: 'the message does not say whether the item being returned has been opened',
      },
    },
  };

  for (let i = 0; i < items.length; i++) {
    q[`electronics_${i}`] = {
      type: 'noul',
      instructions: `Is the item \`order.items[${i}]\` an electronic device — something with electronic components that a customer would call electronics, such as headphones, a phone, a tablet, a laptop, a TV, a camera, a speaker, or a smartwatch? Judge from the item's \`name\` and \`category\`.`,
      criteria: { true: 'the item is an electronic device', false: 'the item is not an electronic device' },
    };
    q[`gift_card_${i}`] = {
      type: 'noul',
      instructions: `Is the item \`order.items[${i}]\` a gift card or other stored-value credit, or does it include one as part of a bundle or set? This is the kind of item the returns policy in \`policy_text\` says cannot be returned. Judge from the item's \`name\` and \`category\`.`,
      criteria: {
        true: 'the item is, or includes, a gift card or stored-value credit',
        false: 'the item is a normal product with no gift card or stored-value credit in it',
      },
    };
  }

  return q;
}

// --- decision, in code ---

function choiceP(ans) {
  return ans?.probabilities?.[ans.choice] ?? ans.confidence ?? 0;
}

function windowDays(ans) {
  if (ans?.type !== 'choice' || typeof ans.choice !== 'string') return null;
  if (choiceP(ans) < GATE.window) return null;
  const n = Number(ans.choice);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

function noulP(ans) {
  return ans?.type === 'noul' && typeof ans.noul === 'number' ? ans.noul : 0.5;
}

// The delivery day itself is day 1: a request on day 30 is inside a 30-day window.
function dayNumberOf(delivered, requested) {
  const d = Date.parse(delivered ?? '');
  const r = Date.parse(requested ?? '');
  if (Number.isNaN(d) || Number.isNaN(r)) return null;
  return Math.round((r - d) / DAY_MS) + 1;
}

function decideEligible(answers, input) {
  const items = Array.isArray(input?.order?.items) ? input.order.items : [];

  // 1. Which item the request is about. Anything but one clear item goes to a person.
  const id = answers.target_item;
  if (id?.type !== 'choice' || typeof id.choice !== 'string') return 'abstain';
  if (!id.choice.startsWith('item_') || choiceP(id) < GATE.identify) return 'abstain';
  const idx = Number(id.choice.slice(5));
  const item = items[idx];
  if (!item) return 'abstain';

  // 2. Clause 3 exclusions, no exceptions.
  if (item.final_sale === true || item.final_sale === 'true') return 'no';
  const gc = noulP(answers[`gift_card_${idx}`]);
  if (gc >= GATE.giftCardYes) return 'no';
  const giftCards = gc <= GATE.giftCardNo ? [false] : [false, true];

  // 3. Dates, in code.
  const dayNum = dayNumberOf(item.delivered_date, input?.request?.date);
  if (dayNum == null || dayNum <= 0) return 'abstain';

  // 4. Windows, read exactly from the policy.
  const windows = {
    most: windowDays(answers.window_most_days),
    elec: windowDays(answers.window_electronics_days),
    def: windowDays(answers.window_defective_days),
  };

  // 5. The readings the answers support (the `category` field settles electronics when it matches).
  const codeElec = /electronic/i.test(String(item.category ?? ''));
  const el = noulP(answers[`electronics_${idx}`]);
  const electronicsOpts = codeElec ? [true]
    : el >= GATE.electronicsYes ? [true]
    : el <= GATE.electronicsNo ? [false] : [false, true];

  const df = noulP(answers.defect_stated);
  const defectOpts = df >= GATE.defectYes ? [true] : df <= GATE.defectNo ? [false] : [false, true];

  const op = answers.opened_status;
  let openedOpts = [];
  if (op?.type === 'choice' && (op.choice === 'unopened' || op.choice === 'opened') && choiceP(op) >= GATE.opened) {
    openedOpts = [op.choice];
  }
  if (openedOpts.length === 0) openedOpts = ['opened', 'unopened']; // the fact is unknown to us

  // 6. Evaluate every reading the answers support; decide only when they all agree.
  const outcomes = new Set();
  let unresolvable = false;
  for (const electronics of electronicsOpts) {
    for (const defective of electronics ? defectOpts : [false]) {
      const window = electronics ? (defective ? windows.def : windows.elec) : windows.most;
      if (window == null) { unresolvable = true; continue; }
      for (const opened of (electronics && !defective) ? openedOpts : ['unopened']) {
        for (const giftCard of giftCards) {
          if (giftCard) { outcomes.add('no'); continue; }            // clause 3
          if (dayNum > window) { outcomes.add('no'); continue; }     // outside the window
          outcomes.add(electronics && !defective && opened !== 'unopened' ? 'no' : 'yes');
        }
      }
    }
  }
  if (unresolvable || outcomes.size !== 1) return 'abstain';
  return [...outcomes][0];
}

export function decide(answers, input) {
  return { eligible: decideEligible(answers ?? {}, input) };
}
