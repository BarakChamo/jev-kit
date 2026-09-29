const DAY_MS = 86_400_000;
const MIN_TARGET = 0.55;
const MIN_FACT = 0.55;

function parseDate(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    return isNaN(value) ? null : new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  if (typeof value === "string") {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
      return isNaN(d) ? null : d;
    }
    const d = new Date(value);
    return isNaN(d) ? null : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  return null;
}

function isTrue(value) {
  if (value === true) return true;
  const s = String(value ?? "").trim().toLowerCase();
  return s === "true" || s === "yes" || s === "1";
}

function isElectronics(item) {
  const category = String(item?.category ?? "").toLowerCase();
  if (/electronic/.test(category)) return true;
  if (!category) {
    const name = String(item?.name ?? "").toLowerCase();
    return /headphone|earbud|laptop|phone|tablet|camera|television|tv|monitor|speaker|smartwatch|electronic/.test(name);
  }
  return false;
}

function isGiftCard(item) {
  const text = [item?.name, item?.category, item?.sku].map((v) => String(v ?? "")).join(" ");
  return /gift[-\s]?card/i.test(text);
}

function describeItem(item) {
  const parts = [];
  if (item.name) parts.push(`"${item.name}"`);
  if (item.sku) parts.push(`SKU ${item.sku}`);
  if (item.category) parts.push(`category ${item.category}`);
  if (item.delivered_date) parts.push(`delivered ${item.delivered_date}`);
  return parts.length ? parts.join(", ") : "an unknown item";
}

function buildItem(item, requestDate) {
  const delivered = parseDate(item?.delivered_date);
  const day_count = delivered && requestDate ? Math.floor((requestDate - delivered) / DAY_MS) + 1 : null;

  return {
    sku: item?.sku ?? null,
    name: item?.name ?? "",
    category: item?.category ?? "",
    final_sale: isTrue(item?.final_sale),
    price: item?.price ?? null,
    delivered_date: item?.delivered_date ?? null,
    day_count,
    is_electronics: isElectronics(item),
    is_gift_card: isGiftCard(item)
  };
}

export function buildState(input) {
  const requestDate = parseDate(input?.request?.date);
  const items = Array.isArray(input?.order?.items)
    ? input.order.items.map((item) => buildItem(item, requestDate))
    : [];

  return {
    policy_text: input?.policy_text ?? "",
    order_id: input?.order?.order_id ?? null,
    request_date: input?.request?.date ?? null,
    message: input?.request?.message ?? "",
    items
  };
}

export function questions(input) {
  const state = buildState(input);
  const qs = {};
  const message = JSON.stringify(state.message);

  if (state.items.length <= 253) {
    const criteria = {};

    state.items.forEach((item, i) => {
      criteria[`item_${i}`] = `Customer asks to return ${describeItem(item)}. Do not choose an item the customer says they are keeping.`;
    });

    criteria.NONE = "Customer does not ask to return any item from this order.";
    criteria.AMBIGUOUS = "Customer asks to return more than one item, or the requested item cannot be identified uniquely.";

    qs.target = {
      type: "choice",
      instructions: `Customer message: ${message}. Choose the single item from state.items that the customer is asking to return. If another item is mentioned only as kept, do not choose it.`,
      criteria
    };
  } else {
    state.items.forEach((item, i) => {
      qs[`target_${i}`] = {
        type: "noul",
        instructions: `Customer message: ${message}. Is the customer asking to return ${describeItem(item)}? Ignore items the customer says they are keeping.`,
        criteria: {
          true: "The customer clearly asks to return this specific item.",
          false: "The customer does not ask to return this specific item, says they are keeping it, or the request is about another item."
        }
      };
    });
  }

  qs.opened = {
    type: "choice",
    instructions: `Customer message: ${message}. For the item the customer wants to return, what does the message say about whether it was opened? Consider only the requested item, not other items in the order.`,
    criteria: {
      unopened: "The customer says the requested item is unopened, never opened, still sealed, or not opened.",
      opened: "The customer says the requested item was opened, unsealed, used, or its packaging was opened.",
      unknown: "There is no clear statement about whether the requested item was opened, or the requested item is unclear."
    }
  };

  qs.defective = {
    type: "choice",
    instructions: `Customer message: ${message}. For the item the customer wants to return, does the message claim it is defective? Consider only the requested item, not other items in the order.`,
    criteria: {
      defective: "The customer says the requested item is defective, broken, damaged, faulty, not working, or malfunctioning.",
      not_defective: "The customer explicitly says the requested item is not defective or works fine.",
      unknown: "There is no clear statement about defectiveness, or the requested item is unclear."
    }
  };

  return qs;
}

