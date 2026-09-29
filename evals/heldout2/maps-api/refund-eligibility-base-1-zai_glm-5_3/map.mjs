// map.mjs — return-request eligibility triage on Jev (TypeSafe System One).
//
// The customer's message and the returns policy are both free text, so each
// case is resolved with one parallel pass of Jev questions:
//
//   target   (choice) which item the customer is asking to return
//   want_i   (noul)   per item: is the customer asking to return it?
//   elig_i   (noul)   per item: does the policy allow returning it?
//
// Policy questions are asked for every item up front, because all questions
// are answered in a single parallel pass (the target item is not known yet).
// Day counts are precomputed in code so the policy verdict never depends on
// the model doing date arithmetic. decide() merges the answers into
// { eligible: "yes" | "no" | "abstain" }; "abstain" means send to a person.

const WANT_HI = 0.7;          // want_i at/above this: the customer wants item i back
const CHOICE_CONFLICT = 0.7;  // confident-but-different choice answer blocks deciding
const FLAG_CONFLICT = 0.85;   // confident multiple_items/unclear blocks shaky targets
const ELIG_YES = 0.85;        // elig_i at/above this: eligible
const ELIG_NO = 0.15;         // elig_i at/below this: not eligible
const DAY_MS = 86400000;

const itemsOf = (input) => (Array.isArray(input?.order?.items) ? input.order.items : []);

const prob = (x) => (typeof x === "number" && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : null);

