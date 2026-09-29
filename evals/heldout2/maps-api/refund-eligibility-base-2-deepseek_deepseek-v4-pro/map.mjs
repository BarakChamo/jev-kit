const ONE_DAY_MS = 86400000;
const AMBIGUOUS = "AMBIGUOUS";

function parseDate(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

function dayWindow(deliveredDate, requestDate) {
  const delivered = parseDate(deliveredDate);
  const request = parseDate(requestDate);
  if (delivered == null || request == null) return null;
  return Math.round((request - delivered) / ONE_DAY_MS) + 1;
}

function isGiftCard(item) {
  const category = String(item.category || '').toLowerCase();
  if (category) {
    return /gift[\s_-]?cards?/.test(category) || /giftcard/.test(category);
  }
  const name = String(item.name || '').toLowerCase();
  return /gift[\s_-]?cards?/.test(name) || /giftcard/.test(name);
}

function isElectronics(item) {
  return String(item.category || '').toLowerCase() === 'electronics';
}

function itemFromChoice(choice, items) {
  if (!choice) return null;
  const match = /^item_(\d+)$/.exec(choice);
  if (!match) return null;
  return items[Number(match[1])] || null;
}

function noulTrue(answer) {
  return Boolean(answer && typeof answer.noul === 'number' && answer.noul > 0.5);
}

export function buildState(input) {
  return input;
}

export function questions(input) {
  const items = Array.isArray(input?.order?.items) ? input.order.items : [];
  const itemOptions = {};

  items.forEach((item, index) => {
    itemOptions[`item_${index}`] = `${item.name} (SKU: ${item.sku})`;
  });

  itemOptions[AMBIGUOUS] = "The message is ambiguous, mentions multiple items, does not specify a single item, or refers to an item not in the order.";

  const qs = {
    item: {
      type: "choice",
      instructions: "Given the customer's free-text return request and the order, identify the single item the customer is asking to return. Choose the option that best matches the request. If the request mentions multiple items, does not specify a single item, or refers to an item not in the order, choose AMBIGUOUS.",
      criteria: itemOptions
    }
  };

  if (items.some(isElectronics)) {
    qs.unopened = {
      type: "noul",
      instructions: "Does the customer's message indicate that the item they want to return is unopened, sealed, new, or never opened?",
      criteria: {
        "true": "The message indicates the item is unopened/sealed/new/never opened.",
        "false": "The message does not indicate the item is unopened/sealed/new/never opened."
      }
    };

    qs.defective = {
      type: "noul",
      instructions: "Does the customer's message indicate that the item they want to return is defective, broken, damaged, or not working?",
      criteria: {
        "true": "The message indicates the item is defective/broken/damaged/not working.",
        "false": "The message does not indicate the item is defective/broken/damaged/not working."
      }
    };

    qs.opened_used = {
      type: "noul",
      instructions: "Does the customer's message indicate that the item they want to return has already been opened, used, worn, or is otherwise not in new condition?",
      criteria: {
        "true": "The message indicates the item has been opened/used/worn/not new.",
        "false": "The message does not indicate the item has been opened/used/worn/not new."
      }
    };
  }

  return qs;
}

export function decide(answers, input) {
  const items = Array.isArray(input?.order?.items) ? input.order.items : [];
  const itemAnswer = answers?.item;

  if (!itemAnswer || itemAnswer.choice === AMBIGUOUS) {
    return "abstain";
  }
  if (typeof itemAnswer.confidence === "number" && itemAnswer.confidence < 0.5) {
    return "abstain";
  }

  const item = itemFromChoice(itemAnswer.choice, items);
  if (!item) return "abstain";

  const days = dayWindow(item.delivered_date, input?.request?.date);
  if (days == null || days <= 0) return "abstain";

  if (item.final_sale || isGiftCard(item)) return "no";

  if (!isElectronics(item)) {
    return days <= 30 ? "yes" : "no";
  }

  if (noulTrue(answers?.defective)) {
    return days <= 30 ? "yes" : "no";
  }
  if (noulTrue(answers?.opened_used)) {
    return "no";
  }
  if (noulTrue(answers?.unopened)) {
    return days <= 15 ? "yes" : "no";
  }
  if (days > 30) {
    return "no";
  }

  return "abstain";
}
