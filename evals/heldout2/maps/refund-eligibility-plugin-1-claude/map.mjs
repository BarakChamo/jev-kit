// Returns-eligibility decision for a single free-text customer request against a multi-item order.

const WINDOW_DAYS = ["3", "5", "7", "10", "14", "15", "20", "21", "30", "45", "60", "90"];
const CONF_MIN = 0.6; // below this, a choice answer is treated as unresolved
const NOUL_HI = 0.7; // above this, a noul fact is treated as true
const NOUL_LO = 0.3; // below this, a noul fact is treated as false

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
    request_message: input.request.message,
  };
}

export function questions(input) {
  const itemCriteria = {};
  for (const it of input.order.items) {
    itemCriteria[it.sku] = `the customer's message asks to return "${it.name}" (category: ${it.category})`;
  }
  itemCriteria["unclear"] =
    "the message names more than one item to return, or does not clearly single out exactly one item from `items`";

  return {
    target_sku: {
      type: "choice",
      instructions:
        "Which single item from `items` is the customer asking to return, based on `request_message`? Mentioning an item only to say it is being kept does not count as a return request for it.",
      criteria: itemCriteria,
    },
    target_defective: {
      type: "noul",
      instructions:
        "Does `request_message` claim that the item the customer wants to return is defective, broken, damaged, or not working, rather than simply unwanted?",
      criteria: {
        true: "the message states or implies the item is faulty/broken/not working",
        false: "the message gives no such claim",
      },
    },
    target_unopened: {
      type: "noul",
      instructions:
        "Does `request_message` state that the item the customer wants to return is unopened, unused, or still sealed?",
      criteria: {
        true: "the message states the item was never opened/used",
        false: "the message does not state this, or states the opposite",
      },
    },
    policy_general_window_days: {
      type: "choice",
      instructions:
        "According to `policy_text`, how many days after delivery can a typical, non-electronics, non-final-sale item be returned? Pick the number explicitly stated for the general/default return window.",
      criteria: Object.fromEntries([
        ...WINDOW_DAYS.map((d) => [d, `policy_text states a general return window of ${d} days`]),
        ["not_stated", "policy_text does not state a general return window"],
      ]),
    },
    policy_electronics_window_days: {
      type: "choice",
      instructions:
        "According to `policy_text`, within how many days of delivery can a non-defective electronics item normally be returned?",
      criteria: Object.fromEntries([
        ...WINDOW_DAYS.map((d) => [d, `policy_text states an electronics return window of ${d} days`]),
        ["same_as_general", "policy_text says electronics follow the same window as general items"],
        ["not_stated", "policy_text does not give an electronics-specific window"],
      ]),
    },
    policy_electronics_requires_unopened: {
      type: "noul",
      instructions:
        "Does `policy_text` require an electronics item to be unopened/unused to qualify for a (non-defective) return?",
      criteria: {
        true: "policy_text states an unopened/unused condition for electronics returns",
        false: "policy_text states no such condition",
      },
    },
    policy_electronics_defective_window_days: {
      type: "choice",
      instructions:
        "According to `policy_text`, within how many days of delivery can a defective electronics item be returned (the exception for defective electronics)?",
      criteria: Object.fromEntries([
        ...WINDOW_DAYS.map((d) => [d, `policy_text states a ${d}-day window for defective electronics`]),
        ["same_as_general", "policy_text says defective electronics follow the same window as general items"],
        ["not_stated", "policy_text states no defective-electronics exception"],
      ]),
    },
  };
}

function daysSinceDelivery(deliveredDateStr, requestDateStr) {
  const delivered = new Date(deliveredDateStr + "T00:00:00Z");
  const requested = new Date(requestDateStr + "T00:00:00Z");
  const diff = Math.round((requested - delivered) / 86400000);
  return diff + 1; // delivery day counts as day 1 of the window
}

function resolveWindow(choiceAnswer, generalDays) {
  if (!choiceAnswer || choiceAnswer.confidence < CONF_MIN) return null;
  const c = choiceAnswer.choice;
  if (c === "not_stated") return null;
  if (c === "same_as_general") return generalDays;
  const n = parseInt(c, 10);
  return Number.isFinite(n) ? n : null;
}

function noulFact(answer) {
  if (!answer) return "unknown";
  if (answer.noul >= NOUL_HI) return true;
  if (answer.noul <= NOUL_LO) return false;
  return "unknown";
}

export function decide(answers, input) {
  const targetAns = answers.target_sku;
  if (!targetAns || targetAns.confidence < CONF_MIN || targetAns.choice === "unclear") {
    return { eligible: "abstain" };
  }

  const item = input.order.items.find((it) => it.sku === targetAns.choice);
  if (!item) return { eligible: "abstain" };

  const isGiftCard =
    (item.category && item.category.toLowerCase().includes("gift")) ||
    (item.name && item.name.toLowerCase().includes("gift card"));
  if (item.final_sale || isGiftCard) {
    return { eligible: "no" };
  }

  const days = daysSinceDelivery(item.delivered_date, input.request.date);
  const isElectronics = item.category && item.category.toLowerCase() === "electronics";

  if (!isElectronics) {
    const generalWindow = resolveWindow(answers.policy_general_window_days, null);
    if (generalWindow == null) return { eligible: "abstain" };
    return { eligible: days <= generalWindow ? "yes" : "no" };
  }

  const generalWindowRaw = resolveWindow(answers.policy_general_window_days, null);
  const electronicsWindow = resolveWindow(answers.policy_electronics_window_days, generalWindowRaw);
  const defectiveWindow = resolveWindow(answers.policy_electronics_defective_window_days, generalWindowRaw);
  const defective = noulFact(answers.target_defective);
  const requiresUnopened = noulFact(answers.policy_electronics_requires_unopened);

  if (defective === "unknown") return { eligible: "abstain" };

  if (defective === true) {
    if (defectiveWindow == null) return { eligible: "abstain" };
    return { eligible: days <= defectiveWindow ? "yes" : "no" };
  }

  // not defective: normal electronics rule applies
  if (electronicsWindow == null) return { eligible: "abstain" };

  if (requiresUnopened === "unknown") return { eligible: "abstain" };
  if (requiresUnopened === true) {
    const unopened = noulFact(answers.target_unopened);
    if (unopened === "unknown") return { eligible: "abstain" };
    if (unopened === false) return { eligible: "no" };
  }

  return { eligible: days <= electronicsWindow ? "yes" : "no" };
}
