// Jev map: decide whether the single item a customer's free-text message
// asks to return is eligible under the order's returns policy.

const DAYS = ["3", "5", "7", "10", "14", "15", "20", "21", "30", "45", "60", "90", "120", "180", "365"];

// Placeholder gates (not fitted against labelled data). true/false require
// the label's own probability past this margin; otherwise treated as unknown.
const TRUE_GATE = 0.75;
const FALSE_GATE = 0.25;
const CHOICE_GATE = 0.6;

function gatedBool(ans) {
  if (!ans || typeof ans.noul !== "number") return null;
  if (ans.noul >= TRUE_GATE) return true;
  if (ans.noul <= FALSE_GATE) return false;
  return null;
}

function catKey(category) {
  return String(category).toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function distinctCategories(items) {
  return [...new Set(items.map((i) => i.category))];
}

export function buildState(input) {
  const { policy_text, order, request } = input;
  return {
    policy_text,
    order_id: order.order_id,
    items: order.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      category: i.category,
      final_sale: i.final_sale,
      price: i.price,
      delivered_date: i.delivered_date,
    })),
    request_date: request.date,
    message: request.message,
  };
}

export function questions(input) {
  const items = input.order.items;
  const categories = distinctCategories(items);
  const q = {};

  q.targetItem = {
    type: "choice",
    instructions:
      "Which single item from `items` (identify by its sku) is the customer's `message` asking to return? Match against each item's `name`. If `message` asks to return more than one item, does not clearly identify which item in `items` it refers to, or refers to an item not in `items`, answer \"unclear\".",
    criteria: Object.fromEntries([
      ...items.map((i) => [i.sku, `the message is asking to return "${i.name}" (category: ${i.category})`]),
      ["unclear", "message does not clearly identify exactly one item in `items` to return"],
    ]),
  };

  q.claimsUnopened = {
    type: "noul",
    instructions:
      "In `message`, about the specific item the customer is asking to return (not any other item they mention keeping), does the customer state or clearly imply that item is unopened, unused, still sealed, or otherwise never used?",
    criteria: {
      true: "message says or implies the return item is unopened/unused",
      false: "message does not say this, says the opposite (opened/used), or does not mention it",
    },
  };

  q.claimsDefective = {
    type: "noul",
    instructions:
      "In `message`, about the specific item the customer is asking to return, does the customer state or imply that item is defective, broken, damaged, malfunctioning, or otherwise not working, rather than simply being unwanted?",
    criteria: {
      true: "message says or implies the return item is defective/broken/not working",
      false: "message does not say this",
    },
  };

  q.finalSaleNoReturn = {
    type: "noul",
    instructions: "Does the policy in `policy_text` state that items marked as final sale cannot be returned?",
    criteria: {
      true: "policy_text states final-sale items cannot be returned",
      false: "policy_text does not state this",
    },
  };

  q.finalSaleDefectiveException = {
    type: "noul",
    instructions:
      "Does the policy in `policy_text` explicitly state an exception allowing a final-sale item to be returned if it is defective?",
    criteria: {
      true: "policy_text explicitly states this exception",
      false: "policy_text does not state this exception",
    },
  };

  q.generalWindowDays = {
    type: "choice",
    instructions:
      "What is the general/default return window, in days, stated by the policy in `policy_text` for items that are not covered by any category-specific rule?",
    criteria: Object.fromEntries(DAYS.map((d) => [d, `policy_text states the general return window as ${d} days`])),
  };

  for (const cat of categories) {
    const key = catKey(cat);

    q[`window_${key}`] = {
      type: "choice",
      instructions: `Does the policy in \`policy_text\` state a return window, in days, specifically for items in the category "${cat}", different from its general window? If so, what is that number of days?`,
      criteria: Object.fromEntries([
        ...DAYS.map((d) => [d, `policy_text states this category's specific return window as ${d} days`]),
        ["general", `policy_text does not state a return window specific to the "${cat}" category; the general window applies`],
      ]),
    };

    q[`unopenedRequired_${key}`] = {
      type: "noul",
      instructions: `Does the policy in \`policy_text\` require items in the category "${cat}" to be unopened or unused as a condition of return eligibility, in addition to any time limit?`,
      criteria: {
        true: `policy_text requires "${cat}" items to be unopened/unused to be returned`,
        false: `policy_text does not state such a requirement for "${cat}" items`,
      },
    };

    q[`defectiveWindow_${key}`] = {
      type: "choice",
      instructions: `Does the policy in \`policy_text\` state a different or extended return window, in days, for category "${cat}" items when the item is defective? If so, what is that number of days?`,
      criteria: Object.fromEntries([
        ...DAYS.map((d) => [d, `policy_text states the defective-item return window for "${cat}" as ${d} days`]),
        ["same_as_window", `policy_text gives no different number for defective "${cat}" items than its normal category window`],
        ["no_defective_exception", `policy_text states no defective-item exception at all for the "${cat}" category`],
      ]),
    };

    q[`defectiveWaivesUnopened_${key}`] = {
      type: "noul",
      instructions: `If the policy in \`policy_text\` gives category "${cat}" items a different window when defective, does that defective exception remove the requirement that the item be unopened? Answer false if there is no unopened requirement to remove, or if the defective exception does not affect it.`,
      criteria: {
        true: "the defective exception removes/waives the unopened requirement",
        false: "the unopened requirement still applies, or there is none to waive",
      },
    };
  }

  return q;
}