function parseDay(s) {
  if (typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? t : null;
}

function timing(input, item) {
  const a = parseDay(item?.delivered_date);
  const b = parseDay(input?.request?.date);
  if (a === null || b === null) {
    return {
      known: false,
      text: `Delivered ${item?.delivered_date ?? "unknown"}; requested ${input?.request?.date ?? "unknown"}; the day count cannot be computed, so treat the timing as undetermined.`,
    };
  }
  const elapsed = Math.round((b - a) / DAY_MS);
  return {
    known: true,
    elapsed,
    inclusive: elapsed + 1,
    text: `Delivered ${item.delivered_date}; requested ${input.request.date}, which is ${elapsed} full days after delivery, or day ${elapsed + 1} if the delivery day counts as day 1.`,
  };
}

const itemLabel = (it, i) => `${it?.name ?? "(unnamed item)"} (sku ${it?.sku ?? "?"}, item ${i + 1})`;

const roster = (input) =>
  itemsOf(input)
    .map((it, i) => `${i + 1}. ${it?.name ?? "(unnamed)"} — sku ${it?.sku ?? "?"}, category ${it?.category ?? "?"}, final_sale ${it?.final_sale ? "yes" : "no"}`)
    .join("; ");

export function buildState(input) {
  const list = itemsOf(input);
  return {
    policy_text: typeof input?.policy_text === "string" ? input.policy_text : "",
    order_id: input?.order?.order_id ?? null,
    request: { date: input?.request?.date ?? null, message: input?.request?.message ?? null },
    items: list.map((it, i) => {
      const t = timing(input, it);
      return {
        index: i,
        sku: it?.sku ?? null,
        name: it?.name ?? null,
        category: it?.category ?? null,
        final_sale: !!it?.final_sale,
        price: it?.price ?? null,
        delivered_date: it?.delivered_date ?? null,
        days_since_delivery: t.known ? { elapsed: t.elapsed, counting_delivery_day_as_1: t.inclusive } : null,
      };
    }),
  };
}

export function questions(input) {
  const list = itemsOf(input);
  const message = input?.request?.message ?? "(no message)";
  const orderRef = input?.order?.order_id ?? "this order";
  const policy =
    typeof input?.policy_text === "string" && input.policy_text.trim() ? input.policy_text : "(no returns policy text was provided)";
  const rosterText = roster(input);
  const qs = {};

  // Identification: which item is the customer asking to return?
  if (list.length <= 253) {
    const criteria = {};
    list.forEach((it, i) => {
      criteria[`item_${i}`] = `The customer is asking to return ${itemLabel(it, i)}.`;
    });
    criteria.multiple_items = "The customer asks to return more than one item from the order.";
    criteria.unclear =
      "The message does not identify a single listed item to return: it is not a return request, it refers to something not in the order, or it is ambiguous between items.";
    qs.target = {
      type: "choice",
      instructions:
        `Order ${orderRef} contains: ${rosterText}\n` +
        `Customer message: "${message}"\n` +
        `Which item is the customer asking to return? Pick the single order item the return request is about; choose multiple_items if they ask to return more than one item; choose unclear otherwise.`,
      criteria,
    };
  }

  list.forEach((it, i) => {
    const label = itemLabel(it, i);

    // Identification: is this the item they want back?
    qs[`want_${i}`] = {
      type: "noul",
      instructions:
        `Order ${orderRef} contains: ${rosterText}\n` +
        `Customer message: "${message}"\n` +
        `Is the customer asking to return ${label}?`,
      criteria: {
        true: "The customer is asking to return this item: they name it, or describe it in a way that clearly matches it among the order's items.",
        false:
          "The customer is not asking to return this item: it is not mentioned, it is mentioned only to say they are keeping or are happy with it, they are referring to a different item, or they are not asking for a return.",
      },
    };

    // Policy: would returning this item be allowed?
    const t = timing(input, it);
    qs[`elig_${i}`] = {
      type: "noul",
      instructions:
        `Returns policy (verbatim):\n"""${policy}"""\n\n` +
        `Customer message: "${message}"\n` +
        `Item to assess: ${label}, category "${it?.category ?? "unknown"}", final_sale ${it?.final_sale ? "yes" : "no"}, price ${it?.price ?? "?"}. ${t.text}\n` +
        `Assume the customer is asking to return this item, and take at face value only statements in the message that clearly refer to this item (for example claims that it is unopened or defective). ` +
        `Is returning this item allowed by the policy? Answer close to 0.5 if the policy's verdict for this item cannot be determined from the information given.`,
      criteria: {
        true:
          "The policy clearly allows this return: the item is not excluded, and every policy condition for it is satisfied (the return window versus the timing given, plus any condition requirements such as unopened or unused unless defective).",
        false:
          "The policy clearly does not allow this return: the item is excluded (for example final sale or gift card), the return window has passed, or a required condition clearly fails.",
      },
    };
  });

  return qs;
}

export function decide(answers, input) {
  const ABSTAIN = { eligible: "abstain" };
  const list = itemsOf(input);
  const A = answers ?? {};
  if (list.length === 0) return ABSTAIN;

  const want = list.map((_, i) => prob(A[`want_${i}`]?.noul ?? A[`want_${i}`]?.probabilities?.true));
  const elig = list.map((_, i) => prob(A[`elig_${i}`]?.noul ?? A[`elig_${i}`]?.probabilities?.true));
  if (want.some((p) => p === null)) return ABSTAIN; // identification incomplete

  const targeted = list.map((_, i) => i).filter((i) => want[i] >= WANT_HI);
  if (targeted.length === 0) return ABSTAIN; // no clear target: a person should read it

  // Cross-check identification against the choice question.
  const choice = A.target ?? {};
  const choiceId = typeof choice.choice === "string" ? choice.choice : null;
  const conf = prob(choice.confidence);
  const m = choiceId ? /^item_(\d+)$/.exec(choiceId) : null;
  if (m) {
    const idx = +m[1];
    if ((idx >= list.length || !targeted.includes(idx)) && conf !== null && conf >= CHOICE_CONFLICT) {
      return ABSTAIN; // the two identification signals disagree
    }
  }
  if (
    (choiceId === "multiple_items" || choiceId === "unclear") &&
    conf !== null && conf >= FLAG_CONFLICT &&
    targeted.some((i) => want[i] < 0.9)
  ) {
    return ABSTAIN; // choice says this is not a clear single-item return request
  }

  // Apply the policy to every targeted item; verdicts must all agree.
  const verdicts = targeted.map((i) => {
    const p = elig[i];
    if (p === null) return null;
    if (p >= ELIG_YES) return "yes";
    if (p <= ELIG_NO) return "no";
    return null; // policy verdict uncertain (or required facts missing)
  });
  if (verdicts.includes(null)) return ABSTAIN;
  return verdicts.every((v) => v === verdicts[0]) ? { eligible: verdicts[0] } : ABSTAIN;
}
