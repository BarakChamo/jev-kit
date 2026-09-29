// Jev map: decide whether the item a customer names in a free-text message
// is eligible for return under the order's returns policy.

const CHOICE_CONF_MIN = 0.6; // below this, which item / policy numbers are too unsure to act on
const NOUL_HIGH = 0.7;
const NOUL_LOW = 0.3;

const DAY_OPTIONS = ["7", "10", "14", "15", "20", "21", "30", "45", "60", "90"];

function dayCriteria(label) {
  const c = {};
  for (const d of DAY_OPTIONS) c[d] = `the policy states exactly ${d} days for ${label}`;
  return c;
}

function daysElapsed(deliveredDate, requestDate) {
  const [dy, dm, dd] = deliveredDate.split("-").map(Number);
  const [ry, rm, rd] = requestDate.split("-").map(Number);
  const delivered = Date.UTC(dy, dm - 1, dd);
  const requested = Date.UTC(ry, rm - 1, rd);
  return Math.floor((requested - delivered) / 86400000) + 1; // delivery day is day 1
}

function noulLabel(answer, low = NOUL_LOW, high = NOUL_HIGH) {
  if (!answer || typeof answer.noul !== "number") return "unsure";
  if (answer.noul >= high) return "true";
  if (answer.noul <= low) return "false";
  return "unsure";
}

function choiceValue(answer, minConf = CHOICE_CONF_MIN) {
  if (!answer || typeof answer.choice !== "string") return null;
  if (typeof answer.confidence === "number" && answer.confidence < minConf) return null;
  return answer.choice;
}

function resolveDays(choiceStr, fallbacks) {
  if (choiceStr == null) return null;
  if (choiceStr === "not_stated") return null;
  if (fallbacks && choiceStr in fallbacks) return fallbacks[choiceStr];
  const n = Number(choiceStr);
  return Number.isFinite(n) ? n : null;
}

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    order: input.order,
    request: input.request,
  };
}

export function questions(input) {
  const items = input.order.items;
  const itemChoiceCriteria = {};
  for (const it of items) {
    itemChoiceCriteria[it.sku] = `${it.name} (sku ${it.sku}, category ${it.category}, price ${it.price})`;
  }

  return {
    target_item: {
      type: "choice",
      instructions:
        "Which item in `order.items` is the customer, in `request.message`, asking to return? " +
        "Pick the single item they want to send back, not an item they mention only as context " +
        "(e.g. one they say they are keeping).",
      criteria: itemChoiceCriteria,
    },
    message_requests_multiple_items: {
      type: "noul",
      instructions:
        "Does `request.message` ask to return more than one distinct item from `order.items`? " +
        "Answer false if it names only one item to return and only mentions any other items as context (e.g. keeping them).",
      criteria: {
        true: "the customer asks to return two or more distinct items",
        false: "only one item is being asked to be returned",
      },
    },
    message_claims_defective: {
      type: "noul",
      instructions:
        "Does `request.message` state that the item the customer wants to return is defective, broken, faulty, or not working?",
      criteria: {
        true: "the message states the item is defective/broken/faulty/not working",
        false: "the message does not claim the item is defective",
      },
    },
    message_claims_unopened: {
      type: "noul",
      instructions:
        "Does `request.message` state or clearly imply that the item the customer wants to return is unopened, unused, sealed, or never used?",
      criteria: {
        true: "the message states or implies the item is unopened/unused",
        false: "the message does not state the item is unopened, or states it was opened/used",
      },
    },
    general_return_window_days: {
      type: "choice",
      instructions:
        "In `policy_text`, how many days after delivery does the policy's general/default return rule allow, for items with no category-specific exception? Read the exact number stated.",
      criteria: { ...dayCriteria("the general return window"), not_stated: "policy_text does not state a general day window" },
    },
    electronics_standard_window_days: {
      type: "choice",
      instructions:
        "In `policy_text`, how many days after delivery does the policy allow for returning electronics under its normal (non-defective) rule? " +
        "If policy_text gives electronics no special number and they simply follow the general rule, answer same_as_general.",
      criteria: {
        ...dayCriteria("the electronics standard return window"),
        same_as_general: "policy_text gives electronics no special window; they follow the general rule",
        not_stated: "policy_text says nothing usable about an electronics return window",
      },
    },
    electronics_defective_window_days: {
      type: "choice",
      instructions:
        "In `policy_text`, does it give a different (usually longer) return window specifically for defective electronics? " +
        "If so, how many days? If it says defective electronics follow the same window as non-defective electronics, answer same_as_electronics_standard. " +
        "If it says defective electronics follow the general rule, answer same_as_general. If policy_text has no defective-specific exception for electronics, answer not_stated.",
      criteria: {
        ...dayCriteria("the defective-electronics return window"),
        same_as_electronics_standard: "defective electronics follow the same window as standard electronics",
        same_as_general: "defective electronics follow the general window",
        not_stated: "policy_text has no defective-specific exception for electronics",
      },
    },
    electronics_requires_unopened: {
      type: "noul",
      instructions:
        "Does `policy_text` require electronics to be unopened/unused to qualify under the electronics standard (non-defective) return window?",
      criteria: {
        true: "policy_text requires electronics to be unopened for the standard window",
        false: "policy_text does not impose an unopened requirement on electronics",
      },
    },
    final_sale_excluded: {
      type: "noul",
      instructions: "Does `policy_text` state that items marked final sale cannot be returned?",
      criteria: {
        true: "policy_text excludes final-sale items from returns",
        false: "policy_text does not exclude final-sale items",
      },
    },
    gift_cards_excluded: {
      type: "noul",
      instructions: "Does `policy_text` state that gift cards cannot be returned?",
      criteria: {
        true: "policy_text excludes gift cards from returns",
        false: "policy_text does not exclude gift cards",
      },
    },
    policy_has_uncovered_rules: {
      type: "noul",
      instructions:
        "Does `policy_text` contain any return rule, category, condition, or exception other than: a general day window; " +
        "an electronics day window with an unopened condition; a longer/different window for defective electronics; " +
        "and an exclusion for final-sale items or gift cards?",
      criteria: {
        true: "policy_text has an additional rule/category/condition not covered by the list above",
        false: "policy_text's rules are fully covered by the list above",
      },
    },
  };
}