export function decide(answers, input) {
  const abstain = { eligible: "abstain" };

  const targetAns = answers.targetItem;
  if (!targetAns || targetAns.choice === "unclear" || targetAns.confidence < CHOICE_GATE) return abstain;

  const item = input.order.items.find((i) => i.sku === targetAns.choice);
  if (!item) return abstain;

  const requestDate = new Date(input.request.date);
  const deliveredDate = new Date(item.delivered_date);
  const elapsedDays = Math.floor((requestDate - deliveredDate) / 86400000) + 1;

  const claimsUnopened = gatedBool(answers.claimsUnopened);
  const claimsDefective = gatedBool(answers.claimsDefective);

  if (item.final_sale) {
    const noReturn = gatedBool(answers.finalSaleNoReturn);
    if (noReturn === null) return abstain;
    if (noReturn === true) {
      const exception = gatedBool(answers.finalSaleDefectiveException);
      if (exception === true && claimsDefective === true) {
        // falls through to normal window logic below
      } else if (exception === null || claimsDefective === null) {
        return abstain;
      } else {
        return { eligible: "no" };
      }
    } else {
      // policy_text doesn't confirm the final_sale flag excludes returns; ambiguous
      return abstain;
    }
  }

  const generalAns = answers.generalWindowDays;
  if (!generalAns || generalAns.confidence < CHOICE_GATE) return abstain;
  const generalWindow = parseInt(generalAns.choice, 10);
  if (Number.isNaN(generalWindow)) return abstain;

  const key = catKey(item.category);
  const winAns = answers[`window_${key}`];
  const unopenedReqAns = answers[`unopenedRequired_${key}`];
  const defWinAns = answers[`defectiveWindow_${key}`];
  const defWaivesAns = answers[`defectiveWaivesUnopened_${key}`];
  if (!winAns) return abstain;

  let categoryWindow = generalWindow;
  let categorySpecific = false;
  if (winAns.confidence < CHOICE_GATE) return abstain;
  if (winAns.choice !== "general") {
    const n = parseInt(winAns.choice, 10);
    if (Number.isNaN(n)) return abstain;
    categoryWindow = n;
    categorySpecific = true;
  }

  let unopenedRequired = false;
  if (categorySpecific) {
    unopenedRequired = gatedBool(unopenedReqAns);
    if (unopenedRequired === null) return abstain;
  }

  let effectiveWindow = categoryWindow;
  let effectiveUnopenedRequired = unopenedRequired;

  if (claimsDefective === true) {
    if (!defWinAns || defWinAns.confidence < CHOICE_GATE) return abstain;
    if (defWinAns.choice !== "no_defective_exception") {
      if (defWinAns.choice !== "same_as_window") {
        const dn = parseInt(defWinAns.choice, 10);
        if (Number.isNaN(dn)) return abstain;
        effectiveWindow = dn;
      }
      if (unopenedRequired) {
        const waives = gatedBool(defWaivesAns);
        if (waives === null) return abstain;
        effectiveUnopenedRequired = !waives;
      }
    }
  } else if (claimsDefective === null && (categorySpecific || unopenedRequired)) {
    // whether the item is defective could change which window/condition applies
    return abstain;
  }

  if (effectiveUnopenedRequired) {
    if (claimsUnopened === null) return abstain;
    if (claimsUnopened === false) return { eligible: "no" };
  }

  return { eligible: elapsedDays <= effectiveWindow ? "yes" : "no" };
}
