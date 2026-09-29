// Jev map: decide whether one item in a multi-item order is eligible for return.
// When the answer is not clear enough to act on, route the case to a person by returning "abstain".

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    domain_convention:
      "The customer is asking, in a free-text message, to return a single item from a multi-item order. " +
      "Identify which one item is the target. Read whether the message reports the item as unopened/sealed " +
      "and whether it reports it as defective/broken. Combine those with the item's category and final-sale " +
      "flag from the order. Delivery day counts as day 1 of the return window. If the answer is not clear " +
      "enough to act on, route the case to a person.",
    order: input.order,
    request: { date: input.request.date, message: input.request.message },
  };
}

export function questions(input) {
  const items = input.order.items;
  const targetCriteria = Object.fromEntries(
    items.map((it) => [
      it.sku,
      `${it.name} (category: ${it.category}${it.final_sale ? ", final sale" : ""})`,
    ]),
  );
  targetCriteria.ambiguous =
    "the message refers to more than one item, or which item is meant is unclear";

  return {
    target_sku: {
      type: "choice",
      instructions:
        "Which single item from `order.items` is the customer requesting to return in `request.message`? " +
        "Use the message text alone. If the customer refers to more than one item, or which item is meant " +
        "is unclear, answer `ambiguous`.",
      criteria: targetCriteria,
    },
    target_unopened: {
      type: "noul",
      instructions:
        "For the single item the customer is requesting to return in `request.message`, does the message " +
        "indicate that the item has not been opened and has not been used? \"Unopened/sealed\" includes " +
        "phrases like: \"never opened\", \"still sealed\", \"unopened\", \"packaging is intact\", " +
        "\"box is untouched\", \"I never used it\", \"just took it out of the box once but did not use it\". " +
        "Indicators the item IS opened or used include: \"I used it\", \"I wore them\", \"works great\" " +
        "(implies use), \"I cooked with it\", \"I tried it out\", \"I opened it\". Absence of an explicit " +
        "unopened claim, with no evidence of use, leans neutral (~0.5).",
      criteria: {
        true: "the customer states the item is unopened, sealed, or never used",
        false:
          "the customer does not state that, or indicates the item was opened or used",
      },
    },
    target_defective: {
      type: "noul",
      instructions:
        "For the single item the customer is requesting to return in `request.message`, does the message " +
        "report that the item is defective, broken, damaged, faulty, or not working as expected? A \"defect\" " +
        "is a fault with the item itself, NOT a change of mind. \"Defective/faulty\" includes: \"does not work\", " +
        "\"broken\", \"won't charge\", \"won't turn on\", \"damaged on arrival\", \"missing parts\", " +
        "\"stopped working\", \"arrived defective\", \"faulty\". NOT defective includes: \"I don't need it\", " +
        "\"changed my mind\", \"wrong size\", \"wrong color\", \"didn't like it\", " +
        "\"I bought it elsewhere for less\", \"found a better one\", \"I no longer need it\".",
      criteria: {
        true: "the message reports a fault, defect, damage, or that the item does not work correctly",
        false: "no fault, defect, or damage is reported",
      },
    },
  };
}

function parseDate(s) {
  return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
}
function daysFromDelivery(deliveredStr, requestedStr) {
  // delivery day counts as day 1
  return Math.floor((parseDate(requestedStr) - parseDate(deliveredStr)) / 86_400_000) + 1;
}

export function decide(answers, input) {
  const ts = answers?.target_sku;
  if (!ts?.choice) return { eligible: "abstain" };

  // Identify which item the message targets; escalate if not confident.
  if (ts.choice === "ambiguous") return { eligible: "abstain" };
  if ((ts.probabilities?.[ts.choice] ?? 0) < 0.6) return { eligible: "abstain" };

  const item = input.order.items.find((it) => it.sku === ts.choice);
  if (!item) return { eligible: "abstain" };

  // Hard rejections from reliable structured fields.
  if (item.final_sale === true) return { eligible: "no" };
  if (item.category === "gift_cards" || /\bgift\s*card\b/i.test(item.name)) {
    return { eligible: "no" };
  }

  // Compute how many days have elapsed (delivery day = day 1).
  let day;
  try {
    day = daysFromDelivery(item.delivered_date, input.request.date);
  } catch {
    return { eligible: "abstain" };
  }

  const isElec = item.category === "electronics";
  const dN = answers.target_defective?.noul ?? 0.5;
  const uN = answers.target_unopened?.noul ?? 0.5;

  // Non-electronics: 30-day window, no condition restriction.
  if (!isElec) {
    return day <= 30 ? { eligible: "yes" } : { eligible: "no" };
  }

  // Electronics: condition-dependent window.
  //   defective                       -> 30 days
  //   unopened and not defective      -> 15 days
  //   opened and not defective        -> cannot return
  //   any uncertain case in 16-30     -> abstain (a defect/condition doubt
  //                                       must not relax the decision)
  const isDef = dN >= 0.7;
  const notDef = dN < 0.3;
  const isUnopen = uN >= 0.7;
  const notUnopen = uN < 0.3;

  if (isDef) {
    return day <= 30 ? { eligible: "yes" } : { eligible: "no" };
  }
  if (notDef && notUnopen) {
    return { eligible: "no" };
  }
  if (notDef && isUnopen) {
    return day <= 15 ? { eligible: "yes" } : { eligible: "no" };
  }
  if (notDef) {
    // not defective, unopened status uncertain
    if (day <= 15) return { eligible: "yes" };
    if (day <= 30) return { eligible: "abstain" };
    return { eligible: "no" };
  }
  if (isUnopen) {
    // definitely unopened, defect status uncertain
    if (day <= 15) return { eligible: "yes" };
    if (day <= 30) return { eligible: "abstain" };
    return { eligible: "no" };
  }
  if (notUnopen) {
    // definitely opened, defect status uncertain
    if (day <= 30) return { eligible: "abstain" };
    return { eligible: "no" };
  }
  // Both uncertain.
  return day <= 30 ? { eligible: "abstain" } : { eligible: "no" };
}
