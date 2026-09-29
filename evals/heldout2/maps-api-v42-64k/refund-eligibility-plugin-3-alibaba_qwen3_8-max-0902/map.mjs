const REQUEST_GATE = 0.8;
const NOUL_GATE = 0.8;

const DEFAULT_DAYS = 30;
const ELECTRONICS_DAYS = 15;
const ELECTRONICS_DEFECTIVE_DAYS = 30;

function safeItems(input) {
  const items = input?.order?.items;
  return Array.isArray(items) ? items : [];
}

function itemLabel(item) {
  const name = String(item?.name ?? "unnamed");
  const sku = String(item?.sku ?? "unknown SKU");
  const category = String(item?.category ?? "unknown category");
  return `${name}, SKU ${sku}, category ${category}`;
}

function isElectronics(item) {
  const category = String(item?.category ?? "").toLowerCase();
  return category.includes("electronic");
}

function isGiftCard(item) {
  const text = [item?.category, item?.name, item?.sku]
    .map((value) => String(value ?? ""))
    .join(" ")
    .toLowerCase();
  return /gift[-_ ]?cards?/.test(text);
}

function isFinalSale(item) {
  const value = item?.final_sale;
  return value === true || value === 1 || String(value).toLowerCase() === "true";
}

function isExcluded(item) {
  return isFinalSale(item) || isGiftCard(item);
}

function parseDateUTC(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return NaN;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) return NaN;

  const utc = Date.UTC(year, month - 1, day);
  const date = new Date(utc);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return NaN;
  }

  return utc;
}

function windowDay(requestDate, deliveredDate) {
  const request = parseDateUTC(requestDate);
  const delivered = parseDateUTC(deliveredDate);

  if (!Number.isFinite(request) || !Number.isFinite(delivered)) return NaN;

  return Math.round((request - delivered) / 86400000) + 1;
}

function noulTrue(answer) {
  return !!answer && typeof answer.noul === "number" && answer.noul >= NOUL_GATE;
}

export function buildState(input) {
  const items = safeItems(input);

  return {
    policy_text: input?.policy_text ?? "",
    order: input?.order ?? {},
    request: input?.request ?? {},
    items_summary: items.map((item, index) => ({
      index,
      sku: item?.sku ?? null,
      name: item?.name ?? null,
      category: item?.category ?? null,
      final_sale: item?.final_sale ?? null,
      delivered_date: item?.delivered_date ?? null
    }))
  };
}

export function questions(input) {
  const items = safeItems(input);

  const itemCriteria = {};
  const maxItemOptions = 252;

  if (items.length <= maxItemOptions) {
    items.forEach((item, index) => {
      itemCriteria[`item_${index}`] =
        `request.message asks to return order.items[${index}] (${itemLabel(item)}).`;
    });
  }

  itemCriteria.ambiguous =
    "request.message asks to return an item but does not identify a single item from order.items, asks to return multiple items, or there are too many items to list.";
  itemCriteria.no_return =
    "request.message does not ask to return anything.";
  itemCriteria.not_found =
    "request.message asks to return an item that is clearly not present in order.items.";

  const questions = {
    requested_item: {
      type: "choice",
      instructions:
        "Which item from `order.items` is the customer asking to return in `request.message`? Choose one item. If the message asks for multiple items, is unclear, asks for no item, or asks for an item not in the order, choose the matching non-item option.",
      criteria: itemCriteria
    }
  };

  if (items.length > maxItemOptions) {
    return questions;
  }

  items.forEach((item, index) => {
    if (!isElectronics(item) || isExcluded(item)) return;

    const label = itemLabel(item);

    questions[`defective_${index}`] = {
      type: "noul",
      instructions: `Does \`request.message\` state that \`order.items[${index}]\` (${label}) is defective, faulty, damaged, broken, or not working?`,
      criteria: {
        true: "The message includes a statement that this item is defective, faulty, damaged, broken, or not working.",
        false: "The message does not include such a statement."
      }
    };

    questions[`unopened_${index}`] = {
      type: "noul",
      instructions: `Does \`request.message\` state that \`order.items[${index}]\` (${label}) is unopened, sealed, or has never been opened?`,
      criteria: {
        true: "The message includes a statement that this item is unopened, sealed, or has never been opened.",
        false: "The message does not include such a statement."
      }
    };

    questions[`opened_${index}`] = {
      type: "noul",
      instructions: `Does \`request.message\` state that \`order.items[${index}]\` (${label}) has been opened, unsealed, or used?`,
      criteria: {
        true: "The message includes a statement that this item has been opened, unsealed, or used.",
        false: "The message does not include such a statement."
      }
    };
  });

  return questions;
}

export function decide(answers, input) {
  const items = safeItems(input);
  const requested = answers?.requested_item;

  if (!requested || typeof requested.choice !== "string" || !requested.probabilities) {
    return { eligible: "abstain" };
  }

  const rawProbability = requested.probabilities[requested.choice];
  const requestedProbability =
    typeof rawProbability === "number" && Number.isFinite(rawProbability)
      ? rawProbability
      : 0;

  if (requestedProbability < REQUEST_GATE) {
    return { eligible: "abstain" };
  }

  const match = /^item_(\d+)$/.exec(requested.choice);
  if (!match) {
    return { eligible: "abstain" };
  }

  const index = Number(match[1]);
  const item = items[index];

  if (!item) {
    return { eligible: "abstain" };
  }

  if (isExcluded(item)) {
    return { eligible: "no" };
  }

  const day = windowDay(input?.request?.date, item?.delivered_date);

  if (!Number.isFinite(day) || day < 1) {
    return { eligible: "abstain" };
  }

  if (!isElectronics(item)) {
    return { eligible: day <= DEFAULT_DAYS ? "yes" : "no" };
  }

  if (day > ELECTRONICS_DEFECTIVE_DAYS) {
    return { eligible: "no" };
  }

  const defective = noulTrue(answers?.[`defective_${index}`]);
  const opened = noulTrue(answers?.[`opened_${index}`]);
  const unopened = noulTrue(answers?.[`unopened_${index}`]);

  if (defective) {
    return { eligible: day <= ELECTRONICS_DEFECTIVE_DAYS ? "yes" : "no" };
  }

  if (opened && unopened) {
    return { eligible: "abstain" };
  }

  if (opened) {
    return { eligible: "no" };
  }

  if (unopened) {
    return { eligible: day <= ELECTRONICS_DAYS ? "yes" : "no" };
  }

  return { eligible: "abstain" };
}
