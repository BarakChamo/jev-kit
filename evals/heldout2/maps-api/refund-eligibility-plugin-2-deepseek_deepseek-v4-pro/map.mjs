const GATES = {
  choice: 0.8,
  noulTrue: 0.8,
  noulFalse: 0.2,
};

const POLICY = {
  regular_window_days: 30,
  electronics_window_days: 15,
  defective_electronics_window_days: 30,
  electronics_unopened_required: true,
};

function dateDayNumber(ymd) {
  if (typeof ymd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const timestamp = Date.parse(`${ymd}T00:00:00Z`);
  if (Number.isNaN(timestamp)) return null;
  return Math.floor(timestamp / 86400000);
}

function choiceValue(answer) {
  if (!answer || typeof answer.choice !== "string") return { choice: null, p: 0 };
  const p = answer.probabilities?.[answer.choice];
  return { choice: answer.choice, p: typeof p === "number" ? p : 0 };
}

function noulBool(answer) {
  if (!answer || typeof answer.noul !== "number") return null;
  const p = answer.noul;
  if (p >= GATES.noulTrue) return true;
  if (p <= GATES.noulFalse) return false;
  return null;
}

function isElectronics(item) {
  return /electronic/i.test(item?.category || "");
}

function isGiftCard(item) {
  return /gift\s*card|giftcard/i.test(`${item?.category || ""} ${item?.name || ""}`);
}

export function buildState(input) {
  const items = input?.order?.items || [];
  return {
    policy_text: input?.policy_text || "",
    policy_facts: {
      regular_return_window_days: POLICY.regular_window_days,
      electronics_return_window_days: POLICY.electronics_window_days,
      defective_electronics_return_window_days: POLICY.defective_electronics_window_days,
      electronics_unopened_required: POLICY.electronics_unopened_required,
    },
    order: {
      order_id: input?.order?.order_id || null,
      items,
    },
    request: input?.request || {},
  };
}

export function questions(input) {
  const items = input?.order?.items || [];

  const itemCriteria = {};
  items.forEach((item, index) => {
    const name = item?.name || "Unnamed item";
    const sku = item?.sku || "unknown SKU";
    const category = item?.category || "unknown category";
    const finalSale = item?.final_sale ? ", final sale" : "";
    itemCriteria[String(index)] = `${name} (SKU ${sku}, category ${category}${finalSale})`;
  });

  itemCriteria.multiple_items = "the message asks to return more than one item";
  itemCriteria.none_or_ambiguous = "no item can be identified from the message, or a person should decide";

  return {
    target_item: {
      type: "choice",
      instructions: "Which item in `order.items` is the customer asking to return in `request.message`?",
      criteria: itemCriteria,
    },
    is_unopened: {
      type: "noul",
      instructions:
        "Does `request.message` state or clearly imply that the item the customer is asking to return is unopened or still sealed?",
      criteria: {
        true: "the message says it is unopened, sealed, never opened, or equivalent",
        false: "the message says it has been opened or used",
      },
    },
    is_defective: {
      type: "noul",
      instructions:
        "Does `request.message` state or clearly imply that the item the customer is asking to return is defective, faulty, broken, not working, or arrived damaged?",
      criteria: {
        true: "the message reports a defect, fault, damage, or that the item does not work",
        false: "the message does not report or imply a defect",
      },
    },
  };
}

export function decide(answers, input) {
  const targetAnswer = answers?.target_item;
  const target = choiceValue(targetAnswer);

  if (
    !target.choice ||
    target.choice === "none_or_ambiguous" ||
    target.choice === "multiple_items"
  ) {
    return { eligible: "abstain" };
  }
  if (target.p < GATES.choice) return { eligible: "abstain" };

  const items = input?.order?.items || [];
  const itemIndex = Number(target.choice);
  const item = items[itemIndex];
  if (!item) return { eligible: "abstain" };

  const requestDay = dateDayNumber(input?.request?.date);
  const deliveredDay = dateDayNumber(item?.delivered_date);
  if (requestDay === null || deliveredDay === null) return { eligible: "abstain" };
  if (requestDay < deliveredDay) return { eligible: "abstain" };

  // Delivery day counts as day 1.
  const daysSinceDelivery = requestDay - deliveredDay + 1;

  if (item.final_sale) return { eligible: "no" };
  if (isGiftCard(item)) return { eligible: "no" };

  const defective = noulBool(answers?.is_defective);
  const unopened = noulBool(answers?.is_unopened);

  if (isElectronics(item)) {
    if (POLICY.electronics_unopened_required) {
      // Defective electronics get the longer window and do not need to be unopened.
      if (defective === true) {
        return {
          eligible:
            daysSinceDelivery <= POLICY.defective_electronics_window_days ? "yes" : "no",
        };
      }

      if (defective === null) return { eligible: "abstain" };

      // Not defective. If it is already outside the electronics window, no opener state can save it.
      if (daysSinceDelivery > POLICY.electronics_window_days) {
        return { eligible: "no" };
      }

      if (unopened === null) return { eligible: "abstain" };
      if (unopened === false) return { eligible: "no" };

      return { eligible: "yes" };
    }

    return {
      eligible: daysSinceDelivery <= POLICY.electronics_window_days ? "yes" : "no",
    };
  }

  return {
    eligible: daysSinceDelivery <= POLICY.regular_window_days ? "yes" : "no",
  };
}
