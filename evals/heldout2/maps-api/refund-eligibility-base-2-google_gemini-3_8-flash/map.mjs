export function buildState(input) {
  let reqDate = null;
  if (input?.request?.date) {
    const d = new Date(input.request.date);
    if (!isNaN(d.getTime())) reqDate = d;
  }

  const items = (input?.order?.items || []).map(item => {
    let dayOfWindow = null;
    if (reqDate && item?.delivered_date) {
      const delDate = new Date(item.delivered_date);
      if (!isNaN(delDate.getTime())) {
        dayOfWindow = Math.floor((reqDate.getTime() - delDate.getTime()) / 86400000) + 1;
      }
    }
    return {
      ...item,
      day_of_return_window: dayOfWindow
    };
  });

  return {
    ...input,
    order: {
      ...input?.order,
      items
    }
  };
}

export function questions(input) {
  return {
    eligibility: {
      type: "choice",
      instructions: "Review the returns policy, the order items, and the customer request message. Determine if the item the customer wants to return is eligible for return.",
      criteria: {
        yes: "The customer requests to return a specific item from the order, and that item is definitively eligible under the return policy (e.g., within the allowed return window, not final sale, meets condition criteria).",
        no: "The customer requests to return a specific item from the order, but that item is definitively ineligible under the return policy (e.g., past return window, final sale, opened when required unopened, category exclusion).",
        abstain: "The request is ambiguous, asks to return multiple items, does not clearly match an item in the order, lacks necessary facts required by policy to verify eligibility, or should be sent to a person for review."
      }
    }
  };
}

export function decide(answers, input) {
  const ans = answers?.eligibility;
  if (!ans || ans.choice === "abstain") {
    return { eligible: "abstain" };
  }

  const confidence = ans.confidence ?? 1;
  if (confidence < 0.75) {
    return { eligible: "abstain" };
  }

  if (ans.choice === "yes" || ans.choice === "no") {
    return { eligible: ans.choice };
  }

  return { eligible: "abstain" };
}
