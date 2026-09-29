// Decide whether a customer's requested item from a multi-item order is
// eligible for return, given a (possibly varying, per-case) policy text.
//
// Strategy: extract the literal day-count numbers that appear in the policy
// text with plain string matching (code), then let Jev assign meaning to
// those exact numbers (which one is the general window, which is the
// category-specific window, which is the defective exception) and read the
// case-specific facts (which item, opened/unopened, defective claim) from
// the free-text message. All date/day arithmetic happens in code.

const CONF_THRESHOLD = 0.65;

function extractDayNumbers(text) {
  const nums = new Set();
  const re = /(\d+)\s*days?/gi;
  let m;
  while ((m = re.exec(text))) nums.add(parseInt(m[1], 10));
  return [...nums].sort((a, b) => a - b);
}

function mentionsCategory(policyText, category) {
  const re = new RegExp(`\\b${category.replace(/[^a-zA-Z0-9]/g, ".")}\\b`, "i");
  return re.test(policyText);
}

function isGiftCardLike(item) {
  return /gift.?card/i.test(item.category) || /gift.?card/i.test(item.name);
}

function daysElapsed(deliveredDate, requestDate) {
  const d = new Date(deliveredDate + "T00:00:00Z");
  const r = new Date(requestDate + "T00:00:00Z");
  return Math.round((r - d) / 86400000) + 1; // delivery day counts as day 1
}

function fieldKey(category) {
  return category.replace(/[^a-zA-Z0-9]/g, "_");
}

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    order_id: input.order.order_id,
    items: input.order.items.map((it) => ({
      sku: it.sku,
      name: it.name,
      category: it.category,
      final_sale: it.final_sale,
      price: it.price,
      delivered_date: it.delivered_date,
    })),
    request_date: input.request.date,
    message: input.request.message,
  };
}

export function questions(input) {
  const policyText = input.policy_text;
  const items = input.order.items;
  const dayNumbers = extractDayNumbers(policyText);
  const dayOptions = dayNumbers.map(String);
  const categories = [...new Set(items.map((i) => i.category))];

  const q = {};

  if (items.length > 1) {
    const criteria = {};
    for (const it of items) criteria[it.sku] = `the item named "${it.name}" (sku ${it.sku})`;
    q.target_item = {
      type: "choice",
      instructions:
        "Which item, identified by its sku, is the customer asking to return in `message`? Pick the item the customer wants back, not one they say they are keeping.",
      criteria,
    };
    q.multiple_items_requested = {
      type: "noul",
      instructions:
        "Does `message` ask to return more than one distinct item from the order, as opposed to asking about a single item (possibly while mentioning others only to say they are being kept)?",
      criteria: { true: "two or more distinct items are being requested for return", false: "only one item is being requested for return" },
    };
  }

  q.opened_status = {
    type: "choice",
    instructions:
      "Does `message` state that the item the customer wants to return is still unopened/unused/sealed, state or imply it has been opened or used, or not mention this at all?",
    criteria: {
      unopened: "message states the item is unopened, unused, or still sealed",
      opened: "message states or implies the item has been opened or used",
      not_mentioned: "message does not address whether the item was opened",
    },
  };

  q.defective_claimed = {
    type: "noul",
    instructions: "Does `message` claim that the item the customer wants to return is defective, broken, damaged, or not working?",
    criteria: { true: "message claims the item is defective/broken/not working", false: "no such claim is made" },
  };

  if (dayOptions.length > 0) {
    q.general_window_days = {
      type: "choice",
      instructions:
        "In `policy_text`, which of these day counts is the default/general return window that applies to items with no special category rule?",
      criteria: Object.fromEntries(dayOptions.map((d) => [d, `the policy's general/default window is ${d} days`])),
    };

    for (const category of categories) {
      if (!mentionsCategory(policyText, category)) continue;
      const key = fieldKey(category);
      const windowCriteria = Object.fromEntries(dayOptions.map((d) => [d, `the special return window for category "${category}" is ${d} days`]));
      windowCriteria.none = `policy_text has no special return window for category "${category}"; the general window applies`;
      q[`${key}_window_days`] = {
        type: "choice",
        instructions: `In \`policy_text\`, does it state a special return window (in days) specifically for the category "${category}"? If so, which number of days?`,
        criteria: windowCriteria,
      };

      q[`${key}_requires_unopened`] = {
        type: "noul",
        instructions: `Does \`policy_text\` require items in the category "${category}" to be unopened/unused/sealed to be returned, unless defective?`,
        criteria: { true: `policy_text imposes an unopened/unused condition on category "${category}"`, false: "no such condition is stated" },
      };

      const exceptionCriteria = Object.fromEntries(dayOptions.map((d) => [d, `the defective-item exception window for category "${category}" is ${d} days`]));
      exceptionCriteria.none = `policy_text states no separate defective-item exception window for category "${category}"`;
      q[`${key}_defective_exception_days`] = {
        type: "choice",
        instructions: `In \`policy_text\`, if a defective item in category "${category}" gets a longer/different return window, which number of days is it? Pick "none" if there is no such exception.`,
        criteria: exceptionCriteria,
      };
    }
  }

  q.final_sale_excluded = {
    type: "noul",
    instructions: "Does `policy_text` state that items marked as final sale cannot be returned?",
    criteria: { true: "policy_text excludes final-sale items from returns", false: "policy_text does not exclude final-sale items" },
  };

  q.gift_card_excluded = {
    type: "noul",
    instructions: "Does `policy_text` state that gift cards cannot be returned?",
    criteria: { true: "policy_text excludes gift cards from returns", false: "policy_text does not exclude gift cards" },
  };

  return q;
}

