// map.mjs — decide whether the item a customer asks to return is eligible
// under the returns policy supplied with each case.
//
// Division of labour (per the Jev rules):
//   Jev reads prose: which item the message means, defect claims, opened state,
//   claimed prior approvals, and the policy's window numbers (read exactly, as choices).
//   Code does the rest: date arithmetic, structured flags (final sale, gift card,
//   category), window comparisons, and the final decision with gates.

const DAY_MS = 86_400_000;

const GATES = {
  item: 0.75,   // probability needed on "which item"
  high: 0.7,    // noul above this = true
  low: 0.3,    // noul below this = false; in between = unknown
  window: 0.6, // probability needed on a policy-window read
  opened: 0.6, // probability needed on the opened-status read
};

const WINDOW_OPTIONS = [7, 10, 14, 15, 21, 30, 45, 60, 90];

function parseIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

// Delivery day counts as day 1: a request on day 30 is inside a 30-day window.
function requestDay(delivered, request) {
  const d = parseIsoDate(delivered);
  const r = parseIsoDate(request);
  if (d === null || r === null) return null;
  return Math.round((r - d) / DAY_MS) + 1;
}

export function buildState(input) {
  const items = input.order?.items ?? [];
  const requestDate = input.request?.date ?? null;
  const dayOfRequest = {};
  for (const it of items) dayOfRequest[it.sku] = requestDay(it.delivered_date, requestDate);
  return {
    policy_text: input.policy_text ?? '',
    items,
    message: input.request?.message ?? '',
    request_date: requestDate,
    day_of_request_since_delivery: dayOfRequest,
    date_convention:
      "Each value in day_of_request_since_delivery is how many days after that item's delivery the request was made, computed from the order data; the delivery day itself counts as day 1. It is a fact about the order, not something the customer said.",
  };
}

export function questions(input) {
  const items = input.order?.items ?? [];
  const itemCriteria = {};
  for (const it of items) itemCriteria[it.sku] = `${it.name} (sku ${it.sku}, category ${it.category})`;
  const windowCriteria = Object.fromEntries(WINDOW_OPTIONS.map((n) => [String(n), null]));

  return {
    return_item: {
      type: 'choice',
      instructions:
        'Which single item in `items` does `message` ask to return? Ignore items the writer says they are keeping. If it asks to return more than one item, choose several. If no item to return is identified, choose none. If the item it names is not in `items`, choose not_in_order.',
      criteria: {
        ...itemCriteria,
        several: 'the message asks to return more than one item',
        none: 'the message identifies no item to return',
        not_in_order: 'the item named is not in this order',
      },
    },
    defective: {
      type: 'noul',
      instructions:
        'Does `message` state that the item it asks to return is defective: broken, damaged, faulty, does not work, or arrived wrong?',
      criteria: { true: 'the message says the item is defective', false: 'the message does not say that' },
    },
    opened: {
      type: 'choice',
      instructions: 'What does `message` say about whether the item to be returned has been opened or used?',
      criteria: {
        unopened: 'the message says the item is unopened, sealed, or unused',
        opened_or_used: 'the message says the item was opened, used, or tried',
        not_stated: 'the message says nothing about whether it was opened',
      },
    },
    claims_exception: {
      type: 'noul',
      instructions:
        'Does `message` claim that this return was already approved or promised, or that someone said the return rules or a fee would be waived for it?',
      criteria: {
        true: 'some text asserts prior approval or a promised exception',
        false: 'no such claim',
      },
    },
    general_window_days: {
      type: 'choice',
      instructions:
        'According to `policy_text`, how many days after delivery does a customer have to return an item that is not electronics and not defective? The delivery day counts as day 1.',
      criteria: { ...windowCriteria, not_stated: 'the policy states no single number for this' },
    },
    electronics_window_days: {
      type: 'choice',
      instructions:
        'According to `policy_text`, how many days after delivery does a customer have to return an electronics item that is not defective? The delivery day counts as day 1.',
      criteria: { ...windowCriteria, not_stated: 'the policy gives electronics no separate window' },
    },
    defective_window_days: {
      type: 'choice',
      instructions:
        'According to `policy_text`, how many days after delivery does a customer have to return an item that is defective, if the policy gives defective items their own window? The delivery day counts as day 1.',
      criteria: { ...windowCriteria, same_as_general: 'defective items get the same window as other items, not a longer one' },
    },
    electronics_requires_unopened: {
      type: 'noul',
      instructions:
        'According to `policy_text`, must an electronics item be unopened to be returnable when it is not defective?',
      criteria: {
        true: 'the policy requires electronics to be unopened',
        false: 'the policy imposes no unopened condition on electronics',
      },
    },
  };
}

