// map.mjs — decide per-item return eligibility from a free-text customer message.

const TARGET_CONFIDENCE_THRESHOLD = 0.6;
const ELIGIBLE_HIGH = 0.85;
const ELIGIBLE_LOW = 0.15;

export function buildState(input) {
  return input;
}

export function questions(input) {
  const { policy_text, order, request } = input;
  const items = order.items;

  const q = {};

  const targetCriteria = {};
  for (const item of items) {
    targetCriteria[item.sku] = `The customer is asking to return "${item.name}" (SKU ${item.sku}).`;
  }
  targetCriteria.unclear =
    "The message asks about more than one item from this order, names no specific item, or it is otherwise not clear which single item is being requested for return.";

  q.target_item = {
    type: "choice",
    instructions:
      `A customer sent this return request about order ${order.id ?? order.order_id}:\n"${request.message}"\n\n` +
      `The order contains these items: ${items.map((i) => `${i.sku} (${i.name})`).join(", ")}.\n` +
      `Identify the single item the customer wants to return. If the message clearly asks to keep an item, that item is NOT the target. ` +
      `Choose "unclear" if multiple items are being requested for return, or no specific single item can be determined.`,
    criteria: targetCriteria,
  };

  for (const item of items) {
    q[`eligible_${item.sku}`] = {
      type: "noul",
      instructions:
        `Returns policy:\n${policy_text}\n\n` +
        `Order item: "${item.name}" (SKU ${item.sku}), category=${item.category}, final_sale=${item.final_sale}, ` +
        `price=${item.price}, delivered_date=${item.delivered_date}. Request date: ${request.date}.\n` +
        `Customer's message (the order has other items too; only use claims from the message that clearly pertain ` +
        `to THIS item, ignore statements about other items): "${request.message}"\n\n` +
        `Decide whether THIS item, if the customer is asking to return it, would be eligible for return under the ` +
        `policy. Apply the policy's category-specific rules (e.g. electronics unopened/defective conditions), final ` +
        `sale exclusions, and the return-window day counting rule using delivered_date and request date.`,
      criteria: {
        true: "This item is eligible for return under the policy.",
        false: "This item is not eligible for return under the policy.",
      },
    };
  }

  return q;
}

export function decide(answers, input) {
  const target = answers?.target_item;
  if (!target || target.type !== "choice") return { eligible: "abstain" };
  if (target.choice === "unclear") return { eligible: "abstain" };
  if (typeof target.confidence === "number" && target.confidence < TARGET_CONFIDENCE_THRESHOLD) {
    return { eligible: "abstain" };
  }

  const elig = answers?.[`eligible_${target.choice}`];
  if (!elig || elig.type !== "noul" || typeof elig.noul !== "number") {
    return { eligible: "abstain" };
  }

  if (elig.noul >= ELIGIBLE_HIGH) return { eligible: "yes" };
  if (elig.noul <= ELIGIBLE_LOW) return { eligible: "no" };
  return { eligible: "abstain" };
}
