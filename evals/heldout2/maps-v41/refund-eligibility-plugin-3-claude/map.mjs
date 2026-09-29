// Return-eligibility decision for a free-text request about one item in a multi-item order.

const ITEM_CHOICE_MIN_CONFIDENCE = 0.7;
const STATUS_MIN_CONFIDENCE = 0.7;

function firstNumber(text, re) {
  const m = text.match(re);
  return m ? parseInt(m[1], 10) : null;
}

function parsePolicy(text) {
  return {
    generalWindow: firstNumber(text, /most items[^.]*?within\s+(\d+)\s+days/i) ?? 30,
    electronicsWindow: firstNumber(text, /electronics[^.]*?within\s+(\d+)\s+days/i) ?? 15,
    electronicsDefectiveWindow:
      firstNumber(text, /defective[^.]*?within\s+(\d+)\s+days/i) ??
      firstNumber(text, /electronics[^.]*?within\s+(\d+)\s+days/i) ??
      30,
    electronicsRequiresUnopened: /electronics[^.]*?unopened/i.test(text),
  };
}

function daysSinceDeliveryInclusive(deliveredDateStr, requestDateStr) {
  const delivered = new Date(deliveredDateStr + "T00:00:00Z");
  const requested = new Date(requestDateStr + "T00:00:00Z");
  const diff = Math.round((requested - delivered) / 86400000);
  return diff + 1; // delivery day counts as day 1
}

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    order: input.order,
    request: input.request,
  };
}

export function questions(input) {
  const criteria = {};
  for (const item of input.order.items) {
    criteria[item.sku] = `${item.name} (category: ${item.category})`;
  }
  criteria.unclear =
    "request.message does not clearly ask to return exactly one of the items listed above (it asks about more than one item, about none of them, or it is ambiguous which one)";

  return {
    item_choice: {
      type: "choice",
      instructions:
        "In `request.message`, the customer asks about returning an item from `order.items`. Which single item are they asking to return?",
      criteria,
    },
    defective_status: {
      type: "choice",
      instructions:
        "In `request.message`, what does the customer say about whether the item they want to return is defective, broken, or not working?",
      criteria: {
        defective: "the customer states or clearly implies the item is defective, broken, or not working",
        not_defective: "the customer states the item works fine, or otherwise implies it is not defective",
        not_stated: "the message says nothing about whether the item is defective",
      },
    },
    opened_status: {
      type: "choice",
      instructions:
        "In `request.message`, what does the customer say about whether the item they want to return has been opened or used?",
      criteria: {
        unopened: "the customer states or clearly implies the item is unopened, unused, still sealed, or new",
        opened: "the customer states or clearly implies the item has been opened, used, or unsealed",
        not_stated: "the message says nothing about whether the item has been opened or used",
      },
    },
  };
}

export function decide(answers, input) {
  const itemChoice = answers.item_choice;
  if (!itemChoice || itemChoice.choice === "unclear" || itemChoice.confidence < ITEM_CHOICE_MIN_CONFIDENCE) {
    return { eligible: "abstain" };
  }

  const item = input.order.items.find((it) => it.sku === itemChoice.choice);
  if (!item) return { eligible: "abstain" };

  if (item.final_sale) return { eligible: "no" };
  if (/gift.?card/i.test(item.category) || /gift.?card/i.test(item.name)) return { eligible: "no" };

  const policy = parsePolicy(input.policy_text);
  const days = daysSinceDeliveryInclusive(item.delivered_date, input.request.date);
  const isElectronics = item.category === "electronics";

  if (!isElectronics) {
    return { eligible: days <= policy.generalWindow ? "yes" : "no" };
  }

  const defectiveAns = answers.defective_status;
  if (defectiveAns?.choice === "defective") {
    if (defectiveAns.confidence < STATUS_MIN_CONFIDENCE) return { eligible: "abstain" };
    return { eligible: days <= policy.electronicsDefectiveWindow ? "yes" : "no" };
  }

  if (days > policy.electronicsWindow) return { eligible: "no" };

  if (!policy.electronicsRequiresUnopened) return { eligible: "yes" };

  const openedAns = answers.opened_status;
  if (openedAns?.choice === "unopened" && openedAns.confidence >= STATUS_MIN_CONFIDENCE) {
    return { eligible: "yes" };
  }
  if (openedAns?.choice === "opened" && openedAns.confidence >= STATUS_MIN_CONFIDENCE) {
    return { eligible: "no" };
  }
  return { eligible: "abstain" };
}
