const GATE = 0.8;
const DAY_MS = 86400000;
const COMMON_DAYS = [7, 14, 15, 30, 45, 60, 90, 120, 180, 365];

function noulQuestion(instructions) {
  return {
    type: "noul",
    instructions,
    criteria: {
      true: "the text states this",
      false: "the text does not state this",
    },
  };
}

function dayChoices() {
  const criteria = {};
  for (const days of COMMON_DAYS) {
    criteria[String(days)] = `${days} days`;
  }
  criteria.other = "some other number of days not listed";
  criteria.not_stated = "the policy does not state a specific number of days";
  return criteria;
}

function itemChoices(order) {
  const criteria = {};
  const items = order?.items || [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const description = [item.sku, item.name, item.category].filter(Boolean).join(" — ");
    criteria[`item_${i}`] = description || `item ${i}`;
  }
  criteria.ambiguous =
    "the message is genuinely unclear which item to return, or refers to more than one item";
  criteria.none = "the message does not ask to return any item";
  return criteria;
}

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    order: input.order,
    request: input.request,
  };
}

export function questions(input) {
  return {
    policy_general_days: {
      type: "choice",
      instructions:
        "In `policy_text`, how many days after delivery does it say most items can be returned?",
      criteria: dayChoices(),
    },
    policy_electronics_days: {
      type: "choice",
      instructions:
        "In `policy_text`, for an electronic item that is not defective, how many days after delivery can it be returned?",
      criteria: dayChoices(),
    },
    policy_defective_electronics_days: {
      type: "choice",
      instructions:
        "In `policy_text`, for a defective electronic item, how many days after delivery can it be returned?",
      criteria: dayChoices(),
    },
    policy_electronics_unopened_only: noulQuestion(
      "In `policy_text`, does it say that electronics can be returned only if unopened, unless the item is defective?"
    ),
    policy_final_sale_excluded: noulQuestion(
      "In `policy_text`, does it say that items marked final sale cannot be returned?"
    ),
    policy_gift_card_excluded: noulQuestion(
      "In `policy_text`, does it say that gift cards cannot be returned?"
    ),
    policy_delivery_day_counts: noulQuestion(
      "In `policy_text`, does it state that the delivery day counts as day 1 of the return window?"
    ),
    item_choice: {
      type: "choice",
      instructions:
        "Which item in `order.items` does `request.message` ask to return? Choose the item the customer identifies as the one to return, not items they are keeping. If the message is ambiguous or asks about more than one item, choose `ambiguous`; if no item is asked to be returned, choose `none`.",
      criteria: itemChoices(input.order),
    },
    message_unopened: noulQuestion(
      "Does `request.message` state that the item the customer wants to return is unopened, sealed, unused, or never opened?"
    ),
    message_opened: noulQuestion(
      "Does `request.message` state that the item the customer wants to return has been opened, unsealed, or used?"
    ),
    message_defective: noulQuestion(
      "Does `request.message` state that the item the customer wants to return is defective, broken, damaged, or not working?"
    ),
  };
}

function getChoiceAnswer(answer) {
  if (!answer || !answer.choice) return undefined;
  const probability = answer.probabilities?.[answer.choice];
  if (typeof probability !== "number") return undefined;
  return { label: answer.choice, probability };
}

function parseDaysFromChoice(answer) {
  const selected = getChoiceAnswer(answer);
  if (!selected || selected.probability < GATE) return undefined;
  if (selected.label === "other" || selected.label === "not_stated") return undefined;
  const days = Number(selected.label);
  return Number.isInteger(days) && days > 0 ? days : undefined;
}

function getItemIndex(answer) {
  const selected = getChoiceAnswer(answer);
  if (!selected || selected.probability < GATE) return undefined;
  if (!selected.label.startsWith("item_")) return undefined;
  const index = Number(selected.label.slice("item_".length));
  return Number.isInteger(index) ? index : undefined;
}

function boolFromNoul(answer) {
  const probability = answer?.noul;
  if (typeof probability !== "number" || Number.isNaN(probability)) return undefined;
  if (probability >= GATE) return true;
  if (probability <= 1 - GATE) return false;
  return undefined;
}

function parseDate(date) {
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function isWithinDays(startDate, endDate, inclusiveFirstDay, windowDays) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (start === undefined || end === undefined) return undefined;
  if (end < start) return false;

  const differenceDays = Math.round((end - start) / DAY_MS);
  const elapsedDays = inclusiveFirstDay ? differenceDays + 1 : differenceDays;
  return elapsedDays <= windowDays;
}

function isGiftCard(item) {
  const text = `${item?.name || ""} ${item?.category || ""} ${item?.sku || ""}`.toLowerCase();
  return /gift\s*card|giftcard|gift\s*certificate|gift\s*voucher/.test(text);
}

export function decide(answers, input) {
  const itemIndex = getItemIndex(answers.item_choice);
  if (itemIndex === undefined) return { eligible: "abstain" };

  const item = input.order?.items?.[itemIndex];
  if (!item) return { eligible: "abstain" };

  const finalSaleExcluded = boolFromNoul(answers.policy_final_sale_excluded);
  const giftCardExcluded = boolFromNoul(answers.policy_gift_card_excluded);

  if (item.final_sale === true) {
    if (finalSaleExcluded === true) return { eligible: "no" };
    if (finalSaleExcluded === undefined) return { eligible: "abstain" };
  }

  if (isGiftCard(item)) {
    if (giftCardExcluded === true) return { eligible: "no" };
    if (giftCardExcluded === undefined) return { eligible: "abstain" };
  }

  const inclusiveFirstDay = boolFromNoul(answers.policy_delivery_day_counts);
  if (inclusiveFirstDay === undefined) return { eligible: "abstain" };

  const category = String(item.category || "").toLowerCase();
  const isElectronics = category.includes("electron");
  let windowDays;

  if (isElectronics) {
    const defective = boolFromNoul(answers.message_defective);
    if (defective === undefined) return { eligible: "abstain" };

    if (defective === true) {
      windowDays = parseDaysFromChoice(answers.policy_defective_electronics_days);
      if (windowDays === undefined) return { eligible: "abstain" };
    } else {
      windowDays = parseDaysFromChoice(answers.policy_electronics_days);
      if (windowDays === undefined) return { eligible: "abstain" };

      const unopenedOnly = boolFromNoul(answers.policy_electronics_unopened_only);
      if (unopenedOnly === undefined) return { eligible: "abstain" };

      if (unopenedOnly === true) {
        const unopened = boolFromNoul(answers.message_unopened);
        const opened = boolFromNoul(answers.message_opened);

        if (unopened === true && opened === true) return { eligible: "abstain" };
        if (opened === true) return { eligible: "no" };
        if (unopened !== true) return { eligible: "abstain" };
      }
    }
  } else {
    windowDays = parseDaysFromChoice(answers.policy_general_days);
    if (windowDays === undefined) return { eligible: "abstain" };
  }

  const within = isWithinDays(
    item.delivered_date,
    input.request?.date,
    inclusiveFirstDay,
    windowDays
  );

  if (within === undefined) return { eligible: "abstain" };
  return { eligible: within ? "yes" : "no" };
}
