const ACT = 0.8;
const ITEM_PREFIX = "item_";
const MAX_CHOICE_ITEMS = 252;

const STANDARD_WINDOW_DAYS = 30;
const ELECTRONICS_WINDOW_DAYS = 15;
const DEFECTIVE_ELECTRONICS_WINDOW_DAYS = 30;

function asString(value) {
  if (typeof value === "string") return value;
  return value == null ? "" : String(value);
}

function rawItems(input) {
  const items = input?.order?.items;
  return Array.isArray(items) ? items : [];
}

function normalizedItems(input) {
  return rawItems(input).map((item, index) => {
    const finalSale = item?.final_sale;
    return {
      index,
      sku: asString(item?.sku),
      name: asString(item?.name),
      category: asString(item?.category),
      final_sale: finalSale === true || String(finalSale).toLowerCase() === "true",
      price: typeof item?.price === "number" && Number.isFinite(item.price) ? item.price : null,
      delivered_date: asString(item?.delivered_date),
    };
  });
}

function itemDescription(item) {
  return [
    `Position ${item.index + 1}`,
    item.name || "Unknown item",
    `sku: ${item.sku || "unknown"}`,
    `category: ${item.category || "unknown"}`,
    `delivered: ${item.delivered_date || "unknown"}`,
    `final sale: ${item.final_sale ? "yes" : "no"}`,
    `price: ${item.price == null ? "unknown" : item.price}`,
  ].join(" | ");
}

function probability(answer, option) {
  const p = answer?.probabilities?.[option];
  return typeof p === "number" && Number.isFinite(p) ? p : 0;
}

function isChoice(answer, option) {
  return Boolean(answer && answer.choice === option && probability(answer, option) >= ACT);
}

function parseDay(value) {
  const s = asString(value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return NaN;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);

  const ts = Date.UTC(year, month - 1, day);
  const date = new Date(ts);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return NaN;
  }

  return Math.floor(ts / 86400000);
}

function isElectronics(item) {
  return /electronic/i.test(asString(item.category));
}

function isGiftCard(item) {
  const category = asString(item.category).toLowerCase().replace(/[\s_-]+/g, "");
  return category === "giftcard" || category === "giftcards";
}

export function buildState(input) {
  return {
    policy_text: asString(input?.policy_text),
    day_count_convention:
      "The delivery day counts as day 1 of a return window. A request N days after delivery is day N + 1.",
    request: {
      date: asString(input?.request?.date),
      message: asString(input?.request?.message),
    },
    items: normalizedItems(input),
  };
}

export function questions(input) {
  const items = normalizedItems(input);

  if (items.length > MAX_CHOICE_ITEMS) {
    return {
      target_item: {
        type: "choice",
        instructions:
          "The order has too many items to list completely in one choice. Choose `too_many` so a person can decide.",
        criteria: {
          too_many: "The requested item cannot be selected from a complete list of `items`.",
          ambiguous: "A person should decide.",
        },
      },
    };
  }

  const targetCriteria = {};

  if (items.length === 0) {
    targetCriteria.none = "There are no items in `items`.";
    targetCriteria.ambiguous = "The requested item cannot be identified; a person should decide.";
  } else {
    for (const item of items) {
      targetCriteria[`${ITEM_PREFIX}${item.index}`] = itemDescription(item);
    }

    targetCriteria.none =
      "The message in `request.message` does not ask to return any item listed in `items`.";
    targetCriteria.multiple =
      "The message in `request.message` asks to return two or more items listed in `items`.";
    targetCriteria.ambiguous =
      "The message in `request.message` asks to return an item but it cannot be mapped to exactly one item in `items`; a person should decide.";
  }

  const questions = {
    target_item: {
      type: "choice",
      instructions:
        "Which one item in `items` is the customer asking to return in `request.message`? If exactly one listed item is requested, choose that item. If no listed item is requested, choose none. If two or more listed items are requested, choose multiple. If the requested item is unclear, choose ambiguous.",
      criteria: targetCriteria,
    },
  };

  if (items.length > 0) {
    questions.unopened_statement = {
      type: "choice",
      instructions:
        "For the one item in `items` that `request.message` asks to return, what does `request.message` state about whether that item has been opened? If no single item can be identified, or the message asks to return multiple items, choose ambiguous.",
      criteria: {
        unopened:
          "The message in `request.message` states that the requested item is unopened, never opened, sealed, or unused.",
        opened:
          "The message in `request.message` states that the requested item has been opened or used.",
        not_stated:
          "The message in `request.message` does not state whether the requested item is opened or unopened.",
        ambiguous:
          "The statement about opened or unopened is conflicting, cannot be tied to the requested item, or a person should decide.",
      },
    };

    questions.defective_statement = {
      type: "choice",
      instructions:
        "For the one item in `items` that `request.message` asks to return, what does `request.message` state about whether that item is defective? If no single item can be identified, or the message asks to return multiple items, choose ambiguous.",
      criteria: {
        defective:
          "The message in `request.message` states that the requested item is defective, faulty, damaged, broken, or not working.",
        not_defective:
          "The message in `request.message` states that the requested item is not defective or works normally.",
        not_stated:
          "The message in `request.message` does not state whether the requested item is defective.",
        ambiguous:
          "The statement about defect is conflicting, cannot be tied to the requested item, or a person should decide.",
      },
    };
  }

  return questions;
}

export function decide(answers, input) {
  try {
    const items = normalizedItems(input);
    const targetAnswer = answers?.target_item;

    if (!targetAnswer || typeof targetAnswer.choice !== "string") {
      return { eligible: "abstain" };
    }

    const targetChoice = targetAnswer.choice;

    if (!targetChoice.startsWith(ITEM_PREFIX)) {
      return { eligible: "abstain" };
    }

    if (probability(targetAnswer, targetChoice) < ACT) {
      return { eligible: "abstain" };
    }

    const index = Number(targetChoice.slice(ITEM_PREFIX.length));
    const item = items[index];

    if (!Number.isInteger(index) || index < 0 || !item) {
      return { eligible: "abstain" };
    }

    if (item.final_sale || isGiftCard(item)) {
      return { eligible: "no" };
    }

    const requestDay = parseDay(input?.request?.date);
    const deliveredDay = parseDay(item.delivered_date);

    if (!Number.isFinite(requestDay) || !Number.isFinite(deliveredDay)) {
      return { eligible: "abstain" };
    }

    const dayOfWindow = requestDay - deliveredDay + 1;

    if (dayOfWindow < 1) {
      return { eligible: "abstain" };
    }

    if (!isElectronics(item)) {
      return { eligible: dayOfWindow <= STANDARD_WINDOW_DAYS ? "yes" : "no" };
    }

    if (dayOfWindow > DEFECTIVE_ELECTRONICS_WINDOW_DAYS) {
      return { eligible: "no" };
    }

    const defectiveAnswer = answers?.defective_statement;

    if (isChoice(defectiveAnswer, "defective")) {
      return { eligible: "yes" };
    }

    if (dayOfWindow > ELECTRONICS_WINDOW_DAYS) {
      if (isChoice(defectiveAnswer, "not_defective")) {
        return { eligible: "no" };
      }
      return { eligible: "abstain" };
    }

    const unopenedAnswer = answers?.unopened_statement;

    if (isChoice(unopenedAnswer, "unopened")) {
      return { eligible: "yes" };
    }

    if (isChoice(unopenedAnswer, "opened")) {
      return { eligible: "no" };
    }

    return { eligible: "abstain" };
  } catch {
    return { eligible: "abstain" };
  }
}