function choiceProbability(answer, choice) {
  const p = answer?.probabilities?.[choice];
  if (typeof p === "number" && Number.isFinite(p)) return p;
  const c = answer?.confidence;
  return typeof c === "number" && Number.isFinite(c) ? c : 0;
}

function selectTarget(answers, state) {
  const target = answers?.target;

  if (target) {
    if (target.type !== "choice" || typeof target.choice !== "string") return null;
    if (target.choice === "NONE" || target.choice === "AMBIGUOUS") return null;

    let index = -1;
    const m = /^item_(\d+)$/.exec(target.choice);
    if (m) {
      index = Number(m[1]);
    } else {
      index = state.items.findIndex(
        (item) => (item.sku && item.sku === target.choice) || (item.name && item.name === target.choice)
      );
    }

    const item = state.items[index];
    if (!item) return null;

    const p = choiceProbability(target, target.choice);
    const conf = typeof target.confidence === "number" && Number.isFinite(target.confidence) ? target.confidence : 0;
    if (p < MIN_TARGET && conf < MIN_TARGET) return null;

    if (target.probabilities && typeof target.probabilities === "object") {
      let other = 0;
      for (const [option, prob] of Object.entries(target.probabilities)) {
        if (option === target.choice || typeof prob !== "number" || !Number.isFinite(prob)) continue;
        if (prob > other) other = prob;
      }
      if (other > 0.3 && p <= other + 0.1) return null;
    }

    return item;
  }

  let bestIndex = -1;
  let best = 0;
  let second = 0;

  state.items.forEach((_, i) => {
    const answer = answers?.[`target_${i}`];
    const p = answer?.type === "noul" && typeof answer.noul === "number" && Number.isFinite(answer.noul)
      ? answer.noul
      : 0;

    if (p > best) {
      second = best;
      best = p;
      bestIndex = i;
    } else if (p > second) {
      second = p;
    }
  });

  if (best < 0.7) return null;
  if (second > 0.4 && best - second < 0.25) return null;

  return state.items[bestIndex] ?? null;
}

function getChoice(answers, id, allowed) {
  const answer = answers?.[id];
  if (!answer || answer.type !== "choice" || !allowed.includes(answer.choice)) return null;

  const p = choiceProbability(answer, answer.choice);
  const conf = typeof answer.confidence === "number" && Number.isFinite(answer.confidence) ? answer.confidence : 0;

  return { choice: answer.choice, confidence: Math.max(conf, p) };
}

export function decide(answers, input) {
  const state = buildState(input);
  const item = selectTarget(answers, state);

  if (!item) return { eligible: "abstain" };

  if (item.is_gift_card || item.final_sale) return { eligible: "no" };

  if (item.day_count == null || !Number.isFinite(item.day_count)) return { eligible: "abstain" };
  if (item.day_count < 1) return { eligible: "no" };
  if (item.day_count > 30) return { eligible: "no" };

  if (!item.is_electronics) return { eligible: "yes" };

  const defective = getChoice(answers, "defective", ["defective", "not_defective", "unknown"]);
  const opened = getChoice(answers, "opened", ["unopened", "opened", "unknown"]);

  const defectiveYes = defective?.choice === "defective" && defective.confidence >= MIN_FACT;
  if (defectiveYes) return { eligible: "yes" };

  if (item.day_count > 15) {
    if (defective?.choice === "defective") return { eligible: "abstain" };
    if (defective && defective.choice !== "defective" && defective.confidence >= 0.5) return { eligible: "no" };
    return { eligible: "abstain" };
  }

  if (opened?.choice === "unopened" && opened.confidence >= MIN_FACT) return { eligible: "yes" };
  if (opened?.choice === "opened" && opened.confidence >= MIN_FACT) return { eligible: "no" };

  return { eligible: "abstain" };
}
