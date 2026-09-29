export function buildState(input) {
  const order = input.order || {};
  const request = input.request || {};

  const items = (order.items || []).map((item, index) => {
    let days_since_delivery = null;

    if (item.delivered_date && request.date) {
      const delivered = new Date(`${item.delivered_date}T00:00:00Z`);
      const requested = new Date(`${request.date}T00:00:00Z`);

      if (!Number.isNaN(delivered.getTime()) && !Number.isNaN(requested.getTime())) {
        days_since_delivery = Math.floor((requested - delivered) / 86400000) + 1;
      }
    }

    return {
      index,
      sku: item.sku,
      name: item.name,
      category: item.category,
      final_sale: item.final_sale,
      delivered_date: item.delivered_date,
      days_since_delivery,
    };
  });

  return {
    policy_text: input.policy_text,
    order_id: order.order_id,
    request_date: request.date,
    request_message: request.message,
    items,
  };
}

export function questions(input) {
  const items = input.order?.items || [];
  const q = {};

  const itemOptions = {};
  items.forEach((item, index) => {
    itemOptions[`item_${index}`] = `${item.sku} - ${item.name}`;
  });
  itemOptions.ambiguous =
    "The request does not clearly identify a single item, or asks about multiple items.";

  q.requested_item = {
    type: "choice",
    instructions:
      "Identify the single item in the order that the customer is asking to return. Base this only on the request message. If the request clearly identifies one item, select that item. If it is ambiguous, asks about multiple items, or asks about something not in the order, select 'ambiguous'.",
    criteria: itemOptions,
  };

  items.forEach((item, index) => {
    q[`eligible_${index}`] = {
      type: "noul",
      instructions: `According to the returns policy, would item ${item.name} (SKU ${item.sku}) be eligible for return if the customer requested to return it? Base your answer on the request date, delivery date, category, final_sale status, and any relevant details in the customer's message about this item. Do not consider whether the customer actually asked to return this item.`,
      criteria: {
        "true": "The item is eligible for return under the policy.",
        "false": "The item is not eligible for return under the policy.",
      },
    };
  });

  return q;
}

export function decide(answers, input) {
  const req = answers?.requested_item;

  if (!req || req.type !== "choice" || !req.choice) {
    return { eligible: "abstain" };
  }

  if (req.choice === "ambiguous") {
    return { eligible: "abstain" };
  }

  const match = /^item_(\d+)$/.exec(req.choice);
  if (!match) {
    return { eligible: "abstain" };
  }

  const index = Number(match[1]);
  const items = input.order?.items || [];

  if (!Number.isInteger(index) || index < 0 || index >= items.length) {
    return { eligible: "abstain" };
  }

  const choiceConfidence =
    typeof req.confidence === "number"
      ? req.confidence
      : req.probabilities?.[req.choice] ?? 0;

  if (choiceConfidence < 0.6) {
    return { eligible: "abstain" };
  }

  const eligibilityAnswer = answers[`eligible_${index}`];

  if (!eligibilityAnswer || eligibilityAnswer.type !== "noul" || typeof eligibilityAnswer.noul !== "number") {
    return { eligible: "abstain" };
  }

  const p = eligibilityAnswer.noul;

  if (p >= 0.65) {
    return { eligible: "yes" };
  }

  if (p <= 0.35) {
    return { eligible: "no" };
  }

  return { eligible: "abstain" };
}
