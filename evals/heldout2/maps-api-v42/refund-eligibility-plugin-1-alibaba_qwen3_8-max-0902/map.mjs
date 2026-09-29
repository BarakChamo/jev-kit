const GATE = 0.8;
const DAY_MS = 86400000;

const GENERAL_WINDOW_DAYS = 30;
const ELECTRONICS_WINDOW_DAYS = 15;
const ELECTRONICS_DEFECTIVE_WINDOW_DAYS = 30;

const GIFT_PATTERN = /gift[\s\-_]?card|gift[\s\-_]?certificate/i;

function truthy(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function normalizeItems(input) {
  const items = Array.isArray(input?.order?.items) ? input.order.items : [];
  return items.map((item, index) => ({
    index,
    sku: item?.sku ?? "",
    name: item?.name ?? "",
    category: item?.category ?? "",
    final_sale: truthy(item?.final_sale),
    price: item?.price ?? null,
    delivered_date: item?.delivered_date ?? "",
  }));
}

function isElectronicsCategory(category) {
  return /electronic/i.test(String(category ?? ""));
}

function isGiftCard(item) {
  const category = String(item.category ?? "").toLowerCase();

  if (GIFT_PATTERN.test(category)) return true;
  if (category.trim() !== "") return false;

  const name = String(item.name ?? "").toLowerCase();
  const sku = String(item.sku ?? "").toLowerCase();
  return GIFT_PATTERN.test(name) || GIFT_PATTERN.test(sku);
}

function parseISODate(value) {
  if (typeof value !== "string") return null;

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const utc = Date.UTC(year, month - 1, day);
  const date = new Date(utc);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return utc;
}

function choiceProbability(answer) {
  if (!answer || typeof answer.choice !== "string") return 0;

  let probability = answer.probabilities?.[answer.choice];
  if (!finiteNumber(probability)) probability = answer.confidence;
  if (!finiteNumber(probability)) return 0;

  return clamp01(probability);
}

function noulLabel(answer) {
  if (!answer || !finiteNumber(answer.noul)) return "unknown";

  const pTrue = clamp01(answer.noul);
  const pFalse = 1 - pTrue;

  if (pTrue >= pFalse) {
    return pTrue >= GATE ? "true" : "unknown";
  }

  return pFalse >= GATE ? "false" : "unknown";
}

export function buildState(input) {
  return {
    policy_text: input?.policy_text ?? "",
    order: {
      order_id: input?.order?.order_id ?? "",
      items: normalizeItems(input),
    },
    request: {
      date: input?.request?.date ?? "",
      message: input?.request?.message ?? "",
    },
    convention:
      "The delivery day counts as day 1 of a return window. A request on day 30 is within a 30-day window; day 31 is not.",
  };
}

export function questions(input) {
  const items = normalizeItems(input);
  const questionsMap = {};

  if (!items.length || items.length + 1 > 255) {
    return questionsMap;
  }

  const askedItemCriteria = {};

  for (const item of items) {
    askedItemCriteria[`item_${item.index}`] =
      `${item.name || "Unknown item"} — SKU: ${item.sku || "unknown"}; ` +
      `category: ${item.category || "unknown"}; delivered: ${item.delivered_date || "unknown"}`;
  }

  askedItemCriteria.not_single =
    "The message does not identify exactly one item to return: no item is requested, " +
    "multiple items are requested, or the requested item cannot be identified.";

  questionsMap.asked_item = {
    type: "choice",
    instructions:
      "Which single item from order.items is the customer asking to return in request.message? " +
      "Match the message to the item name, SKU, or category. " +
      "Choose not_single unless exactly one item is clearly requested.",
    criteria: askedItemCriteria,
  };

  items.forEach((item, index) => {
    if (!isElectronicsCategory(item.category)) return;
    if (item.final_sale || isGiftCard(item)) return;

    const label = `order.items[${index}] (${item.name || item.sku || "unknown item"})`;

    questionsMap[`unopened_${index}`] = {
      type: "noul",
      instructions:
        `Does request.message explicitly state that ${label} is unopened, never opened, or still sealed?`,
      criteria: {
        true: "the message says this item has not been opened or remains sealed",
        false: "the message does not say this item is unopened",
      },
    };

    questionsMap[`opened_${index}`] = {
      type: "noul",
      instructions:
        `Does request.message explicitly state that ${label} was opened, used, or is no longer sealed?`,
      criteria: {
        true: "the message says this item was opened or used",
        false: "the message does not say this item was opened or used",
      },
    };

    questionsMap[`defective_${index}`] = {
      type: "noul",
      instructions:
        `Does request.message explicitly state that ${label} is defective, faulty, damaged, broken, or not working?`,
      criteria: {
        true: "the message says this item is defective or not working",
        false: "the message does not say this item is defective",
      },
    };
  });

  return questionsMap;
}

export function decide(answers, input) {
  try {
    if (!answers || typeof answers !== "object") {
      return { eligible: "abstain" };
    }

    const items = normalizeItems(input);
    if (!items.length) {
      return { eligible: "abstain" };
    }

    const askedItem = answers.asked_item;
    if (!askedItem || typeof askedItem.choice !== "string") {
      return { eligible: "abstain" };
    }

    if (choiceProbability(askedItem) < GATE) {
      return { eligible: "abstain" };
    }

    if (askedItem.choice === "not_single") {
      return { eligible: "abstain" };
    }

    const match = /^item_(\d+)$/.exec(askedItem.choice);
    if (!match) {
      return { eligible: "abstain" };
    }

    const index = Number(match[1]);
    if (!Number.isInteger(index) || index < 0 || index >= items.length) {
      return { eligible: "abstain" };
    }

    const item = items[index];

    if (item.final_sale || isGiftCard(item)) {
      return { eligible: "no" };
    }

    const requestDate = parseISODate(input?.request?.date);
    const deliveredDate = parseISODate(item.delivered_date);

    if (requestDate === null || deliveredDate === null) {
      return { eligible: "abstain" };
    }

    const day = Math.floor((requestDate - deliveredDate) / DAY_MS) + 1;

    if (day <= 0) {
      return { eligible: "no" };
    }

    const category = String(item.category ?? "").trim().toLowerCase();

    if (!category) {
      return { eligible: "abstain" };
    }

    if (!isElectronicsCategory(category)) {
      return {
        eligible: day <= GENERAL_WINDOW_DAYS ? "yes" : "no",
      };
    }

    const defective = noulLabel(answers[`defective_${index}`]);

    if (defective === "true") {
      return {
        eligible: day <= ELECTRONICS_DEFECTIVE_WINDOW_DAYS ? "yes" : "no",
      };
    }

    if (day > ELECTRONICS_DEFECTIVE_WINDOW_DAYS) {
      return { eligible: "no" };
    }

    if (day > ELECTRONICS_WINDOW_DAYS) {
      return {
        eligible: defective === "false" ? "no" : "abstain",
      };
    }

    const opened = noulLabel(answers[`opened_${index}`]);

    if (opened === "true") {
      return { eligible: "no" };
    }

    const unopened = noulLabel(answers[`unopened_${index}`]);

    if (unopened === "true" && opened === "false") {
      return { eligible: "yes" };
    }

    return { eligible: "abstain" };
  } catch {
    return { eligible: "abstain" };
  }
}
