const MAX_EXACT_DAYS = 250;
const TARGET_GATE = 0.9;
const FACT_GATE = 0.85;

function itemsOf(input) {
  return Array.isArray(input?.order?.items) ? input.order.items : [];
}

function utcDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) ? time : null;
}

function requestDayNumber(deliveredDate, requestDate) {
  const delivered = utcDay(deliveredDate);
  const requested = utcDay(requestDate);
  if (delivered === null || requested === null) return null;
  return Math.round((requested - delivered) / 86400000) + 1;
}

function probability(answer, label) {
  return answer?.probabilities?.[label] ?? 0;
}

function windowCriteria() {
  const criteria = {};
  for (let day = 0; day <= MAX_EXACT_DAYS; day += 1) {
    criteria[String(day)] = `The policy states a maximum return window of exactly ${day} calendar days for this scenario.`;
  }
  criteria.more_than_250_days =
    "The policy states a numeric maximum return window longer than 250 calendar days for this scenario.";
  criteria.no_return_allowed =
    "The policy states that this item cannot be returned in this scenario.";
  criteria.no_numeric_window_stated =
    "The policy does not state a usable numeric maximum return window for this scenario.";
  criteria.condition_information_required =
    "The policy's applicable return window cannot be determined without condition information not supplied by this scenario.";
  return criteria;
}

export function buildState(input) {
  const items = itemsOf(input);

  return {
    policy_text: input?.policy_text ?? "",
    order: {
      order_id: input?.order?.order_id ?? "",
      items: items.map((item, index) => ({
        index,
        sku: item?.sku ?? "",
        name: item?.name ?? "",
        category: item?.category ?? "",
        final_sale: item?.final_sale === true,
        price: item?.price ?? null,
        delivered_date: item?.delivered_date ?? "",
        request_day_number: requestDayNumber(item?.delivered_date, input?.request?.date),
      })),
    },
    request: {
      date: input?.request?.date ?? "",
      message: input?.request?.message ?? "",
    },
    condition_convention:
      "For eligibility analysis, defective means the customer says the item is defective or faulty. Unopened means the customer says it has not been opened. Opened means the customer says it was opened and does not claim it is defective. Condition not stated means none of those facts is stated clearly.",
    policy_scenarios: items.flatMap((item, itemIndex) =>
      [
        ["defective", "The item is defective or faulty."],
        ["unopened_not_defective", "The item is unopened and is not claimed defective."],
        ["opened_not_defective", "The item was opened and is not claimed defective."],
        ["condition_not_stated", "The request does not state whether the item is defective or unopened."],
      ].map(([condition, description]) => ({
        item_index: itemIndex,
        condition,
        item: {
          sku: item?.sku ?? "",
          name: item?.name ?? "",
          category: item?.category ?? "",
          final_sale: item?.final_sale === true,
        },
        description,
      }))
    ),
  };
}

export function questions(input) {
  const items = itemsOf(input);
  if (items.length === 0 || items.length > 253) return {};

  const targetCriteria = Object.fromEntries(
    items.map((item, index) => [
      String(index),
      `The customer is asking to return this order item: SKU ${item?.sku ?? ""}; name ${item?.name ?? ""}; category ${item?.category ?? ""}.`,
    ])
  );
  targetCriteria.no_identifiable_item =
    "The message does not ask to return any one identifiable item from `order.items`.";
  targetCriteria.ambiguous_item =
    "The message could refer to more than one order item and does not identify one item clearly enough.";

  const map = {
    target_item: {
      type: "choice",
      instructions:
        "Which single item in `order.items` does the customer ask to return in `request.message`? Use identifying words, SKU, name, and unambiguous references in the message. Do not choose an item merely because it is mentioned as being kept or discussed.",
      criteria: targetCriteria,
    },
  };

  for (let index = 0; index < items.length; index += 1) {
    map[`condition_${index}`] = {
      type: "choice",
      instructions:
        `What condition does \`request.message\` state for \`order.items[${index}]\`? Apply the definitions in \`condition_convention\` only to this item.`,
      criteria: {
        defective: "The message states that this item is defective or faulty.",
        unopened_not_defective:
          "The message states that this item is unopened and does not state that it is defective.",
        opened_not_defective:
          "The message states that this item was opened and does not state that it is defective.",
        condition_not_stated:
          "The message does not clearly state whether this item is defective, unopened, or opened.",
      },
    };

    for (const condition of [
      "defective",
      "unopened_not_defective",
      "opened_not_defective",
      "condition_not_stated",
    ]) {
      map[`window_${index}_${condition}`] = {
        type: "choice",
        instructions:
          `What maximum return window does \`policy_text\` state for the item and condition described by the matching entry in \`policy_scenarios\` for item index ${index} and condition "${condition}"? Read the policy's stated number exactly. Do not decide whether the request date is within that window.`,
        criteria: windowCriteria(),
      };
    }
  }

  return map;
}

export function decide(answers, input) {
  const items = itemsOf(input);
  if (items.length === 0 || items.length > 253) return { eligible: "abstain" };

  const target = answers?.target_item;
  const targetLabel = target?.choice;
  if (
    probability(target, targetLabel) < TARGET_GATE ||
    targetLabel === "no_identifiable_item" ||
    targetLabel === "ambiguous_item"
  ) {
    return { eligible: "abstain" };
  }

  const itemIndex = Number(targetLabel);
  if (!Number.isInteger(itemIndex) || !items[itemIndex]) {
    return { eligible: "abstain" };
  }

  const conditionAnswer = answers?.[`condition_${itemIndex}`];
  const condition = conditionAnswer?.choice;
  if (
    !condition ||
    probability(conditionAnswer, condition) < FACT_GATE
  ) {
    return { eligible: "abstain" };
  }

  const windowAnswer = answers?.[`window_${itemIndex}_${condition}`];
  const window = windowAnswer?.choice;
  if (!window || probability(windowAnswer, window) < FACT_GATE) {
    return { eligible: "abstain" };
  }

  if (window === "no_return_allowed") return { eligible: "no" };
  if (
    window === "no_numeric_window_stated" ||
    window === "condition_information_required"
  ) {
    return { eligible: "abstain" };
  }

  const dayNumber = requestDayNumber(items[itemIndex]?.delivered_date, input?.request?.date);
  if (dayNumber === null) return { eligible: "abstain" };
  if (dayNumber < 1) return { eligible: "no" };

  if (window === "more_than_250_days") {
    return dayNumber <= MAX_EXACT_DAYS
      ? { eligible: "yes" }
      : { eligible: "abstain" };
  }

  const maximumDays = Number(window);
  if (!Number.isInteger(maximumDays) || maximumDays < 0) {
    return { eligible: "abstain" };
  }

  return { eligible: dayNumber <= maximumDays ? "yes" : "no" };
}
