// Jev map for per-item return eligibility from a free-text customer message.
//
// Each case's request.message is treated as asking about ONE item from a
// multi-item order (other items may be mentioned only for context, e.g.
// "I'm keeping the pan"). decide() resolves which item that is and whether
// it is eligible under the policy text supplied with the case.

const DAY_OPTIONS = [
  "0", "3", "5", "7", "10", "14", "15", "20", "21", "25", "30", "35", "40",
  "45", "50", "60", "75", "90", "120", "180", "365",
];

function dayCriteria(kind) {
  const criteria = {};
  for (const d of DAY_OPTIONS) {
    criteria[d] =
      d === "0"
        ? `the policy does not allow ${kind} at all for this category (0 days)`
        : `the policy states the ${kind} window as exactly ${d} days from delivery`;
  }
  return criteria;
}

function categoryKey(category) {
  return String(category).replace(/[^a-zA-Z0-9]+/g, "_");
}

export function buildState(input) {
  const { policy_text, order, request } = input;
  return {
    policy_text,
    order_id: order.order_id,
    items: order.items.map((it) => ({
      sku: it.sku,
      name: it.name,
      category: it.category,
      final_sale: it.final_sale,
      price: it.price,
      delivered_date: it.delivered_date,
    })),
    request_date: request.date,
    message: request.message,
  };
}

export function questions(input) {
  const items = input.order.items;
  const categories = [...new Set(items.map((it) => it.category))];

  const targetCriteria = {};
  for (const it of items) {
    targetCriteria[it.sku] =
      `the item named "${it.name}" (sku ${it.sku}, category "${it.category}") in \`items\``;
  }
  targetCriteria.unclear =
    "`message` does not clearly identify exactly one item from `items` as the one to return " +
    "(e.g. it asks about more than one item, names none of them, or is too vague to tell)";

  const q = {
    target_item: {
      type: "choice",
      instructions:
        "Which single item in `items` is the customer, in `message`, asking to return? " +
        "Ignore items only mentioned as being kept or not part of the return request.",
      criteria: targetCriteria,
    },
    opened_status: {
      type: "choice",
      instructions:
        "Based only on `message`, what does the customer say or imply about whether the " +
        "item they want to return has been opened, used, or unpackaged?",
      criteria: {
        unopened: "message states or implies the item is unopened, unused, or still sealed",
        opened: "message states or implies the item has been opened, used, or unpackaged",
        unclear: "message does not say either way",
      },
    },
    defective_status: {
      type: "choice",
      instructions:
        "Based only on `message`, does the customer describe the item they want to return " +
        "as defective, broken, faulty, or not working?",
      criteria: {
        defective: "message states the item is defective, broken, faulty, or not working",
        not_defective:
          "message does not claim any defect (includes cases where it says the item is fine)",
        unclear: "message hints at a problem but does not clearly state it is a defect",
      },
    },
    final_sale_excluded: {
      type: "noul",
      instructions:
        "Does `policy_text` state that items marked final sale, or gift cards, cannot be " +
        "returned, with no exceptions such as for defects?",
      criteria: {
        true: "policy_text excludes final-sale items / gift cards from returns with no exceptions stated",
        false: "policy_text says no such thing, or allows exceptions",
      },
    },
  };

  for (const category of categories) {
    const key = categoryKey(category);
    q[`window_${key}`] = {
      type: "choice",
      instructions:
        `According to \`policy_text\`, what is the standard (non-defective) return window, ` +
        `in days after delivery, for items in the category "${category}"? If policy_text names ` +
        `no special rule for this category, use its general/default return window instead.`,
      criteria: dayCriteria("standard return"),
    };
    q[`defective_window_${key}`] = {
      type: "choice",
      instructions:
        `According to \`policy_text\`, what is the return window, in days after delivery, for a ` +
        `DEFECTIVE item in the category "${category}"? If policy_text states no special exception ` +
        `for defective items in this category, answer the same number of days as the category's ` +
        `standard (non-defective) return window.`,
      criteria: dayCriteria("defective-item return"),
    };
    q[`unopened_required_${key}`] = {
      type: "noul",
      instructions:
        `Does \`policy_text\` require an item in the category "${category}" to be unopened/unused ` +
        `to qualify for return under that category's standard (non-defective) rule? Answer false if ` +
        `policy_text states no such condition for this category.`,
      criteria: {
        true: "policy_text conditions this category's standard return on the item being unopened/unused",
        false: "policy_text states no unopened/unused condition for this category",
      },
    };
  }

  return q;
}

const CHOICE_MIN = 0.6;
const DAY_MIN = 0.6;
const NOUL_TRUE = 0.65;
const NOUL_FALSE = 0.35;

function topProb(answer) {
  return answer.probabilities?.[answer.choice] ?? answer.confidence;
}

function daysSinceDelivery(deliveredDate, requestDate) {
  const delivered = new Date(deliveredDate + "T00:00:00Z");
  const requested = new Date(requestDate + "T00:00:00Z");
  return Math.round((requested - delivered) / 86400000) + 1; // delivery day = day 1
}

export function decide(answers, input) {
  const abstain = { eligible: "abstain" };

  const target = answers.target_item;
  if (target.choice === "unclear" || topProb(target) < CHOICE_MIN) return abstain;

  const item = input.order.items.find((it) => it.sku === target.choice);
  if (!item) return abstain;

  if (item.final_sale) {
    const p = answers.final_sale_excluded.noul;
    if (p >= NOUL_TRUE) return { eligible: "no" };
    if (p > NOUL_FALSE) return abstain; // ambiguous whether this policy really excludes it
  }

  const key = categoryKey(item.category);
  const windowAns = answers[`window_${key}`];
  const defWindowAns = answers[`defective_window_${key}`];
  const unopenedAns = answers[`unopened_required_${key}`];

  if (topProb(windowAns) < DAY_MIN || topProb(defWindowAns) < DAY_MIN) return abstain;

  const windowDays = parseInt(windowAns.choice, 10);
  const defWindowDays = parseInt(defWindowAns.choice, 10);
  const daysSince = daysSinceDelivery(item.delivered_date, input.request.date);

  const unopenedRequired =
    unopenedAns.noul >= NOUL_TRUE ? true : unopenedAns.noul <= NOUL_FALSE ? false : null;

  const opened = answers.opened_status;
  const openedConfident = topProb(opened) >= CHOICE_MIN;

  const nonDefectiveEligible = (() => {
    if (windowDays <= 0 || daysSince > windowDays) return false;
    if (unopenedRequired === null) return null; // policy's condition itself is ambiguous
    if (!unopenedRequired) return true;
    if (!openedConfident || opened.choice === "unclear") return null;
    return opened.choice === "unopened";
  })();

  const defectiveEligible = defWindowDays > 0 && daysSince <= defWindowDays;

  const defective = answers.defective_status;
  const defectiveConfident = topProb(defective) >= CHOICE_MIN;

  let result;
  if (defectiveConfident && defective.choice === "defective") {
    result = defectiveEligible;
  } else if (defectiveConfident && defective.choice === "not_defective") {
    result = nonDefectiveEligible;
  } else {
    // Genuinely unclear whether it's defective: only decide if both paths agree.
    result = nonDefectiveEligible === defectiveEligible ? nonDefectiveEligible : null;
  }

  if (result === null) return abstain;
  return { eligible: result ? "yes" : "no" };
}