export function decide(answers, input) {
  const abstain = { eligible: "abstain" };

  if (noulLabel(answers.policy_has_uncovered_rules) !== "false") return abstain;
  if (noulLabel(answers.message_requests_multiple_items) !== "false") return abstain;

  const targetSku = choiceValue(answers.target_item);
  if (targetSku == null) return abstain;
  const item = input.order.items.find((it) => it.sku === targetSku);
  if (!item) return abstain;

  if (item.final_sale) {
    const fsExcluded = noulLabel(answers.final_sale_excluded);
    if (fsExcluded === "unsure") return abstain;
    if (fsExcluded === "true") return { eligible: "no" };
  }
  if (String(item.category).toLowerCase().includes("gift")) {
    const gcExcluded = noulLabel(answers.gift_cards_excluded);
    if (gcExcluded === "unsure") return abstain;
    if (gcExcluded === "true") return { eligible: "no" };
  }

  const elapsed = daysElapsed(item.delivered_date, input.request.date);
  const generalDays = resolveDays(choiceValue(answers.general_return_window_days));

  if (String(item.category).toLowerCase() === "electronics") {
    const defective = noulLabel(answers.message_claims_defective);
    if (defective === "unsure") return abstain;

    if (defective === "true") {
      const standardDays = resolveDays(choiceValue(answers.electronics_standard_window_days), {
        same_as_general: generalDays,
      });
      const defectiveDays = resolveDays(choiceValue(answers.electronics_defective_window_days), {
        same_as_electronics_standard: standardDays,
        same_as_general: generalDays,
      });
      if (defectiveDays == null) return abstain;
      return { eligible: elapsed <= defectiveDays ? "yes" : "no" };
    }

    const standardDays = resolveDays(choiceValue(answers.electronics_standard_window_days), {
      same_as_general: generalDays,
    });
    if (standardDays == null) return abstain;

    const requiresUnopened = noulLabel(answers.electronics_requires_unopened);
    if (requiresUnopened === "unsure") return abstain;
    if (requiresUnopened === "true") {
      const unopened = noulLabel(answers.message_claims_unopened);
      if (unopened === "unsure") return abstain;
      if (unopened === "false") return { eligible: "no" };
    }
    return { eligible: elapsed <= standardDays ? "yes" : "no" };
  }

  if (generalDays == null) return abstain;
  return { eligible: elapsed <= generalDays ? "yes" : "no" };
}