// A window answer: { known: false } if unreadable or below the gate,
// { known: true, days: n } for a number, { known: true } for "not_stated"/"same_as_general".
function windowRead(ans, gate) {
  if (!ans || typeof ans.choice !== 'string') return { known: false };
  const p = ans.probabilities?.[ans.choice] ?? ans.confidence ?? 0;
  if (p < gate) return { known: false };
  const n = Number(ans.choice);
  if (Number.isFinite(n) && n > 0) return { known: true, days: n };
  return { known: true };
}

export function decide(answers, input) {
  const a = answers ?? {};
  const ABSTAIN = { eligible: 'abstain' };

  // 1. Which item? Everything else is scoped to it.
  const ri = a.return_item;
  if (!ri || typeof ri.choice !== 'string') return ABSTAIN;
  if (ri.choice === 'several' || ri.choice === 'none' || ri.choice === 'not_in_order') return ABSTAIN;
  const pPick = ri.probabilities?.[ri.choice] ?? ri.confidence ?? 0;
  if (pPick < GATES.item) return ABSTAIN;
  const item = (input.order?.items ?? []).find((x) => x.sku === ri.choice);
  if (!item) return ABSTAIN;

  // 2. A claimed prior approval or promised exception goes to a person,
  //    whatever we would otherwise decide (detector veto).
  if ((a.claims_exception?.noul ?? 0) > 0.5) return ABSTAIN;

  // 3. Structured exclusions need no model.
  if (item.final_sale === true) return { eligible: 'no' };
  const category = String(item.category ?? '').toLowerCase();
  if (category.includes('gift') || /gift\s*card/i.test(String(item.name ?? ''))) return { eligible: 'no' };

  // 4. Dates: read from the order data, all arithmetic here.
  const day = requestDay(item.delivered_date, input.request?.date);
  if (day === null || day < 1) return ABSTAIN;

  // 5. Policy windows: read the numbers exactly; unknown general window is undecidable.
  const g = windowRead(a.general_window_days, GATES.window);
  if (!g.known || g.days === undefined) return ABSTAIN;
  const generalWindow = g.days;

  const isElectronics = category.includes('electronic');
  let electronicsWindow = generalWindow;
  if (isElectronics) {
    const e = windowRead(a.electronics_window_days, GATES.window);
    if (!e.known) return ABSTAIN;
    if (e.days !== undefined) electronicsWindow = e.days;
  }

  const d = windowRead(a.defective_window_days, GATES.window);
  const defectWindowKnown = d.known;
  const defectWindow = d.days !== undefined ? d.days : generalWindow;

  // 6. Defect claim: high = defective, low = not, in between = unknown.
  const dp = a.defective?.noul ?? 0.5;
  const defect = dp > GATES.high ? true : dp < GATES.low ? false : null;

  // 7. Window check — the comparison lives here, never in a question.
  let windowOk;
  if (!isElectronics) {
    windowOk = day <= generalWindow;
  } else if (defect === false) {
    windowOk = day <= electronicsWindow;
  } else {
    if (day <= electronicsWindow) windowOk = true;
    else if (!defectWindowKnown) windowOk = null;
    else if (day > defectWindow) windowOk = false;
    else windowOk = defect === true ? true : null; // inside only the defective window, defect unproven
  }
  if (windowOk === null) return ABSTAIN;
  if (!windowOk) return { eligible: 'no' };

  // 8. Unopened condition for electronics (a confirmed defect waives it).
  if (isElectronics && defect !== true) {
    const reqP = a.electronics_requires_unopened?.noul ?? 1; // if unreadable, assume it applies
    const required = reqP > GATES.low; // doubt never relaxes the condition
    if (required) {
      const o = a.opened;
      if (!o || typeof o.choice !== 'string') return ABSTAIN;
      const pOpen = o.probabilities?.[o.choice] ?? o.confidence ?? 0;
      if (o.choice === 'unopened' && pOpen >= GATES.opened) {
        // condition satisfied
      } else if (o.choice === 'opened_or_used' && pOpen >= GATES.opened) {
        if (defect === null) return ABSTAIN; // a defect would waive it, but the defect is unproven
        return { eligible: 'no' };
      } else {
        return ABSTAIN; // not stated, or unsure — a person confirms
      }
    }
  }

  return { eligible: 'yes' };
}
