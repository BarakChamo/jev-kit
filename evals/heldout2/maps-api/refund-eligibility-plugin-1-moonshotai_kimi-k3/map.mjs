// map.mjs — return-eligibility map for Jev (TypeSafe System One).
//
// Design: Jev reads facts only — which item the customer means, what the policy
// states (windows, conditions, exclusions), and what the message says about the
// item's condition. All date arithmetic, window comparisons and the final
// decision happen in code. Any doubtful read on a decisive fact -> "abstain".

const DAY_OPTIONS = [7, 10, 14, 15, 21, 28, 30, 45, 60, 90, 120, 180, 365];

const ITEM_GATE = 0.7;    // min probability of the chosen item label
const CHOICE_GATE = 0.6;  // min probability for acting on a policy choice
const NOUL_HI = 0.6, NOUL_LO = 0.4; // a noul is decisive only outside this band

const slug = (s) =>
  String(s ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";

const dayCriteria = (extra) => ({
  ...Object.fromEntries(DAY_OPTIONS.map((d) => [String(d), `the policy states a window of ${d} days`])),
  ...extra,
});

const WINDOW_NOTE =
  " Read the number of days the policy states; do not judge whether any particular request is on time." +
  " If the window is given in weeks or months, convert it to days (a week is 7 days, a month is 30 days) and choose the closest option.";

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    items: input.order.items,
    message: input.request.message,
    request_date: input.request.date,
  };
}

export function questions(input) {
  const items = input.order.items;
  const catLabel = {};
  for (const it of items) {
    const s = slug(it.category);
    if (!(s in catLabel)) catLabel[s] = it.category ?? "unknown";
  }

  const q = {
    item: {
      type: "choice",
      instructions:
        "Which item in `items` is the customer asking to return in `message`? Choose the item they want to send back or be refunded for. Do not choose an item they only mention to praise, say they are keeping, or ask an unrelated question about.",
      criteria: {
        ...Object.fromEntries(items.map((it, i) => [String(i), `${it.sku} — ${it.name} (category: ${it.category})`])),
        unclear:
          "the message asks to return more than one item, does not identify a specific item, or asks about an item that is not in `items`",
      },
    },
    msg_defective: {
      type: "noul",
      instructions:
        "Does the customer say in `message` that the item they want to return is defective, broken, damaged, faulty, or does not work? Only statements about the item to be returned count, not other items.",
      criteria: { true: "the message says the item to be returned is defective or not working", false: "the message says no such thing" },
    },
    msg_unopened: {
      type: "noul",
      instructions:
        "Does the customer say in `message` that the item they want to return is unopened, sealed, or still in its original packaging? Only statements about the item to be returned count.",
      criteria: { true: "the message says the item to be returned is unopened or sealed", false: "the message says no such thing" },
    },
    msg_opened: {
      type: "noul",
      instructions:
        "Does the customer say in `message` that the item they want to return has been opened, unsealed, or used? Only statements about the item to be returned count.",
      criteria: { true: "the message says the item to be returned has been opened or used", false: "the message says no such thing" },
    },
    msg_pristine: {
      type: "noul",
      instructions:
        "Does the customer say in `message` that the item they want to return is unused, unworn, or like new? Only statements about the item to be returned count.",
      criteria: { true: "the message says the item to be returned is unused or like new", false: "the message says no such thing" },
    },
    day_count: {
      type: "noul",
      instructions: "Does `policy_text` say that the delivery day counts as day 1 of the return window?",
      criteria: { true: "the policy says the delivery day is day 1 of the window", false: "the policy does not say this" },
    },
    excludes_final_sale: {
      type: "noul",
      instructions: "Does `policy_text` say that items marked final sale cannot be returned?",
      criteria: { true: "the policy excludes final sale items from returns", false: "the policy does not exclude them" },
    },
    excludes_gift_cards: {
      type: "noul",
      instructions: "Does `policy_text` say that gift cards cannot be returned?",
      criteria: { true: "the policy excludes gift cards from returns", false: "the policy does not exclude them" },
    },
    win_general: {
      type: "choice",
      instructions: "Within how many days of delivery does `policy_text` say most items can be returned?" + WINDOW_NOTE,
      criteria: dayCriteria({
        no_limit: "the policy states there is no deadline for returns",
        none_stated: "the policy does not state a general return window",
      }),
    },
  };

  items.forEach((it, i) => {
    q[`giftcard_${i}`] = {
      type: "noul",
      instructions: `Is the item \`items[${i}]\` ("${it.name}", category "${it.category}") a gift card or a voucher?`,
      criteria: { true: "the item is a gift card or voucher", false: "it is a normal product" },
    };
  });

  for (const [c, label] of Object.entries(catLabel)) {
    q[`win_${c}`] = {
      type: "choice",
      instructions:
        `Within how many days of delivery does \`policy_text\` say an item in the "${label}" category can be returned, when the item is not defective?` +
        " If the policy gives a window for a broader group that includes this category (for example electronics), use that." +
        " If the policy gives no special window for this category, choose 'general'." + WINDOW_NOTE,
      criteria: dayCriteria({
        general: "the policy states no special window for this category; the window for most items applies",
        no_limit: "the policy states there is no deadline for returning this category",
      }),
    };
    q[`defwin_${c}`] = {
      type: "choice",
      instructions:
        `Within how many days of delivery does \`policy_text\` say a defective item in the "${label}" category can be returned?` +
        " If the policy gives defective items the same window as other items, or does not state a separate window for defective items, choose 'same'." + WINDOW_NOTE,
      criteria: dayCriteria({ same: "defective items get the same window, or no separate defective window is stated" }),
    };
    q[`cond_${c}`] = {
      type: "choice",
      instructions: `What condition does \`policy_text\` require a non-defective item in the "${label}" category to be in for it to be returnable?`,
      criteria: {
        none: "the policy states no condition on the item's condition",
        unopened: "the item must be unopened, sealed, or in its original unopened packaging",
        unused: "the item must be unused, unworn, or in its original condition (for example with tags attached)",
      },
    };
    q[`defex_${c}`] = {
      type: "noul",
      instructions: `Does \`policy_text\` excuse a defective item in the "${label}" category from the condition it normally requires for a return (for example with a phrase like "unless the item is defective")?`,
      criteria: { true: "defective items are excused from the condition", false: "the condition still applies to defective items, or the policy says nothing about excusing them" },
    };
    q[`never_${c}`] = {
      type: "noul",
      instructions: `Does \`policy_text\` say that items in the "${label}" category, or a group that includes this category, can never be returned?`,
      criteria: { true: "the policy makes this category non-returnable", false: "the policy does not" },
    };
  }

  return q;
}

