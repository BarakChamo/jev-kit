// map.mjs
// Returns-eligibility classifier built on the Jev (TypeSafe System One) API.
// For each customer free-text return request, Jev extracts which order item is
// being returned and the condition the customer describes; the deterministic
// policy/date logic is then applied in decide().

function daysSince(delivered, request) {
  const d1 = Date.parse(delivered + "T00:00:00Z");
  const d2 = Date.parse(request   + "T00:00:00Z");
  if (!Number.isFinite(d1) || !Number.isFinite(d2)) return NaN;
  // Day 1 is the delivery day itself.
  return Math.floor((d2 - d1) / 86400000) + 1;
}

export function buildState(input) {
  return {
    policy: input.policy_text,
    order_id: input.order.order_id,
    request: input.request,
    items: input.order.items.map(it => ({
      sku: it.sku,
      name: it.name,
      category: it.category,
      final_sale: !!it.final_sale,
      delivered_date: it.delivered_date,
      days_since_delivery: daysSince(it.delivered_date, input.request.date),
    })),
  };
}

export function questions(input) {
  const opts = {};
  for (const it of input.order.items) {
    const tag = it.final_sale ? ", final sale" : "";
    opts[it.sku] = `${it.name} (sku ${it.sku}, ${it.category}${tag})`;
  }
  opts.none =
    "Not in this order / customer is not requesting a return of any of these items";

  return {
    targeted_item: {
      type: "choice",
      instructions:
        "From the customer's free-text message, identify which single item in " +
        "this order they are asking to return. Match by product name, " +
        "descriptor (e.g. 'the headphones', 'the pan'), category reference, " +
        "or any other reasonable wording. If the message does not request a " +
        "return of any item in this order, or the referenced item cannot be " +
        "matched to anything here, choose 'none'.",
      criteria: opts,
    },
    item_condition: {
      type: "choice",
      instructions:
        "From the customer's message, classify the condition claim about " +
        "the item being returned. 'unopened' = sealed, never opened, in " +
        "original packaging, or unused. 'defective' = broken, damaged, not " +
        "working, defective, not as described, or wrong item received. " +
        "'opened' = used or opened without any defect claim. 'unstated' = " +
        "the customer does not address the condition at all.",
      criteria: {
        unopened: "Sealed / never opened / in original packaging.",
        defective: "Broken, damaged, defective, or not as described.",
        opened:   "Used or opened; no defect claim made.",
        unstated: "Condition is not mentioned.",
      },
    },
  };
}

const MIN_CONF = 0.6;

export function decide(answers, input) {
  const t = answers && answers.targeted_item;
  if (!t || t.choice === "none") return { eligible: "abstain" };
  if ((t.confidence ?? 0) < MIN_CONF) return { eligible: "abstain" };

  const item = input.order.items.find(it => it.sku === t.choice);
  if (!item) return { eligible: "abstain" };

  if (item.final_sale) return { eligible: "no" };

  const days = daysSince(item.delivered_date, input.request.date);
  if (!Number.isFinite(days) || days < 1) return { eligible: "no" };

  const condAns = answers && answers.item_condition;
  const cond  = (condAns && condAns.choice)     || "unstated";
  const cconf = (condAns && condAns.confidence) ?? 0;

  if (item.category === "electronics") {
    if (days <= 15) {
      if (cond === "unopened"  && cconf >= MIN_CONF) return { eligible: "yes" };
      if (cond === "defective" && cconf >= MIN_CONF) return { eligible: "yes" };
      return { eligible: "no" };
    }
    if (days <= 30) {
      if (cond === "defective" && cconf >= MIN_CONF) return { eligible: "yes" };
      return { eligible: "no" };
    }
    return { eligible: "no" };
  }

  if (days <= 30) return { eligible: "yes" };
  return { eligible: "no" };
}
