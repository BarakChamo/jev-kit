export function buildState(input) {
  return input;
}

export function questions(input) {
  const items = (input && Array.isArray(input.order?.items)) ? input.order.items : [];

  const itemOptions = {};
  for (const item of items) {
    const tags = [`SKU: ${item.sku}`];
    if (item.category) tags.push(`category: ${item.category}`);
    if (item.final_sale) tags.push("final sale");
    itemOptions[item.sku] = `${item.name} (${tags.join(", ")})`;
  }
  itemOptions.none = "The customer does not request a return, or the item they mention is not part of this order";
  itemOptions.multiple = "The customer clearly requests to return multiple distinct items from this order";

  return {
    item: {
      type: "choice",
      instructions: "From the customer's free-text return request message, identify which single item from this order they are requesting to return. Match by item name or any other identifying description in the customer's message. If the customer does not request a return at all, or if the item they reference is not part of this order, choose 'none'. If the customer clearly wants to return multiple distinct items from this order, choose 'multiple'. Otherwise, choose the SKU of the single item they want to return.",
      criteria: itemOptions
    },
    opened: {
      type: "noul",
      instructions: "From the customer's free-text message, determine whether the customer states or implies they have opened, unsealed, removed packaging from, or used the item they want to return. Mark 'true' if there is clear evidence they opened or used it (phrases like 'I opened it', 'I tried it', 'I tested it', 'tried it on', 'unboxed', 'I wore it', 'used it once', 'I plugged it in'). Mark 'false' if there is clear evidence the item is unopened/sealed (phrases like 'never opened', 'still sealed', 'unopened', 'I haven't opened it', 'factory sealed', 'unopened box', 'still in shrink wrap'). If no information about opening is provided or the message is ambiguous on opening, the probability should be near 0.5.",
      criteria: {
        true: "Customer clearly states or implies the item has been opened, unsealed, or used",
        false: "Customer clearly states the item is unopened or sealed"
      }
    },
    defective: {
      type: "noul",
      instructions: "From the customer's free-text message, determine whether the customer is claiming the item is defective, damaged, broken, faulty, not working as expected, or has a flaw. Mark 'true' for clear defect or damage claims (phrases like 'doesn't work', 'stopped working', 'broken', 'defective', 'damaged', 'arrived broken', 'arrived damaged', 'has a crack', 'flaw', 'faulty', \"won't turn on\", 'screen is cracked', 'dead on arrival'). Mark 'false' if the customer's stated reason is clearly something other than a defect or damage (e.g., 'changed my mind', 'ordered the wrong one', 'doesn't match my decor', 'doesn't fit', 'no longer needed', 'found a better price', 'duplicate order'). If no reason for return is provided or the message is ambiguous about defect/damage, the probability should be near 0.5.",
      criteria: {
        true: "Customer claims the item is defective, damaged, broken, or not working as expected",
        false: "Customer clearly states a non-defect reason for the return"
      }
    }
  };
}

export function decide(answers, input) {
  if (!answers || !input || !Array.isArray(input.order?.items)) {
    return { eligible: "abstain" };
  }

  // 1. Identify the item the customer wants to return
  const itemAns = answers.item;
  if (!itemAns || typeof itemAns.choice !== "string") {
    return { eligible: "abstain" };
  }
  const choice = itemAns.choice;
  if (choice === "none" || choice === "multiple") {
    return { eligible: "abstain" };
  }
  if (typeof itemAns.confidence === "number" && itemAns.confidence < 0.6) {
    return { eligible: "abstain" };
  }
  const item = input.order.items.find(i => i.sku === choice);
  if (!item) {
    return { eligible: "abstain" };
  }

  // 2. Compute day count (delivery day = day 1)
  const deliveredDate = parseDate(item.delivered_date);
  const requestDate = parseDate(input.request?.date);
  if (!deliveredDate || !requestDate) {
    return { eligible: "abstain" };
  }
  const days = Math.round((requestDate - deliveredDate) / 86400000) + 1;

  // 3. Final sale and gift cards cannot be returned
  if (item.final_sale === true) return { eligible: "no" };
  const itemName = String(item.name || "");
  const itemCat = String(item.category || "").toLowerCase();
  if (itemCat === "gift card" || /gift\s*card/i.test(itemName)) {
    return { eligible: "no" };
  }

  // 4. Non-electronics: simple 30-day window
  if (itemCat !== "electronics") {
    return { eligible: days <= 30 ? "yes" : "no" };
  }

  // 5. Electronics: 30 days if defective; otherwise 15 days and unopened
  const openedProb = answers.opened && typeof answers.opened.noul === "number" ? answers.opened.noul : null;
  const defectiveProb = answers.defective && typeof answers.defective.noul === "number" ? answers.defective.noul : null;
  const opened = decisive(openedProb);
  const defective = decisive(defectiveProb);

  if (defective === true) {
    return { eligible: days <= 30 ? "yes" : "no" };
  }
  if (days > 30) return { eligible: "no" };
  if (days > 15) {
    if (defective === false) return { eligible: "no" };
    return { eligible: "abstain" };
  }
  if (defective === false) {
    if (opened === false) return { eligible: "yes" };
    if (opened === true) return { eligible: "no" };
    return { eligible: "abstain" };
  }
  if (opened === false) return { eligible: "yes" };
  return { eligible: "abstain" };
}

function parseDate(s) {
  if (typeof s !== "string") return null;
  const dateStr = /T/.test(s) ? s : s + "T00:00:00Z";
  const t = Date.parse(dateStr);
  return Number.isNaN(t) ? null : new Date(t);
}

function decisive(prob) {
  if (typeof prob !== "number") return null;
  if (prob >= 0.7) return true;
  if (prob <= 0.3) return false;
  return null;
}
