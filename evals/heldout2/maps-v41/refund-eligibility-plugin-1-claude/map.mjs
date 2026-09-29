// Fixed store policy, pinned once (see jev-questions rule 13). All requests in this
// deployment are evaluated against the same written policy shown in `policy_text`:
//   1. Most items: 30 days from delivery.
//   2. Electronics: 15 days, and only if unopened; 30 days if defective.
//   3. Final-sale items and gift cards: never returnable.
// The delivery day itself is day 1 of the window.
const GENERAL_DAYS = 30;
const ELECTRONICS_DAYS = 15;
const ELECTRONICS_DEFECTIVE_DAYS = 30;

const GATE_HIGH = 0.75;
const GATE_LOW = 0.25;
const TARGET_CONFIDENCE_GATE = 0.6;

function isElectronics(item) {
  return (item.category || "").toLowerCase() === "electronics";
}

function isNeverReturnable(item) {
  const name = (item.name || "").toLowerCase();
  const category = (item.category || "").toLowerCase();
  return Boolean(item.final_sale) || category.includes("gift") || name.includes("gift card");
}

function dayNumber(deliveredDate, requestDate) {
  const delivered = new Date(deliveredDate + "T00:00:00Z");
  const requested = new Date(requestDate + "T00:00:00Z");
  const diffDays = Math.round((requested - delivered) / 86400000);
  return diffDays + 1; // delivery day counts as day 1
}

function noulLabel(p) {
  if (p >= GATE_HIGH) return "true";
  if (p <= GATE_LOW) return "false";
  return "abstain";
}

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    order_id: input.order.order_id,
    items: input.order.items,
    request: input.request,
  };
}

export function questions(input) {
  const items = input.order.items;
  const q = {};

  const criteria = {};
  for (const it of items) {
    criteria[it.sku] = `The message is asking to return "${it.name}" (sku ${it.sku}).`;
  }
  criteria["unclear"] =
    "The message does not clearly single out exactly one item from `items` to return (e.g. it names none of them clearly, or asks about more than one).";

  q.target_item = {
    type: "choice",
    instructions:
      "Reading `request.message`, which single item listed in `items` is the customer asking to return? Choose `unclear` if the message does not clearly identify exactly one such item.",
    criteria,
  };

  for (const it of items) {
    if (!isElectronics(it)) continue;
    q[`opened_${it.sku}`] = {
      type: "noul",
      instructions: `Does \`request.message\` say or imply that the item "${it.name}" (sku ${it.sku}) has already been opened, used, or tried, i.e. is not in unopened/original condition?`,
      criteria: {
        true: "the message says or implies the item was opened, unboxed, used, worn, or tried",
        false: "the message says or implies the item is unopened/unused, or says nothing about its condition",
      },
    };
    q[`defective_${it.sku}`] = {
      type: "noul",
      instructions: `Does \`request.message\` claim that the item "${it.name}" (sku ${it.sku}) is defective, broken, faulty, or not working?`,
      criteria: {
        true: "the message claims the item is defective, broken, faulty, or not working",
        false: "the message makes no such claim",
      },
    };
  }

  return q;
}

export function decide(answers, input) {
  const target = answers.target_item;
  if (!target || target.choice === "unclear" || target.confidence < TARGET_CONFIDENCE_GATE) {
    return { eligible: "abstain" };
  }

  const item = input.order.items.find((it) => it.sku === target.choice);
  if (!item) return { eligible: "abstain" };

  if (isNeverReturnable(item)) {
    return { eligible: "no" };
  }

  const day = dayNumber(item.delivered_date, input.request.date);

  if (!isElectronics(item)) {
    return { eligible: day <= GENERAL_DAYS ? "yes" : "no" };
  }

  // Electronics: unopened within 15 days, OR defective within 30 days.
  if (day > ELECTRONICS_DEFECTIVE_DAYS) {
    return { eligible: "no" };
  }

  const openedLabel = noulLabel(answers[`opened_${item.sku}`].noul);
  const defectiveLabel = noulLabel(answers[`defective_${item.sku}`].noul);

  if (day <= ELECTRONICS_DAYS) {
    if (openedLabel === "false") return { eligible: "yes" };
    if (defectiveLabel === "true") return { eligible: "yes" };
    if (openedLabel === "true" && defectiveLabel === "false") return { eligible: "no" };
    return { eligible: "abstain" };
  }

  // 16..30 days: only the defective path can still qualify.
  if (defectiveLabel === "true") return { eligible: "yes" };
  if (defectiveLabel === "false") return { eligible: "no" };
  return { eligible: "abstain" };
}
