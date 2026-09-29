// map.mjs
// Decides whether the item a customer is asking about in a free-text return
// request is eligible for return, per an order-specific returns policy.

const ITEM_Q_PREFIX = "elig_";

function itemQuestionId(sku) {
  return ITEM_Q_PREFIX + sku;
}

export function buildState(input) {
  const { policy_text, order, request } = input;
  return { policy_text, order, request };
}

export function questions(input) {
  const items = input.order.items;
  const q = {};

  // 1) Which item (if any) is the customer asking to return?
  const choiceCriteria = {};
  for (const item of items) {
    choiceCriteria[item.sku] = `The customer is asking to return "${item.name}" (SKU ${item.sku}, category: ${item.category}).`;
  }
  choiceCriteria["none"] = "The message does not clearly ask to return any single item from this order.";
  choiceCriteria["multiple"] = "The message asks to return more than one distinct item from this order.";

  q["target_item"] = {
    type: "choice",
    instructions:
      "The state contains an order with multiple items (order.items) and a customer request (request.message). " +
      "Determine which single item from order.items the customer is asking to return, based on the message text " +
      "(item names, descriptions, or unambiguous references). If the message clearly refers to keeping an item, " +
      "do not select that item. If the message asks about more than one item, choose 'multiple'. If it's unclear " +
      "which item (or no item in this order) is referenced, choose 'none'.",
    criteria: choiceCriteria,
  };

  // 2) For each item, is it eligible for return under the policy, as of the
  //    request date, taking into account any relevant claims in the message
  //    (e.g. defective, unopened) that the policy conditions on?
  for (const item of items) {
    q[itemQuestionId(item.sku)] = {
      type: "noul",
      instructions:
        `The state's policy_text is the store's returns policy. The item under review is "${item.name}" ` +
        `(SKU ${item.sku}, category: ${item.category}, final_sale: ${item.final_sale}, ` +
        `delivered_date: ${item.delivered_date}, price: ${item.price}). The request was made on request.date. ` +
        "Determine whether THIS item is eligible for return under the policy, applying the policy's rules " +
        "(return window, category-specific rules, final-sale exclusions, day-counting rule, and any conditions " +
        "such as 'unopened' or 'defective') using the delivered_date and request.date, and any relevant, " +
        "concrete claims about this item in request.message (e.g. that it is unopened, opened, or defective). " +
        "Do not assume facts not supported by the item data or the message.",
      criteria: {
        true: "The item is eligible for return under the policy given the dates and conditions above.",
        false: "The item is NOT eligible for return under the policy given the dates and conditions above.",
      },
    };
  }

  return q;
}

export function decide(answers, input) {
  const targetAnswer = answers["target_item"];
  if (!targetAnswer || targetAnswer.type !== "choice") return { eligible: "abstain" };

  const choice = targetAnswer.choice;
  const confidence = targetAnswer.confidence ?? 0;

  if (choice === "none" || choice === "multiple") return { eligible: "abstain" };
  if (confidence < 0.6) return { eligible: "abstain" };

  const skus = new Set(input.order.items.map((i) => i.sku));
  if (!skus.has(choice)) return { eligible: "abstain" };

  const eligAnswer = answers[itemQuestionId(choice)];
  if (!eligAnswer || eligAnswer.type !== "noul") return { eligible: "abstain" };

  const p = eligAnswer.noul;
  if (p >= 0.85) return { eligible: "yes" };
  if (p <= 0.15) return { eligible: "no" };
  return { eligible: "abstain" };
}
