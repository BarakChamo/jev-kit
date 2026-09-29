const CHOICE_LIMIT = 255;

function getItems(input) {
  const items = input?.order?.items;
  return Array.isArray(items) ? items : [];
}

function maxTargetItems(input) {
  return Math.max(0, Math.min(getItems(input).length, CHOICE_LIMIT - 2));
}

function describeItem(item) {
  const parts = [item?.name, item?.sku, item?.category]
    .filter(Boolean)
    .map(String);
  return parts.length ? parts.join(" ") : "unknown item";
}

function targetCriteria(input) {
  const items = getItems(input);
  const max = maxTargetItems(input);
  const criteria = {};

  for (let i = 0; i < max; i += 1) {
    criteria[`item_${i}`] =
      `The customer asks to return only ${describeItem(items[i])}.`;
  }

  criteria.ambiguous =
    "The customer asks to return more than one item, the requested item cannot be identified, or the requested item is not listed.";
  criteria.none =
    "The customer is not asking to return any item.";

  return criteria;
}

function targetIndex(raw, list) {
  const value = String(raw).trim().toLowerCase();

  const match = value.match(/^item_(\d+)$/);
  if (match) return Number(match[1]);

  const matches = [];
  list.forEach((item, i) => {
    const sku = String(item?.sku ?? "").trim().toLowerCase();
    if (sku && sku === value) matches.push(i);
  });

  return matches.length === 1 ? matches[0] : -1;
}

function choiceValue(answers, id) {
  const value = answers?.[id]?.choice;
  return typeof value === "string" ? value.trim().toLowerCase() : undefined;
}

function isFinalSale(item) {
  const value = item?.final_sale;
  if (value === true || value === 1) return true;
  return /^(true|yes|y|final[_- ]?sale)$/i.test(String(value ?? ""));
}

function isGiftCard(item) {
  const text = [
    item?.category,
    item?.name,
    item?.sku,
    item?.type,
    item?.product_type,
  ]
    .filter(Boolean)
    .join(" ");

  return /gift[-_ ]?card/i.test(text);
}

function isElectronics(item) {
  return /electronic/i.test(String(item?.category ?? ""));
}

function utcDayNumber(value) {
  if (typeof value !== "string") return NaN;

  const match = value.trim().slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return NaN;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

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

function requestDay(input, item) {
  const requestDayNumber = utcDayNumber(input?.request?.date);
  const deliveredDayNumber = utcDayNumber(item?.delivered_date);

  if (!Number.isFinite(requestDayNumber) || !Number.isFinite(deliveredDayNumber)) {
    return NaN;
  }

  return requestDayNumber - deliveredDayNumber + 1;
}

export function buildState(input) {
  const items = getItems(input);
  const max = maxTargetItems(input);

  return {
    policy: typeof input?.policy_text === "string" ? input.policy_text : "",
    request: {
      date: input?.request?.date ?? "",
      message: input?.request?.message ?? "",
    },
    items: items.slice(0, max).map((item, i) => ({
      option: `item_${i}`,
      sku: item?.sku ?? "",
      name: item?.name ?? "",
      category: item?.category ?? "",
      final_sale: item?.final_sale ?? false,
      delivered_date: item?.delivered_date ?? "",
    })),
  };
}

export function questions(input) {
  return {
    target: {
      type: "choice",
      instructions:
        "Using the customer's request message and the items in state, choose the single item the customer is asking to return. " +
        "If the customer asks to return multiple items, the item is unclear, or the item is not listed, choose ambiguous. " +
        "If no return is being requested, choose none.",
      criteria: targetCriteria(input),
    },
    opened: {
      type: "choice",
      instructions:
        "For the item the customer wants to return, decide whether the customer says it has been opened or used. " +
        "If the target item is unclear or there is no clear statement, choose unknown.",
      criteria: {
        yes: "The customer says the item was opened, used, unsealed, or the seal is broken.",
        no: "The customer says the item is unopened, never opened, sealed, or unused.",
        unknown: "The customer does not clearly state whether the item was opened, or the target item is unclear.",
      },
    },
    defective: {
      type: "choice",
      instructions:
        "For the item the customer wants to return, decide whether the customer says it is defective, damaged, faulty, or not working. " +
        "If the target item is unclear or there is no clear statement, choose unknown.",
      criteria: {
        yes: "The customer says the item is defective, damaged, faulty, broken, or not working.",
        no: "The customer says the item is not defective, not damaged, not faulty, or works fine.",
        unknown: "The customer does not clearly state whether the item is defective, or the target item is unclear.",
      },
    },
  };
}

export function decide(answers, input) {
  const rawTarget = answers?.target?.choice;
  if (typeof rawTarget !== "string") {
    return { eligible: "abstain" };
  }

  const items = getItems(input);
  const idx = targetIndex(rawTarget, items);

  if (idx < 0 || idx >= items.length || idx >= maxTargetItems(input)) {
    return { eligible: "abstain" };
  }

  const item = items[idx];
  if (!item) {
    return { eligible: "abstain" };
  }

  if (isFinalSale(item) || isGiftCard(item)) {
    return { eligible: "no" };
  }

  const day = requestDay(input, item);
  if (!Number.isFinite(day) || day < 1) {
    return { eligible: "abstain" };
  }

  if (day > 30) {
    return { eligible: "no" };
  }

  if (!isElectronics(item)) {
    return { eligible: day <= 30 ? "yes" : "no" };
  }

  const defective = choiceValue(answers, "defective");
  if (defective === "yes") {
    return { eligible: "yes" };
  }

  const opened = choiceValue(answers, "opened");

  if (day <= 15) {
    if (opened === "no") {
      return { eligible: "yes" };
    }

    if (opened === "yes" && defective === "no") {
      return { eligible: "no" };
    }

    return { eligible: "abstain" };
  }

  if (defective === "no") {
    return { eligible: "no" };
  }

  return { eligible: "abstain" };
}
