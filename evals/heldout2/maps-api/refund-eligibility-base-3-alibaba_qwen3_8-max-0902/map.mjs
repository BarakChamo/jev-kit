function utcDate(s) {
  if (typeof s !== "string") return null;
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function ageInDays(requestDate, deliveredDate) {
  const r = utcDate(requestDate);
  const d = utcDate(deliveredDate);
  if (r == null || d == null) return null;
  return Math.round((r - d) / 86400000) + 1;
}

function flag(v) {
  if (v === true || v === 1) return true;
  if (typeof v !== "string") return false;
  const s = v.trim().toLowerCase();
  return s === "true" || s === "yes" || s === "1";
}

function isGiftCard(item) {
  if (flag(item?.gift_card)) return true;
  const text = [item?.name, item?.category, item?.sku, item?.type]
    .filter((x) => typeof x === "string")
    .join(" ");
  return /gift.?card/i.test(text);
}

function looksLikeKnownPolicy(text) {
  const p = String(text ?? "").toLowerCase();
  return (
    p.includes("electronic") &&
    /30[- ]?day/.test(p) &&
    /15[- ]?day/.test(p) &&
    /final[- ]sale/.test(p)
  );
}

function normalizeTriad(v) {
  const s = typeof v === "string" ? v.toUpperCase() : "";
  return s === "YES" || s === "NO" || s === "UNKNOWN" ? s : "UNKNOWN";
}

function normalizePolicy(v) {
  const s = typeof v === "string" ? v.toUpperCase() : "";
  return s === "YES" || s === "NO" ? s : "ABSTAIN";
}

function knownPolicyDecision(item, opened, defective) {
  const age = item.age_days;
  if (age == null || age < 1) return "abstain";

  const category = String(item.category ?? "").toLowerCase();
  if (category.includes("electronic")) {
    if (age > 30) return "no";
    if (defective === "YES") return "yes";

    if (defective === "NO") {
      if (age <= 15) {
        if (opened === "NO") return "yes";
        if (opened === "YES") return "no";
        return "abstain";
      }
      return "no";
    }

    if (age <= 15 && opened === "NO") return "yes";
    return "abstain";
  }

  return age <= 30 ? "yes" : "no";
}

function getChoice(answers, id) {
  const v = answers?.[id]?.choice;
  return typeof v === "string" ? v : undefined;
}

function getConfidence(answers, id) {
  const v = answers?.[id]?.confidence;
  return typeof v === "number" && Number.isFinite(v) ? v : 1;
}

export function buildState(input) {
  const request_date = input?.request?.date ?? null;
  const seen = new Set();

  const items = Array.isArray(input?.order?.items)
    ? input.order.items.map((raw, i) => {
        const item = raw ?? {};
        const age_days = ageInDays(request_date, item.delivered_date);

        let base = typeof item.sku === "string" && item.sku ? item.sku : `ITEM_${i}`;
        if (seen.has(base)) base = `${base}_${i}`;
        seen.add(base);

        return {
          ...item,
          option_key: `item:${base}`,
          age_days,
          within_15_days: age_days != null && age_days >= 1 && age_days <= 15,
          within_30_days: age_days != null && age_days >= 1 && age_days <= 30,
        };
      })
    : [];

  return {
    policy_text: input?.policy_text ?? "",
    order_id: input?.order?.order_id ?? null,
    request_date,
    message: input?.request?.message ?? "",
    items,
  };
}

export function questions(input) {
  const state = buildState(input);
  const target = {};
  const maxListed = 251;
  const listed = state.items.slice(0, maxListed);

  for (const item of listed) {
    target[item.option_key] =
      `${item.name ?? "Item"} | sku=${item.sku ?? item.option_key.slice(5)} | ` +
      `category=${item.category ?? "unknown"} | delivered=${item.delivered_date ?? "unknown"} | ` +
      `age_days=${item.age_days ?? "unknown"} | final_sale=${Boolean(item.final_sale)}`;
  }

  if (state.items.length > maxListed) {
    target.TOO_MANY = "Requested item is not listed because the order has too many items.";
  }

  target.MULTIPLE = "Customer asks to return two or more distinct items.";
  target.UNKNOWN = "Customer asks to return something but the exact item cannot be identified.";
  target.NONE = "Customer is not asking to return anything.";

  return {
    target: {
      type: "choice",
      instructions:
        "Using state.message and state.items, choose the single item the customer wants to return. " +
        "Ignore items the customer says they are keeping. Choose MULTIPLE if more than one distinct item is requested, " +
        "UNKNOWN if a return is requested but cannot be matched, NONE if no return is requested.",
      criteria: target,
    },
    opened: {
      type: "choice",
      instructions:
        "For the item the customer wants to return, decide whether the customer says it was opened, unsealed, or used. " +
        "If there is no single identifiable requested item, choose UNKNOWN.",
      criteria: {
        YES: "The customer says the item was opened, unsealed, used, or its packaging was broken.",
        NO: "The customer says the item is unopened, never opened, sealed, or unused.",
        UNKNOWN: "The customer does not clearly say, or the request is ambiguous/multiple.",
      },
    },
    defective: {
      type: "choice",
      instructions:
        "For the item the customer wants to return, decide whether the customer says it is defective, damaged, or not working.",
      criteria: {
        YES: "The customer says the item is defective, damaged, broken, faulty, or not working.",
        NO: "The customer explicitly says it is not defective or gives only a non-defective reason for return.",
        UNKNOWN: "The customer does not clearly say, or the request is ambiguous/multiple.",
      },
    },
    policy: {
      type: "choice",
      instructions:
        "Apply state.policy_text to the single item the customer wants to return. " +
        "Use state.request_date, each item's delivered_date and age_days, final_sale status, and the customer's statements about being opened or defective. " +
        "Delivery day counts as day 1. Choose YES only if clearly eligible, NO if clearly ineligible, ABSTAIN if facts, item, or policy are unclear.",
      criteria: {
        YES: "The requested item is clearly eligible for return.",
        NO: "The requested item is clearly ineligible for return.",
        ABSTAIN: "Send to a person because of ambiguity, missing facts, multiple items, or unclear policy.",
      },
    },
  };
}

export function decide(answers, input) {
  const state = buildState(input);

  const target = getChoice(answers, "target");
  if (!target || getConfidence(answers, "target") < 0.65) {
    return { eligible: "abstain" };
  }

  const special = new Set(["MULTIPLE", "UNKNOWN", "NONE", "TOO_MANY"]);
  if (special.has(target)) {
    return { eligible: "abstain" };
  }

  const item =
    state.items.find((i) => i.option_key === target) ??
    state.items.find((i) => typeof i.sku === "string" && i.sku === target);

  if (!item) {
    return { eligible: "abstain" };
  }

  if (flag(item.final_sale) || isGiftCard(item)) {
    return { eligible: "no" };
  }

  const openedRaw = getChoice(answers, "opened");
  const opened =
    openedRaw && getConfidence(answers, "opened") >= 0.6
      ? normalizeTriad(openedRaw)
      : "UNKNOWN";

  const defectiveRaw = getChoice(answers, "defective");
  const defective =
    defectiveRaw && getConfidence(answers, "defective") >= 0.6
      ? normalizeTriad(defectiveRaw)
      : "UNKNOWN";

  let result = looksLikeKnownPolicy(state.policy_text)
    ? knownPolicyDecision(item, opened, defective)
    : "abstain";

  if (result === "abstain") {
    const policyRaw = getChoice(answers, "policy");
    const policy = normalizePolicy(policyRaw);
    if ((policy === "YES" || policy === "NO") && getConfidence(answers, "policy") >= 0.75) {
      result = policy.toLowerCase();
    }
  }

  return result === "yes" || result === "no"
    ? { eligible: result }
    : { eligible: "abstain" };
}
