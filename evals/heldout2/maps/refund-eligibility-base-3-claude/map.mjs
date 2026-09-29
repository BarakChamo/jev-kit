// Decide return eligibility for a single item referenced in a free-text
// customer message, from a multi-item order, against a (per-case) policy.

function daysSinceDelivery(deliveredDate, requestDate) {
  const d = new Date(deliveredDate + "T00:00:00Z");
  const r = new Date(requestDate + "T00:00:00Z");
  return Math.round((r - d) / 86400000) + 1; // delivery day counts as day 1
}

export function buildState(input) {
  const { policy_text, order, request } = input;
  return {
    policy_text,
    request: { date: request.date, message: request.message },
    items: order.items.map((it) => ({
      sku: it.sku,
      name: it.name,
      category: it.category,
      final_sale: it.final_sale,
      price: it.price,
      delivered_date: it.delivered_date,
      days_since_delivery: daysSinceDelivery(it.delivered_date, request.date),
    })),
  };
}

export function questions(input) {
  const items = input.order.items;
  const q = {};

  q.item = {
    type: "choice",
    instructions:
      "The order has multiple items (see state.items) and the customer wrote a free-text " +
      "message (state.request.message) about a return. Identify the single item they are " +
      "asking to return, by SKU. If the message does not clearly single out exactly one item " +
      "from this order, pick your best guess but keep confidence low.",
    criteria: Object.fromEntries(
      items.map((it) => [it.sku, `${it.name} (category: ${it.category}, price: ${it.price})`])
    ),
  };

  for (const it of items) {
    q[`eligible_${it.sku}`] = {
      type: "noul",
      instructions:
        `Decide whether a return of item ${it.sku} ("${it.name}") is eligible under the ` +
        "returns policy in state.policy_text, given that item's facts in state.items " +
        "(category, final_sale, days_since_delivery) and any relevant details the customer " +
        "stated about this item in state.request.message (e.g. opened/unopened condition, " +
        "defect claims). Apply the policy's time window and category-specific rules exactly. " +
        "If a fact the policy requires (e.g. whether the item was opened) is not stated and " +
        "cannot be inferred, do not assume it in the customer's favor.",
      criteria: {
        true: "The return request for this item satisfies every applicable policy condition.",
        false: "The return request for this item fails an applicable policy condition or is excluded by policy.",
      },
    };
  }

  return q;
}

export function decide(answers, input) {
  const itemAns = answers.item;
  if (!itemAns || itemAns.type !== "choice" || itemAns.confidence < 0.6) {
    return { eligible: "abstain" };
  }

  const eligAns = answers[`eligible_${itemAns.choice}`];
  if (!eligAns || eligAns.type !== "noul") {
    return { eligible: "abstain" };
  }

  const p = eligAns.noul;
  if (p >= 0.75) return { eligible: "yes" };
  if (p <= 0.25) return { eligible: "no" };
  return { eligible: "abstain" };
}
