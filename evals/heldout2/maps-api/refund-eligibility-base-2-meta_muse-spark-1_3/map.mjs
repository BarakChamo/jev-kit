export function buildState(input) {
  const items = input?.order?.items ?? [];
  return {
    msg: input?.request?.message ?? "",
    items: items.map((it) => ({ sku: it.sku, name: it.name }))
  };
}

export function questions(input) {
  const items = input?.order?.items ?? [];
  const qs = {};
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    qs["i" + i] = {
      type: "choice",
      instructions: `Classify "${it.name}" (${it.sku}) from msg in state.`,
      criteria: {
        ret_defective: "ask return this item + say defective/damaged/broken/not working/wrong item",
        ret_unopened: "ask return this item + say unopened/sealed/never opened/unused in box",
        ret_other: "ask return this item, no defect/unopened claim (or opened/used)",
        keep: "do NOT ask return this item (keeping it or about another item)",
        unclear: "cannot tell if wants to return this item"
      }
    };
  }
  return qs;
}

function isRet(c) {
  return c === "ret_defective" || c === "ret_unopened" || c === "ret_other";
}

export function decide(answers, input) {
  const items = input?.order?.items ?? [];
  if (!items.length) return { eligible: "abstain" };
  const parsed = [];
  for (let i = 0; i < items.length; i++) {
    const a = answers?.["i" + i];
    if (!a || typeof a.choice !== "string") return { eligible: "abstain" };
    const conf = typeof a.confidence === "number" ? a.confidence : 0;
    const probs = a.probabilities || {};
    const top = typeof probs[a.choice] === "number" ? probs[a.choice] : conf;
    parsed.push({ choice: a.choice, conf, top, probs });
  }
  const reqIdx = [];
  for (let i = 0; i < parsed.length; i++) if (isRet(parsed[i].choice)) reqIdx.push(i);
  if (reqIdx.length !== 1) return { eligible: "abstain" };
  const t = parsed[reqIdx[0]];
  if (t.conf < 0.6 || t.top < 0.6) return { eligible: "abstain" };
  for (let i = 0; i < parsed.length; i++) {
    if (i === reqIdx[0]) continue;
    const p = parsed[i];
    if (p.choice !== "keep") return { eligible: "abstain" };
    if (p.conf < 0.55 || p.top < 0.55) return { eligible: "abstain" };
    const retP = (p.probs["ret_defective"] || 0) + (p.probs["ret_unopened"] || 0) + (p.probs["ret_other"] || 0);
    if (retP > 0.3) return { eligible: "abstain" };
  }
  const it = items[reqIdx[0]];
  if (it.final_sale === true) return { eligible: "no" };
  const cat = String(it.category || "").toLowerCase();
  const nm = String(it.name || "").toLowerCase();
  if (cat.includes("gift") || nm.includes("gift card")) return { eligible: "no" };
  const del = Date.parse(String(it.delivered_date || ""));
  const req = Date.parse(String(input?.request?.date || ""));
  if (Number.isNaN(del) || Number.isNaN(req)) return { eligible: "abstain" };
  const days = Math.round((req - del) / 86400000) + 1;
  if (!Number.isFinite(days) || days < 1) return { eligible: "abstain" };
  const isElec = cat.includes("electronic");
  if (isElec) {
    if (t.choice === "ret_defective") return { eligible: days <= 30 ? "yes" : "no" };
    if (t.choice === "ret_unopened") return { eligible: days <= 15 ? "yes" : "no" };
    return { eligible: "no" };
  }
  return { eligible: days <= 30 ? "yes" : "no" };
}
