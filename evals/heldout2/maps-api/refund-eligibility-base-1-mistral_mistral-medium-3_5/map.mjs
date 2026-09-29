export function buildState(input) {
  return {
    policy: input.policy_text,
    order: input.order,
    request: input.request,
    today: input.request.date,
    items: input.order.items.reduce((acc, item) => {
      acc[item.sku] = item;
      return acc;
    }, {})
  };
}

export function questions(input) {
  const { items, request } = input.order;
  const mentionedItems = items.map(item => ({
    sku: item.sku,
    name: item.name,
    category: item.category,
    final_sale: item.final_sale,
    delivered_date: item.delivered_date
  }));

  return {
    item: {
      type: "choice",
      instructions: "Identify which item(s) the customer is explicitly requesting to return in their message. If multiple items are mentioned, select all that apply. If no items are clearly mentioned, select 'none'.",
      criteria: {
        none: "No items are mentioned for return",
        ...mentionedItems.reduce((acc, item) => {
          acc[item.sku] = `Customer is requesting to return ${item.name}`;
          return acc;
        }, {})
      }
    },
    defective: {
      type: "noul",
      instructions: "Determine if the customer explicitly states the item is defective.",
      criteria: {
        true: "Customer states the item is defective",
        false: "Customer does not state the item is defective"
      }
    },
    unopened: {
      type: "noul",
      instructions: "Determine if the customer explicitly states the item is unopened.",
      criteria: {
        true: "Customer states the item is unopened",
        false: "Customer does not state the item is unopened"
      }
    }
  };
}

export function decide(answers, input) {
  const { item, defective, unopened } = answers;
  const { items, request } = input.order;
  const today = new Date(request.date);
  const returnItemSku = item.choice === "none" ? null : item.choice;

  if (returnItemSku === null || item.confidence < 0.7) {
    return { eligible: "abstain" };
  }

  const returnItem = items.find(i => i.sku === returnItemSku);
  if (!returnItem) {
    return { eligible: "abstain" };
  }

  if (returnItem.final_sale) {
    return { eligible: "no" };
  }

  const deliveredDate = new Date(returnItem.delivered_date);
  const daysDiff = (today - deliveredDate) / (1000 * 60 * 60 * 24) + 1; // +1 because delivery day is day 1

  if (returnItem.category === "electronics") {
    const isDefective = defective.noul > 0.5;
    const isUnopened = unopened.noul > 0.5;

    if (isDefective) {
      if (daysDiff <= 30) return { eligible: "yes" };
      else return { eligible: "no" };
    } else {
      if (daysDiff <= 15 && isUnopened) return { eligible: "yes" };
      else return { eligible: "no" };
    }
  } else {
    if (daysDiff <= 30) return { eligible: "yes" };
    else return { eligible: "no" };
  }
}
