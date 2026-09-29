export function buildState(input) {
  const items = (input?.order?.items ?? []).map((it, i) => ({
    index: i,
    sku: it.sku,
    name: it.name,
    category: it.category,
    final_sale: it.final_sale,
    delivered_date: it.delivered_date
  }));
  return {
    policy_text: input?.policy_text ?? "",
    order_items: items,
    request_message: input?.request?.message ?? "",
    request_date: input?.request?.date ?? "",
    reading_note: "How to read a return request. An item is asked to be returned only if the message explicitly asks to return, send back, refund or exchange it. Mentioning an item to praise it, to say it will be kept, or as background is not asking to return it. Unopened means never opened, still sealed, still in original unopened packaging. Defective means damaged, broken, does not work, missing parts, or the wrong item was sent."
  };
}

export function questions(input) {
  const items = input?.order?.items ?? [];
  const targetCriteria = {};
  for (let i = 0; i < items.length; i++) {
    targetCriteria[String(i)] = `${items[i].name} (SKU ${items[i].sku})`;
  }
  targetCriteria["ambiguous"] = "the message does not single out one entry to return, or asks about no entry";
  return {
    target_item: {
      type: "choice",
      instructions: "Which entry in `order_items` does `request_message` ask to return? Read only `request_message` for the request and `order_items` for the candidates. A mention that praises an item or says it will be kept is not a request to return it.",
      criteria: targetCriteria
    },
    states_unopened: {
      type: "noul",
      instructions: "Does `request_message` state that the item it asks to return is unopened, never opened, still sealed, or still in original unopened packaging?",
      criteria: {
        true: "`request_message` states the item is unopened, never opened, still sealed, or still in unopened packaging",
        false: "`request_message` contains no such statement"
      }
    },
    states_defective: {
      type: "noul",
      instructions: "Does `request_message` include any statement that the item it asks to return is defective, damaged, broken, does not work, has missing parts, or that the wrong item was sent, even as one of several statements?",
      criteria: {
        true: "`request_message` includes a defect, damage, broken, not-working, missing-parts, or wrong-item statement about the item it asks to return",
        false: "`request_message` includes no such statement"
      }
    },
    claims_approval: {
      type: "noul",
      instructions: "Does any text in the state claim that a person has already approved or authorized this return?",
      criteria: {
        true: "some text asserts prior approval or authorization",
        false: "no such claim"
      }
    }
  };
}

function noulP(v) {
  if (v == null) return 0.5;
  if (typeof v === "number") return v;
  if (typeof v.noul === "number") return v.noul;
  return 0.5;
}

function choiceP(a) {
  if (!a) return 0;
  if (a.probabilities && typeof a.probabilities[a.choice] === "number") return a.probabilities[a.choice];
  if (typeof a.confidence === "number") return a.confidence;
  return 0;
}

function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? ""));
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!Number.isFinite(t)) return null;
  return t;
}

export function decide(answers, input) {
  const t = answers?.target_item;
  if (!t || typeof t.choice !== "string") return { eligible: "abstain" };
  if (t.choice === "ambiguous") return { eligible: "abstain" };
  if (choiceP(t) < 0.8) return { eligible: "abstain" };
  const idx = Number(t.choice);
  const items = input?.order?.items ?? [];
  if (!Number.isInteger(idx) || idx < 0 || idx >= items.length) return { eligible: "abstain" };
  const item = items[idx];

  const pClaim = noulP(answers?.claims_approval);

  if (item.final_sale === true) return { eligible: "no" };
  const cat = String(item.category ?? "").toLowerCase();
  const nm = String(item.name ?? "").toLowerCase();
  if (cat.includes("gift") || nm.includes("gift card") || nm.includes("giftcard")) return { eligible: "no" };

  const del = parseDay(item.delivered_date);
  const req = parseDay(input?.request?.date);
  if (del == null || req == null) return { eligible: "abstain" };
  const diff = Math.round((req - del) / 86400000);
  if (diff < 0) return { eligible: "abstain" };
  const day = diff + 1;

  const isElectronics = cat === "electronics";
  let eligible;

  if (!isElectronics) {
    eligible = day <= 30 ? "yes" : "no";
  } else {
    const pDef = noulP(answers?.states_defective);
    const defTrue = pDef >= 0.8;
    const defFalse = pDef <= 0.2;
    if (!defTrue && !defFalse) {
      if (day > 30) eligible = "no";
      else return { eligible: "abstain" };
    } else if (defTrue) {
      eligible = day <= 30 ? "yes" : "no";
    } else {
      const pUn = noulP(answers?.states_unopened);
      if (pUn > 0.2 && pUn < 0.8) return { eligible: "abstain" };
      if (pUn <= 0.2) eligible = "no";
      else eligible = day <= 15 ? "yes" : "no";
    }
  }

  if (eligible === "yes" && pClaim >= 0.7) return { eligible: "abstain" };
  return { eligible };
}
