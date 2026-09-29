// map.mjs — return-eligibility resolution on Jev (TypeSafe System One).
// Strategy: per item in the order, ask Jev (a) whether the customer is
// requesting that item, (b) whether the policy categorically excludes it,
// (c) whether the request is inside the applicable window, (d) whether
// policy conditions (e.g. unopened/defective) are satisfied by the message,
// and (e) a holistic eligibility check used as a cross-check. Date
// arithmetic is done here, not by the model. Uncertain or contradictory
// signals abstain to a human.

const DAY_MS = 86400000;
const HI = 0.7;   // confident "true"
const LO = 0.3;   // confident "false"
const REQ = 0.6;  // confident "this item is being requested"

function daysBetween(a, b) {
  const da = Date.parse(a), db = Date.parse(b);
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.round((db - da) / DAY_MS); // delivery day = day 0 in this count
}

function itemFacts(it, reqDate) {
  return {
    sku: it?.sku ?? null,
    name: it?.name ?? "",
    category: it?.category ?? null,
    final_sale: !!it?.final_sale,
    price: it?.price ?? null,
    delivered_date: it?.delivered_date ?? null,
    days_after_delivery: daysBetween(it?.delivered_date, reqDate),
  };
}

export function buildState(input) {
  const req = input?.request ?? {};
  return {
    task: "Decide whether the item a customer asks to return is eligible under the returns policy.",
    policy_text: input?.policy_text ?? "",
    request: { date: req.date ?? null, message: req.message ?? "" },
    order_id: input?.order?.order_id ?? null,
    items: (input?.order?.items ?? []).map((it) => itemFacts(it, req.date)),
  };
}

function describe(it, reqDate) {
  return `"${it.name}" (SKU ${it.sku}; category ${it.category}; final_sale=${it.final_sale ? "yes" : "no"}; price ${it.price}; delivered ${it.delivered_date}, which is ${it.days_after_delivery} days before the request date ${reqDate} — note the policy may count the delivery day as day 1 of the window)`;
}

export function questions(input) {
  const s = buildState(input);
  const msg = s.request.message;
  const q = {};
  for (const it of s.items) {
    const d = describe(it, s.request.date);
    q[`req:${it.sku}`] = {
      type: "noul",
      instructions: `Customer message: "${msg}"\nIs the customer asking to return this item: ${d}? Answer true only if the message clearly requests a return of this specific item.`,
      criteria: {
        true: "The message clearly asks to return this item.",
        false: "The message does not ask to return this item: it is only mentioned in passing, the customer says they are keeping it, or it is unclear which item is meant.",
      },
    };
    q[`excl:${it.sku}`] = {
      type: "noul",
      instructions: `Using the returns policy in the state: is this item categorically excluded from returns regardless of condition (e.g., final sale, gift card, excluded category)? Item: ${d}.`,
      criteria: {
        true: "The policy makes this item non-returnable in all cases.",
        false: "The policy does not categorically exclude this item from returns.",
      },
    };
    q[`win:${it.sku}`] = {
      type: "noul",
      instructions: `Using the returns policy in the state: is the return request for this item within the allowed return window? Item: ${d}. Apply the window the policy sets for this kind of item and the policy's own rule for counting days.`,
      criteria: {
        true: "The request date falls within the return window that applies to this item.",
        false: "The request date is outside the applicable return window.",
      },
    };
    q[`cond:${it.sku}`] = {
      type: "noul",
      instructions: `Using the returns policy in the state and the customer message ("${msg}"): does this return satisfy every condition the policy requires for this kind of item (e.g., unopened, defective, original packaging)? Item: ${d}. Answer true if the policy requires no conditions or the message establishes each required one. If the message leaves a required condition unestablished, do not answer confidently true.`,
      criteria: {
        true: "All policy conditions for returning this item are met (or none are required).",
        false: "A required condition is not met, or the message does not establish that it is met.",
      },
    };
    q[`ok:${it.sku}`] = {
      type: "noul",
      instructions: `Considering the whole returns policy in the state, all item facts, the request date, and the customer message ("${msg}"): is this item eligible for return? Item: ${d}.`,
      criteria: {
        true: "The item is eligible for return under the policy.",
        false: "The item is not eligible for return under the policy.",
      },
    };
  }
  return q;
}

function prob(answers, id) {
  const a = answers?.[id];
  return a && a.type === "noul" && typeof a.noul === "number" ? a.noul : null;
}

export function decide(answers, input) {
  const items = input?.order?.items ?? [];
  const requested = items.filter((it) => (prob(answers, `req:${it.sku}`) ?? 0) >= REQ);
  // Zero or several clearly-requested items: a single yes/no cannot be given.
  if (requested.length !== 1) return { eligible: "abstain" };
  const sku = requested[0].sku;
  const excl = prob(answers, `excl:${sku}`);
  const win = prob(answers, `win:${sku}`);
  const cond = prob(answers, `cond:${sku}`);
  const ok = prob(answers, `ok:${sku}`);
  if ([excl, win, cond, ok].some((v) => v === null)) return { eligible: "abstain" };
  // Clearly eligible: not excluded, in window, conditions met, holistic agrees.
  if (excl <= LO && win >= HI && cond >= HI && ok >= HI) return { eligible: "yes" };
  const noSignal = excl >= HI || win <= LO || cond <= LO || ok <= LO;
  if (noSignal) {
    // If other signals strongly disagree, a person should reconcile them.
    const contradict = ok >= HI || (excl <= LO && win >= HI && cond >= HI);
    return { eligible: contradict ? "abstain" : "no" };
  }
  return { eligible: "abstain" };
}
