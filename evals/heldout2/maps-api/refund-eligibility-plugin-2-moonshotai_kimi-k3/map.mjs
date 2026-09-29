// map.mjs — return-eligibility decisions for multi-item orders, built on Jev.
//
// Design (per jev-questions rules):
//  - Jev only reads present-tense facts: which item is being returned, what the
//    policy says (windows, exclusions, conditions), what the customer claims.
//  - All arithmetic and every comparison (dates, day counts, windows) happens
//    in code from structured inputs — Jev is never asked "is it within the window".
//  - Doubt never relaxes a decision: low-probability reads and genuine ambiguity
//    become "abstain" (send to a person), never "yes".

const DAY_MS = 86400000;
const GATE_CHOICE = 0.7; // act on a choice label only at this probability
const GATE_CLAIM = 0.6;  // below this, a claim reads as "not_mentioned"
const NOUL_TRUE = 0.65;
const NOUL_FALSE = 0.35;
const DAYS = [7, 10, 14, 15, 21, 30, 45, 60, 90, 120, 180, 365];

const dayOptions = (extra) => ({
  ...Object.fromEntries(DAYS.map((d) => [String(d), `${d} days after delivery`])),
  ...extra,
});

const choiceProb = (a) => a?.probabilities?.[a?.choice] ?? 0;

export function buildState(input) {
  const items = input?.order?.items ?? [];
  return {
    policy: input?.policy_text ?? "",
    order_items: items.map((it, i) => ({
      id: `item_${i}`,
      sku: it.sku ?? "",
      name: it.name ?? "",
      category: it.category ?? "",
      final_sale: Boolean(it.final_sale),
      price: it.price ?? null,
      delivered_date: it.delivered_date ?? "",
    })),
    request_date: input?.request?.date ?? "",
    message: input?.request?.message ?? "",
    reading_conventions:
      "How to read this case. `message` is the customer's free-text request; it may mention several items from `order_items`. The item to evaluate is the one the customer asks to send back or return; items they praise or say they are keeping are not being returned. Take what the customer states about the item's condition (unopened, unused, defective, damaged) at face value. `policy` is the store's returns policy; its windows run from the item's delivered_date to request_date.",
  };
}

export function questions(input) {
  const items = input?.order?.items ?? [];
  const q = {};

  // Pick the one item being returned (one choice over all items; no pre-filtering).
  q.item = {
    type: "choice",
    instructions:
      "Which entry in `order_items` is the customer in `message` asking to return or send back? Answer with that entry's id. Do not pick an item the customer says they are keeping or only mentions for context.",
    criteria: {
      ...Object.fromEntries(
        items.map((it, i) => [`item_${i}`, `${it.name} (category: ${it.category}, sku: ${it.sku})`])
      ),
      unclear:
        "the message does not identify exactly one item to return: it asks to return several items, names an item that is not in `order_items`, or it cannot be told which item is meant",
    },
  };

  q.delivery_is_day_one = {
    type: "noul",
    instructions: "Does `policy` state that the delivery day itself counts as day 1 of the return window?",
    criteria: {
      true: "`policy` says the day of delivery counts as the first day of the return window",
      false: "`policy` says nothing of the kind, or says the window starts the day after delivery",
    },
  };

  q.condition_claim = {
    type: "choice",
    instructions:
      "What does `message` say about whether the item the customer wants to return has been opened or used?",
    criteria: {
      states_unopened: "the message says the item is unopened, unused, or still sealed",
      states_opened_or_used: "the message says the item has been opened, used, tried, or worn",
      not_mentioned: "the message says nothing about whether the item has been opened or used",
    },
  };

  q.defect_claim = {
    type: "choice",
    instructions: "What does `message` say about whether the item the customer wants to return is defective?",
    criteria: {
      states_defective: "the message says the item is defective, faulty, broken, damaged, or not working",
      states_working:
        "the message indicates the item works and nothing is wrong with it (for example a change of mind, wrong item, or no longer wanted)",
      not_mentioned: "the message says nothing about whether the item works or is damaged",
    },
  };

  // Detector beside a manipulable judgment: claims of prior approval.
  q.claims_approval = {
    type: "noul",
    instructions:
      "Does `message` claim that a person, support agent, or the store has already approved or authorised this return?",
    criteria: {
      true: "the message asserts the return was already approved or authorised",
      false: "the message makes no such claim",
    },
  };

  // Per-item policy facts, each scoped to its entry in `order_items`.
  items.forEach((it, i) => {
    const ref = `the item with id item_${i} in \`order_items\``;

    q[`excluded_${i}`] = {
      type: "noul",
      instructions: `Does \`policy\` state that ${ref} — or the kind of item it is, given its name and category — cannot be returned at all? Answer true only if \`policy\` excludes this kind of item from returns entirely (for example gift cards, final sale items, perishable or hygiene products, if the policy names such kinds).`,
      criteria: {
        true: "`policy` says this kind of item can never be returned",
        false: "`policy` allows returns of this kind of item, possibly with a window or conditions, or says nothing about it",
      },
    };

    q[`window_${i}`] = {
      type: "choice",
      instructions: `Within how many days of delivery does \`policy\` allow ${ref} to be returned? Use the window \`policy\` gives for its kind of item (its category); if \`policy\` gives only a general window covering most items, use that. Give the window for a normal, non-defective item, even if \`policy\` attaches conditions such as being unopened.`,
      criteria: dayOptions({
        no_window_stated: "`policy` states no return window that covers this item",
      }),
    });

    q[`defective_window_${i}`] = {
      type: "choice",
      instructions: `If ${ref} is defective (faulty, damaged, or not working), within how many days of delivery does \`policy\` allow it to be returned?`,
      criteria: dayOptions({
        same_terms:
          "`policy` gives defective items of this kind no different return window from other items, or says nothing about defective items",
      }),
    };

    q[`unopened_required_${i}`] = {
      type: "noul",
      instructions: `Does \`policy\` allow a normal (non-defective) return of ${ref} only if the item is unopened or unused?`,
      criteria: {
        true: "`policy` requires this kind of item to be unopened or unused for a normal return",
        false: "`policy` sets no unopened-or-unused condition for returning this kind of item",
      },
    };
  });

  return q;
}

