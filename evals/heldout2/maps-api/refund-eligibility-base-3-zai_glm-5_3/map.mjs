// map.mjs — one returns-eligibility case per invocation, using the Jev (TypeSafe System One) API.
// Strategy: Jev extracts the fuzzy, language-dependent facts in a single parallel pass
// (which item is targeted, claims of defect / unopened / opened, which policy rule an item
// falls under). Everything deterministic (final-sale flags, day counting) is done in code.
// Ambiguous or unverifiable cases are routed to a human ("abstain").

const WINDOWS = { standard: 30, electronics: 15, defectiveElectronics: 30 };
const CLAIM = 0.65;   // noul probability at/above which we accept a customer claim
const DENY = 0.35;    // below this the claim is treated as "not made" / contradicted
const MIN_TARGET_CONF = 0.55, MIN_RULE_CONF = 0.5;

export function buildState(input) {
  return {
    policy: input.policy_text,
    order_id: input.order?.order_id,
    request_date: input.request?.date,
    message: input.request?.message,
    items: (input.order?.items ?? []).map((it, i) => ({
      index: i,
      sku: it.sku,
      name: it.name,
      category: it.category,
      final_sale: !!it.final_sale,
      price: it.price,
      delivered_date: it.delivered_date,
    })),
  };
}

export function questions(input) {
  const items = input.order?.items ?? [];
  const q = {
    target: {
      type: "choice",
      instructions:
        "Read the customer's return request message. Which single item from the order are they asking to return? " +
        "Items the customer says they are keeping are NOT being returned. If the message names no item, names more " +
        "than one item to return, names something not in the order, or is ambiguous, choose 'unclear'.",
      criteria: Object.assign(
        Object.fromEntries(items.map((it) => [String(it.sku), `${it.name} (sku ${it.sku}, category ${it.category})`])),
        { unclear: "No single item in the order is clearly the target of the return request." },
      ),
    },
    defect: {
      type: "noul",
      instructions:
        "Does the customer state or clearly imply that the item they want to return is defective, damaged, broken or not working?",
      criteria: {
        true: "The customer says the item is defective, damaged, broken, faulty or not working.",
        false: "The customer does not say the item is defective or damaged.",
      },
    },
    unopened: {
      type: "noul",
      instructions:
        "Does the customer state that the item they want to return is unopened, unused, or still sealed in its original packaging?",
      criteria: {
        true: "The customer says the item is unopened, unused or still sealed.",
        false: "The customer does not say the item is unopened or unused.",
      },
    },
    opened: {
      type: "noul",
      instructions:
        "Does the customer state that the item they want to return has been opened or used?",
      criteria: {
        true: "The customer says the item was opened, used, or taken out of its packaging.",
        false: "The customer does not say the item was opened or used.",
      },
    },
  };
  items.forEach((it, i) => {
    q["rule_" + i] = {
      type: "choice",
      instructions:
        `Consider item ${i} ("${it.name}", category "${it.category}") together with the returns policy in the state. ` +
        "Which policy rule applies to this item?",
      criteria: {
        gift_card: "The item is a gift card or similar stored-value credit that the policy says can never be returned.",
        electronics: "The item is an electronic device, so the policy's special electronics rule applies (shorter window; unopened requirement unless defective).",
        standard: "The item is an ordinary item covered by the policy's general return rule.",
      },
    };
  });
  return q;
}

const YES = { eligible: "yes" }, NO = { eligible: "no" }, ABSTAIN = { eligible: "abstain" };

function dayCount(deliveredDate, requestDate) {
  // Delivery day counts as day 1: same-day => 1.
  const d = Date.parse(deliveredDate + "T00:00:00Z");
  const r = Date.parse(requestDate + "T00:00:00Z");
  if (isNaN(d) || isNaN(r)) return NaN;
  return Math.round((r - d) / 86400000) + 1;
}

export function decide(answers, input) {
  const a = answers ?? {};
  const items = input.order?.items ?? [];

  // 1. Resolve which item the request is about.
  const t = a.target;
  if (!t || t.type !== "choice" || t.choice === "unclear" || (t.confidence ?? 0) < MIN_TARGET_CONF) return ABSTAIN;
  const idx = items.findIndex((it) => String(it.sku) === String(t.choice));
  if (idx < 0) return ABSTAIN;
  const item = items[idx];

  // 2. Hard, unconditional exclusions (deterministic).
  if (item.final_sale) return NO;
  if (/gift\s*card/i.test(String(item.category) + " " + String(item.name))) return NO;

  // 3. Which policy rule applies.
  const rule = a["rule_" + idx];
  if (!rule || rule.type !== "choice" || (rule.confidence ?? 0) < MIN_RULE_CONF) return ABSTAIN;
  if (rule.choice === "gift_card") return NO;

  // 4. Day counting (deterministic).
  const days = dayCount(item.delivered_date, input.request?.date);
  if (!isFinite(days)) return ABSTAIN;

  const p = (k) => (a[k]?.type === "noul" ? a[k].noul : 0.5);
  const defect = p("defect") >= CLAIM;
  const maybeDefect = p("defect") > DENY;
  const unopened = p("unopened") >= CLAIM;
  const opened = p("opened") >= CLAIM;

  // 5. Apply the policy.
  if (rule.choice === "electronics") {
    if (days > WINDOWS.defectiveElectronics) return NO; // even defective items: 30-day cap
    if (defect) return YES;
    if (days <= WINDOWS.electronics) {
      if (unopened) return YES;
      if (opened && !maybeDefect) return NO; // opened/used, no defect claim
      return ABSTAIN; // condition required by policy but not verifiable from the message
    }
    // Days 16..30: only the defective path can qualify.
    return maybeDefect ? ABSTAIN : NO;
  }

  // Standard rule: plain window check.
  return days <= WINDOWS.standard ? YES : NO;
}
