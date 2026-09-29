// map.mjs — return-eligibility resolution on Jev (TypeSafe System One).
//
// Strategy: let Jev do what it's good at (reading the free-text message and
// the free-text policy), and do the brittle parts (date arithmetic) ourselves
// in buildState. One choice question identifies the item; three noul questions
// apply the policy along independent axes (window, condition, exclusions) so a
// single bad answer can't flip the decision. Anything ambiguous -> "abstain".

const DAY_MS = 86400000;

const HI = 0.7;        // noul >= HI  -> treat as true
const LO = 0.3;        // noul <= LO  -> treat as false
const MIN_CONF = 0.6;  // min confidence for the item choice
const MAX_OPTIONS = 250; // stay under the 255-option limit (+ unclear/multiple)

function parseDate(s) {
  if (typeof s !== "string") return null;
  const t = new Date(`${s}T00:00:00Z`).getTime();
  return Number.isNaN(t) ? null : t;
}

// Delivery day counts as day 1, so day N = (request - delivered) + 1.
function requestDay(delivered, request) {
  const a = parseDate(delivered);
  const b = parseDate(request);
  if (a == null || b == null) return null;
  return Math.floor((b - a) / DAY_MS) + 1;
}

export function buildState(input) {
  const reqDate = input?.request?.date ?? null;
  const items = (input?.order?.items ?? []).map((it) => ({
    sku: it.sku,
    name: it.name,
    category: it.category,
    final_sale: !!it.final_sale,
    price: it.price,
    delivered_date: it.delivered_date,
    request_is_day: requestDay(it.delivered_date, reqDate),
  }));
  return {
    returns_policy: input?.policy_text ?? "",
    order_id: input?.order?.order_id ?? null,
    request_date: reqDate,
    customer_message: input?.request?.message ?? "",
    items,
    note: "request_is_day = which day of the return window the request falls on for that item; the delivery day counts as day 1.",
  };
}

export function questions(input) {
  const items = (input?.order?.items ?? []).slice(0, MAX_OPTIONS);
  const itemOptions = {};
  for (const it of items) {
    itemOptions[it.sku] =
      `${it.name} (category: ${it.category}` +
      `${it.final_sale ? ", final sale" : ""}, delivered ${it.delivered_date})`;
  }
  itemOptions.multiple = "The customer asks to return more than one item from the order.";
  itemOptions.unclear = "Cannot tell which item they want to return, or they are not requesting a return.";

  return {
    item: {
      type: "choice",
      instructions:
        "Identify the single item the customer is asking to return. Match what they describe " +
        "sending back; ignore items they say they are keeping, praising, or only asking about.",
      criteria: itemOptions,
    },
    window_ok: {
      type: "noul",
      instructions:
        "Answer for the item the customer wants to return. Under the returns policy, is the " +
        "request date within that item's allowed return window? Use the item's category, any " +
        "defect claim in the message (some categories allow a longer window for defective " +
        "items), and the per-item request_is_day value in the state (delivery day = day 1).",
      criteria: {
        true: "The request is within the policy's return window for that item.",
        false: "The request is after the policy's return window for that item.",
      },
    },
    condition_ok: {
      type: "noul",
      instructions:
        "Answer for the item the customer wants to return. Given what the customer states about " +
        "its condition (opened vs unopened, used, defective), does the policy permit the return? " +
        "If the policy requires an unopened item and the message does not say whether it was " +
        "opened, treat it as uncertain (answer near 0.5).",
      criteria: {
        true: "The item's condition as described is acceptable under the policy.",
        false: "The item's condition as described violates the policy.",
      },
    },
    excluded: {
      type: "noul",
      instructions:
        "Answer for the item the customer wants to return. Does the policy place it in a group " +
        "that can never be returned (for example final-sale items or gift cards)? Use the item's " +
        "final_sale flag and category from the state.",
      criteria: {
        true: "The policy categorically excludes this item from returns.",
        false: "The policy does not categorically exclude this item.",
      },
    },
  };
}

export function decide(answers, input) {
  const abstain = { eligible: "abstain" };

  const item = answers?.item;
  if (!item || item.type !== "choice") return abstain;
  if (item.choice === "multiple" || item.choice === "unclear") return abstain;
  if (typeof item.confidence !== "number" || item.confidence < MIN_CONF) return abstain;
  const known = (input?.order?.items ?? []).some((it) => it.sku === item.choice);
  if (!known) return abstain;

  const pWin = answers?.window_ok?.noul;
  const pCond = answers?.condition_ok?.noul;
  const pExcl = answers?.excluded?.noul;
  if ([pWin, pCond, pExcl].some((p) => typeof p !== "number")) return abstain;

  const unsure = (p) => p > LO && p < HI;
  if (unsure(pWin) || unsure(pCond) || unsure(pExcl)) return abstain;

  const ok = pWin >= HI && pCond >= HI && pExcl <= LO;
  return { eligible: ok ? "yes" : "no" };
}
