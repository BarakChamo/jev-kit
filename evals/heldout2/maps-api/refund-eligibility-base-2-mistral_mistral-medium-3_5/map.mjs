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
  const { order, request } = input;
  const items = order.items.map(item => item.sku);
  return {
    item: {
      type: "choice",
      instructions: "Identify which item from the order the customer is requesting to return based on their message. If unclear, choose 'abstain'.",
      criteria: items.reduce((acc, sku) => {
        acc[sku] = `Customer is requesting to return ${order.items.find(i => i.sku === sku).name}`;
        return acc;
      }, { abstain: "Cannot determine which item is being returned" })
    },
    defective: {
      type: "choice",
      instructions: "Is the customer stating the item is defective?",
      criteria: {
        yes: "Customer explicitly states the item is defective",
        no: "Customer does not state the item is defective",
        unclear: "Cannot determine from the message"
      }
    },
    unopened: {
      type: "choice",
      instructions: "Is the customer stating the item is unopened?",
      criteria: {
        yes: "Customer explicitly states the item is unopened",
        no: "Customer does not state the item is unopened",
        unclear: "Cannot determine from the message"
      }
    }
  };
}

export function decide(answers, input) {
  const { item, defective, unopened } = answers;
  if (item.choice === "abstain" || defective.choice === "unclear" || unopened.choice === "unclear") {
    return { eligible: "abstain" };
  }

  const sku = item.choice;
  const itemData = input.order.items.find(i => i.sku === sku);
  if (!itemData) return { eligible: "abstain" };

  if (itemData.final_sale) return { eligible: "no" };
  if (itemData.category === "gift card") return { eligible: "no" };

  const deliveredDate = new Date(itemData.delivered_date);
  const requestDate = new Date(input.request.date);
  const daysDiff = (requestDate - deliveredDate) / (1000 * 60 * 60 * 24) + 1;

  if (itemData.category === "electronics") {
    if (defective.choice === "yes") {
      return daysDiff <= 30 ? { eligible: "yes" } : { eligible: "no" };
    } else {
      if (unopened.choice !== "yes") return { eligible: "no" };
      return daysDiff <= 15 ? { eligible: "yes" } : { eligible: "no" };
    }
  } else {
    return daysDiff <= 30 ? { eligible: "yes" } : { eligible: "no" };
  }
}
