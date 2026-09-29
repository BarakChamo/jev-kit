export function buildState(input) {
  const requestDate = input.request?.date;
  const items = (input.order?.items || []).map((item) => {
    let daysSinceDelivery = null;
    if (item.delivered_date && requestDate) {
      const delivered = new Date(item.delivered_date);
      const requested = new Date(requestDate);
      const diffMs = requested.getTime() - delivered.getTime();
      if (!Number.isNaN(diffMs)) {
        daysSinceDelivery = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
      }
    }
    return {
      sku: item.sku,
      name: item.name,
      category: item.category,
      final_sale: item.final_sale,
      price: item.price,
      delivered_date: item.delivered_date,
      days_since_delivery: daysSinceDelivery,
    };
  });

  return {
    policy_text: input.policy_text,
    order_id: input.order?.order_id,
    order_items: items,
    request: input.request,
  };
}

export function questions(input) {
  const itemCriteria = {};
  const items = (input.order?.items || []).slice(0, 250);

  for (const item of items) {
    itemCriteria[item.sku] = `Customer is requesting to return ${item.name} (${item.sku})`;
  }
  itemCriteria.none = "Customer is not requesting to return any item from the order";
  itemCriteria.multiple = "Customer is requesting to return multiple items in this request";
  itemCriteria.ambiguous = "Customer request is ambiguous or unclear about which item is being returned";

  return {
    target_item: {
      type: "choice",
      instructions: "Identify which item from the order the customer is asking to return in their message.",
      criteria: itemCriteria,
    },
    eligibility: {
      type: "choice",
      instructions: "Determine if the return request for the targeted item complies with the returns policy. Consider elapsed days since delivery, category-specific terms, unopened/defective conditions, and final sale restrictions.",
      criteria: {
        eligible: "The return request clearly complies with the returns policy.",
        ineligible: "The return request clearly violates the returns policy (e.g., past deadline, final sale, ineligible condition).",
        abstain: "The request is ambiguous, lacks critical information, contains conflicting details, or requires human inspection/discretion.",
      },
    },
  };
}

export function decide(answers, input) {
  const target = answers?.target_item;
  const elig = answers?.eligibility;

  if (!target || !elig) {
    return { eligible: "abstain" };
  }

  if (target.choice === "none" || target.choice === "multiple" || target.choice === "ambiguous") {
    return { eligible: "abstain" };
  }

  if ((target.confidence ?? 1) < 0.7 || (elig.confidence ?? 1) < 0.75) {
    return { eligible: "abstain" };
  }

  if (elig.choice === "eligible") {
    return { eligible: "yes" };
  }
  if (elig.choice === "ineligible") {
    return { eligible: "no" };
  }

  return { eligible: "abstain" };
}
