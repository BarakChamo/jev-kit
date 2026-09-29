// map.mjs — return-request eligibility triage on Jev (TypeSafe System One).
//
// One parallel pass, two choice questions per order item:
//   item_<i>_return_requested : does the customer's message ask to return item i?
//   item_<i>_eligible         : is item i eligible under the policy at the request date?
// Eligibility is asked for every item (not just the identified one) because all questions
// are answered in a single pass and cannot depend on each other. Date arithmetic is done
// in JS and injected into the state/questions so the model never has to count days.
// decide() abstains whenever identification or eligibility is uncertain — those cases
// go to a person.

const DAY_MS = 86400000;
const ABSTAIN = { eligible: "abstain" };

function parseDay(s) {
  if (typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const t = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

// Whole days from `from` to `to` (0 = same day), or null if a date is unparseable.
function daysAfter(from, to) {
  const a = parseDay(from);
  const b = parseDay(to);
  return a === null || b === null ? null : Math.round((b - a) / DAY_MS);
}

// Probability mass an answer puts on `option`; falls back to confidence when that option
// was chosen, else 0. Missing or malformed answers score 0.
function strength(answer, option) {
  if (!answer || typeof answer !== "object") return 0;
  const p = answer.probabilities;
  if (p && typeof p[option] === "number") return p[option];
  return answer.choice === option && typeof answer.confidence === "number" ? answer.confidence : 0;
}

function itemLabel(item, i, n) {
  const bits = [
    `sku ${item.sku ?? "?"}`,
    `item ${i + 1} of ${n}`,
    `category ${item.category ?? "?"}`,
    `price ${item.price ?? "?"}`,
  ];
  if (item.final_sale) bits.push("marked final sale");
  return `"${item.name ?? item.sku ?? "unnamed item"}" (${bits.join(", ")})`;
}

function timingSentence(item, requestDate, days) {
  if (days === null) {
    return `The delivery date (${item.delivered_date ?? "missing"}) or the request date (${requestDate ?? "missing"}) is missing or unparseable, so the return-window timing cannot be computed.`;
  }
  if (days < 0) {
    return `The item is not delivered yet (due ${item.delivered_date}); the request was made on ${requestDate ?? "?"}, ${-days} day(s) before delivery.`;
  }
  return `The item was delivered on ${item.delivered_date}; the request was made on ${requestDate ?? "?"}, ${days} day(s) after delivery — day ${days + 1} if the delivery day itself counts as day 1.`;
}

export function buildState(input) {
  const requestDate = input?.request?.date ?? null;
  const items = (input?.order?.items ?? []).map((item, i) => {
    const days = daysAfter(item.delivered_date, requestDate);
    return {
      position_in_order: i + 1,
      sku: item.sku ?? null,
      name: item.name ?? null,
      category: item.category ?? null,
      final_sale: Boolean(item.final_sale),
      price: item.price ?? null,
      delivered_date: item.delivered_date ?? null,
      days_since_delivery: days,
      day_number_if_delivery_day_counts_as_1: days === null ? null : days + 1,
    };
  });
  return {
    policy_text: input?.policy_text ?? "",
    order: { order_id: input?.order?.order_id ?? null, items },
    request: { date: requestDate, message: input?.request?.message ?? "" },
  };
}

export function questions(input) {
  const items = input?.order?.items ?? [];
  const requestDate = input?.request?.date ?? null;
  const qs = {};
  items.forEach((item, i) => {
    const label = itemLabel(item, i, items.length);
    const timing = timingSentence(item, requestDate, daysAfter(item.delivered_date, requestDate));

    qs[`item_${i}_return_requested`] = {
      type: "choice",
      instructions:
        `Read the customer's return request message in the state. Does that message ask to return ${label}? ` +
        `Judge only from the message: asking to return, send back, exchange, or get a refund for this item means yes, and asking to return the whole order covers every item in it. ` +
        `Mentioning the item without asking to return it, or saying the customer is keeping, likes, or uses it, means no. ` +
        `A reference such as "it", "the headphones", "the second item", "the cheap one", or "the $49 one" counts only if it most plausibly points to this item. ` +
        `If the message might or might not include this item in the return, answer unclear rather than guessing.`,
      criteria: {
        yes: "The message asks to return this item, explicitly or through a reference that most plausibly points to it.",
        no: "The message does not ask to return this item: not mentioned, mentioned without a return request, or explicitly kept.",
        unclear: "Whether this item is included in the return request cannot be determined from the message.",
      },
    };

    qs[`item_${i}_eligible`] = {
      type: "choice",
      instructions:
        `Apply the returns policy (policy_text in the state) to this single item, regardless of whether the customer actually wants to return it: ${label}. ${timing} ` +
        `Follow the policy exactly as written: excluded items or flags (for example final sale or gift cards, if the policy names them), category-specific windows and conditions, condition-dependent rules (for example defective items), and the policy's own way of counting the window — use the computed day numbers instead of recomputing dates. ` +
        `Also use statements in the customer's message that refer to this item (for example opened/unopened, used, defective). ` +
        `If the policy requires a condition that is not stated anywhere (for example whether an item that must be unopened is unopened), or the policy or dates do not clearly cover this situation, answer undetermined rather than guessing.`,
      criteria: {
        eligible: "On the stated facts, dates, and the policy's own window counting, the policy permits returning this item on the request date.",
        not_eligible: "The policy clearly does not permit the return: the item or flag is excluded, the request is past the allowed window, or a stated required condition fails.",
        undetermined: "Eligibility cannot be decided: a policy-required condition is not stated, or the policy or dates do not clearly cover this situation.",
      },
    };
  });
  return qs;
}

export function decide(answers, input) {
  const items = input?.order?.items ?? [];
  if (!Array.isArray(items) || items.length === 0) return ABSTAIN;
  answers = answers ?? {};

  // 1) Which items is the customer asking to return?
  const requested = [];
  for (let i = 0; i < items.length; i++) {
    const a = answers[`item_${i}_return_requested`];
    if (!a) return ABSTAIN; // missing answer — do not guess
    const pYes = strength(a, "yes");
    if (pYes >= 0.6) requested.push(i);
    else if (pYes > 0.3) return ABSTAIN; // real doubt whether this item is included
  }
  if (requested.length === 0) return ABSTAIN; // message identifies no item clearly

  const dayCounts = requested.map((i) => daysAfter(items[i].delivered_date, input?.request?.date));
  if (dayCounts.some((d) => d !== null && d < 0)) return ABSTAIN; // request predates delivery

  // 2) Policy verdict for each requested item.
  let anyEligible = false;
  let anyNotEligible = false;
  for (let k = 0; k < requested.length; k++) {
    const i = requested[k];
    const a = answers[`item_${i}_eligible`];
    const choice = a?.choice;
    if (choice === "eligible" && strength(a, "eligible") >= 0.5) {
      if (dayCounts[k] === null) return ABSTAIN; // cannot verify timing for a "yes"
      anyEligible = true;
    } else if (choice === "not_eligible" && strength(a, "not_eligible") >= 0.5) {
      anyNotEligible = true; // a clear exclusion stands even without usable dates
    } else {
      return ABSTAIN; // undetermined, weak, or missing
    }
  }

  if (anyEligible && anyNotEligible) return ABSTAIN; // requested items disagree
  return { eligible: anyEligible ? "yes" : "no" };
}