export function decide(answers, input) {
  const items = input.order.items;
  const policyText = input.policy_text;
  const dayNumbers = extractDayNumbers(policyText);
  const confidences = [];

  let sku;
  if (items.length > 1) {
    if (answers.multiple_items_requested?.noul > 0.5) return { eligible: "abstain" };
    const t = answers.target_item;
    if (!t || t.confidence < CONF_THRESHOLD) return { eligible: "abstain" };
    sku = t.choice;
    confidences.push(t.confidence);
  } else {
    sku = items[0].sku;
  }

  const item = items.find((i) => i.sku === sku);
  if (!item) return { eligible: "abstain" };

  if (item.final_sale && answers.final_sale_excluded?.noul > 0.5) return { eligible: "no" };
  if (isGiftCardLike(item) && answers.gift_card_excluded?.noul > 0.5) return { eligible: "no" };

  if (dayNumbers.length === 0 || !answers.general_window_days) return { eligible: "abstain" };

  const key = fieldKey(item.category);
  const hasCategoryRule = !!answers[`${key}_window_days`];

  let windowDays = parseInt(answers.general_window_days.choice, 10);
  confidences.push(answers.general_window_days.confidence);

  let requiresUnopened = false;
  let exceptionDays = null;

  if (hasCategoryRule) {
    const winAns = answers[`${key}_window_days`];
    confidences.push(winAns.confidence);
    if (winAns.choice !== "none") windowDays = parseInt(winAns.choice, 10);

    requiresUnopened = answers[`${key}_requires_unopened`]?.noul > 0.5;

    const excAns = answers[`${key}_defective_exception_days`];
    if (excAns) {
      confidences.push(excAns.confidence);
      if (excAns.choice !== "none") exceptionDays = parseInt(excAns.choice, 10);
    }
  }

  if (confidences.some((c) => c < CONF_THRESHOLD)) return { eligible: "abstain" };

  const defectiveClaimed = answers.defective_claimed?.noul > 0.5;
  const opened = answers.opened_status?.choice;

  if (requiresUnopened && !defectiveClaimed) {
    if (opened === "opened") return { eligible: "no" };
    if (opened === "not_mentioned") return { eligible: "abstain" };
  }

  const effectiveWindow = defectiveClaimed && exceptionDays != null ? exceptionDays : windowDays;
  const elapsed = daysElapsed(item.delivered_date, input.request.date);

  return { eligible: elapsed <= effectiveWindow ? "yes" : "no" };
}