export function decide(answers, input) {
  const abstain = { eligible: "abstain" };
  const items = input?.order?.items ?? [];

  // 1. Which item is being returned?
  const t = answers?.item;
  if (!t || t.choice === "unclear" || choiceProb(t) < GATE_CHOICE) return abstain;
  const idx = Number(String(t.choice).split("_")[1]);
  const item = items[idx];
  if (!item) return abstain;

  // 2. Hard exclusions: the structured flag settles final sale outright;
  //    Jev reads policy exclusions of the item's kind.
  if (item.final_sale) return { eligible: "no" };
  const ex = answers[`excluded_${idx}`];
  if (ex && typeof ex.noul === "number") {
    if (ex.noul >= NOUL_TRUE) return { eligible: "no" };
    if (ex.noul > NOUL_FALSE) return abstain;
  }

  // 3. Day count: dates are structured inputs, so all arithmetic happens here.
  const delivered = Date.parse(item.delivered_date);
  const requested = Date.parse(input?.request?.date);
  if (!Number.isFinite(delivered) || !Number.isFinite(requested)) return abstain;
  const diff = Math.round((requested - delivered) / DAY_MS);
  if (diff < 0) return abstain;
  const d1 = answers.delivery_is_day_one;
  if (!d1 || typeof d1.noul !== "number") return abstain;
  let dayNumber;
  if (d1.noul >= NOUL_TRUE) dayNumber = diff + 1;
  else if (d1.noul <= NOUL_FALSE) dayNumber = diff;
  else return abstain;

  // 4. Windows: Jev reads each side as a stated number; the comparison is done here.
  const w = answers[`window_${idx}`];
  if (!w || w.choice === "no_window_stated" || choiceProb(w) < GATE_CHOICE) return abstain;
  const standard = Number(w.choice);
  if (!Number.isFinite(standard)) return abstain;

  const dw = answers[`defective_window_${idx}`];
  let defective = null;
  let defectiveKnown = true;
  if (!dw) {
    defectiveKnown = false;
  } else if (dw.choice === "same_terms") {
    defectiveKnown = choiceProb(dw) >= GATE_CHOICE;
  } else if (choiceProb(dw) >= GATE_CHOICE && Number.isFinite(Number(dw.choice))) {
    defective = Number(dw.choice);
  } else {
    defectiveKnown = false;
  }

  // 5. The customer's claims; an unsure read collapses to "not_mentioned".
  const claim = (a) => (a && a.choice && choiceProb(a) >= GATE_CLAIM ? a.choice : "not_mentioned");
  const defect = claim(answers.defect_claim);
  const cond = claim(answers.condition_claim);

  // 6. Effective window; a defective exception replaces the normal terms.
  let limit = standard;
  let waived = false;
  if (defect === "states_defective") {
    if (!defectiveKnown) return abstain;
    if (defective != null) {
      limit = defective;
      waived = true;
    }
  }

  // 7. Compare in code. Doubt goes to a person, never to "yes".
  if (dayNumber > limit) {
    if (defect !== "states_defective") {
      if (!defectiveKnown) return abstain;
      // Silent on defect, but a defective window would still cover it: ask a person.
      if (defect === "not_mentioned" && defective != null && dayNumber <= defective) return abstain;
    }
    return denyWithApprovalCheck();
  }

  const ur = answers[`unopened_required_${idx}`];
  if (ur && typeof ur.noul === "number" && !waived) {
    if (ur.noul >= NOUL_TRUE) {
      if (cond === "states_opened_or_used") return denyWithApprovalCheck();
      if (cond !== "states_unopened") return abstain; // ask the customer about condition
    } else if (ur.noul > NOUL_FALSE && cond !== "states_unopened") {
      return abstain; // unsure whether a condition applies and it is not clearly met
    }
  }

  return { eligible: "yes" };

  // A claimed prior approval never opens a return, but a denial despite such a
  // claim goes to a person to verify (detector veto).
  function denyWithApprovalCheck() {
    const ap = answers.claims_approval?.noul;
    if (typeof ap === "number" && ap >= NOUL_TRUE) return abstain;
    return { eligible: "no" };
  }
}