export function decide(answers, input) {
  const ABSTAIN = { eligible: "abstain" };
  const NO = { eligible: "no" };
  const tri = (v) => (v == null ? null : v >= NOUL_HI ? true : v <= NOUL_LO ? false : null);
  const pick = (a, gate) => (a && (a.probabilities?.[a.choice] ?? 0) >= gate ? a.choice : null);
  const items = input.order.items;

  // 1. Which item is being returned.
  const itemChoice = answers.item?.choice;
  if (itemChoice == null || itemChoice === "unclear" || (answers.item.probabilities?.[itemChoice] ?? 0) < ITEM_GATE) return ABSTAIN;
  const idx = Number(itemChoice);
  const item = items[idx];
  if (!item) return ABSTAIN;
  const cat = slug(item.category);

  // 2. Day number of the request, from the structured dates (never asked of the model).
  const delivered = Date.parse(item.delivered_date);
  const requested = Date.parse(input.request.date);
  if (!isFinite(delivered) || !isFinite(requested)) return ABSTAIN;
  const dayOne = (answers.day_count?.noul ?? 0.5) >= 0.5;
  const dayNumber = Math.round((requested - delivered) / 86400000) + (dayOne ? 1 : 0);
  if (dayNumber < (dayOne ? 1 : 0)) return ABSTAIN;

  // 3. Classes the policy never takes back.
  if (item.final_sale) {
    const ex = tri(answers.excludes_final_sale?.noul);
    if (ex === true) return NO;
    if (ex === null) return ABSTAIN;
  }
  const gc = tri(answers[`giftcard_${idx}`]?.noul);
  if (gc === null) return ABSTAIN;
  if (gc) {
    const ex = tri(answers.excludes_gift_cards?.noul);
    if (ex === true) return NO;
    if (ex === null) return ABSTAIN;
  }
  const never = tri(answers[`never_${cat}`]?.noul);
  if (never === null) return ABSTAIN;
  if (never) return NO;

  // 4. Applicable window: category-specific beats general; defective beats standard.
  const num = (s) => (s === "no_limit" ? Infinity : Number(s));
  const winSel = pick(answers[`win_${cat}`], CHOICE_GATE);
  if (winSel === null) return ABSTAIN;
  let std;
  if (winSel === "general") {
    const g = pick(answers.win_general, CHOICE_GATE);
    if (g === null || g === "none_stated") return ABSTAIN;
    std = num(g);
  } else {
    std = num(winSel);
  }
  if (std !== Infinity && !Number.isFinite(std)) return ABSTAIN;
  const defSel = pick(answers[`defwin_${cat}`], CHOICE_GATE);
  if (defSel === null) return ABSTAIN;
  const defWin = defSel === "same" ? std : num(defSel);
  if (defWin !== Infinity && !Number.isFinite(defWin)) return ABSTAIN;

  const cond = pick(answers[`cond_${cat}`], CHOICE_GATE);
  if (cond === null) return ABSTAIN;

  let defective = tri(answers.msg_defective?.noul);
  if (defective === null) {
    // Vague about defects only matters if the policy treats defective items differently.
    if (defWin !== std || cond !== "none") return ABSTAIN;
    defective = false;
  }

  const window = defective ? defWin : std;
  if (dayNumber > window) return NO;

  // 5. Condition the policy requires (e.g. unopened), checked against the message.
  if (cond !== "none") {
    let excused = false;
    if (defective) {
      const ex = tri(answers[`defex_${cat}`]?.noul);
      if (ex === null) return ABSTAIN;
      excused = ex;
    }
    if (!excused) {
      const unopened = tri(answers.msg_unopened?.noul);
      const pristine = tri(answers.msg_pristine?.noul);
      const opened = tri(answers.msg_opened?.noul);
      const satisfied = unopened === true || (cond === "unused" && pristine === true);
      if (!satisfied) {
        if (opened === true) return NO;
        return ABSTAIN; // message silent on a required condition: a person should decide
      }
    }
  }

  return { eligible: "yes" };
}
