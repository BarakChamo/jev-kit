export function buildState(input) {
  const items = (input.order?.items ?? []).map(i => ({
    sku: i.sku,
    name: i.name,
    category: i.category,
    delivered_date: i.delivered_date,
    final_sale: !!i.final_sale
  }));
  return {
    message: input.request?.message ?? "",
    request_date: input.request?.date ?? "",
    items
  };
}

export function questions(input) {
  const items = input.order?.items ?? [];
  const criteria = {};
  for (const it of items) criteria[it.sku] = `${it.name} [${it.category}]`;
  criteria["UNCLEAR"] = "cannot tell which item, or no return requested";
  criteria["MULTIPLE"] = "requests return of more than one item";
  const q = {
    target: {
      type: "choice",
      instructions: "Which single item does the customer ask to return? Use state.message and state.items. Ignore items they keep or mention in passing. If no clear single item choose UNCLEAR. If more than one choose MULTIPLE.",
      criteria
    }
  };
  const hasElec = items.some(it => String(it.category ?? "").toLowerCase().includes("electronic"));
  if (hasElec) {
    q.defective = {
      type: "noul",
      instructions: "For the item the customer wants to return (ignore kept items): is it described as defective, damaged, broken, or not working?",
      criteria: { true: "described as defective/damaged/broken/not working", false: "not described as defective" }
    };
    q.unopened = {
      type: "noul",
      instructions: "For the item the customer wants to return: does the customer state it is unopened, sealed, never opened, still in box?",
      criteria: { true: "states unopened/sealed/never opened", false: "does not state unopened (opened, used, or no mention)" }
    };
  }
  return q;
}

function toDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? "");
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000;
}

function isGift(item) {
  const c = String(item.category ?? "").toLowerCase();
  const n = String(item.name ?? "").toLowerCase();
  return c.includes("gift") || n.includes("gift card") || n.includes("giftcard");
}

export function decide(answers, input) {
  const abstain = { eligible: "abstain" };
  const t = answers?.target;
  if (!t || t.type !== "choice" || typeof t.choice !== "string") return abstain;
  if (t.choice === "UNCLEAR" || t.choice === "MULTIPLE") return abstain;
  const items = input.order?.items ?? [];
  const item = items.find(i => i.sku === t.choice);
  if (!item) return abstain;
  const probs = t.probabilities ?? {};
  const pTop = probs[t.choice] ?? t.confidence;
  if (typeof t.confidence === "number" && t.confidence < 0.6) return abstain;
  if (typeof pTop === "number" && pTop < 0.6) return abstain;
  for (const k in probs) {
    if (k !== t.choice && probs[k] > 0.35) return abstain;
  }
  if (item.final_sale === true || isGift(item)) return { eligible: "no" };
  const days = toDay(input.request?.date) - toDay(item.delivered_date) + 1;
  if (!Number.isFinite(days) || days < 1) return abstain;
  const isElec = String(item.category ?? "").toLowerCase().includes("electronic");
  if (!isElec) return { eligible: days <= 30 ? "yes" : "no" };
  if (days > 30) return { eligible: "no" };
  const pDef = answers?.defective?.noul;
  const pUn = answers?.unopened?.noul;
  if (typeof pDef !== "number" || typeof pUn !== "number") return abstain;
  const isDef = pDef >= 0.7;
  const isNotDef = pDef <= 0.3;
  const isUn = pUn >= 0.7;
  const isOpened = pUn <= 0.3;
  if (isDef) return { eligible: "yes" };
  if (isNotDef) {
    if (days > 15) return { eligible: "no" };
    if (isUn) return { eligible: "yes" };
    if (isOpened) return { eligible: "no" };
    return abstain;
  }
  if (days > 15) return abstain;
  if (isUn) return { eligible: "yes" };
  return abstain;
}
