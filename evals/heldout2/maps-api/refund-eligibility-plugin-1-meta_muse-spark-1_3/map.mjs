export function buildState(input) {
  const items = (input?.order?.items ?? []).map((it) => ({
    sku: it.sku,
    name: it.name,
    category: it.category,
    final_sale: it.final_sale,
    delivered_date: it.delivered_date,
  }));
  return {
    policy_text: input?.policy_text ?? "",
    order_items: items,
    request_message: input?.request?.message ?? "",
    request_date: input?.request?.date ?? "",
    convention: "Domain convention for this store. An item is electronics when its category is electronics. Defective means the item itself is faulty, damaged, broken, does not work, or the wrong item arrived; mere dislike or change of mind is not defective. Unopened means still sealed, in original packaging, never opened or used. A gift card is a stored-value card, not physical goods. Final sale means the order flags the item as final_sale true.",
  };
}

export function questions(input) {
  const items = input?.order?.items ?? [];
  const targetCriteria = {};
  for (const it of items) {
    targetCriteria[String(it.sku)] = `the item named ${JSON.stringify(it.name)} (sku ${it.sku})`;
  }
  targetCriteria["ambiguous"] = "the state genuinely supports more than one item or no item; a person should decide";
  const q = {
    target_item: {
      type: "choice",
      instructions: "Which single item in `order_items` does `request_message` ask to return?",
      criteria: targetCriteria,
    },
  };
  items.forEach((it, i) => {
    q[`defective_${i}`] = {
      type: "noul",
      instructions: `Does ` + "`request_message`" + ` state that the item named in ` + "`order_items`" + ` with sku ${JSON.stringify(String(it.sku))} (${JSON.stringify(it.name ?? "")}) is defective, damaged, broken, does not work, or arrived wrong?`,
      criteria: {
        true: "some text asserts that this specific item is faulty, damaged, broken, not working, or wrong",
        false: "no such assertion about this specific item",
      },
    };
    q[`unopened_${i}`] = {
      type: "noul",
      instructions: `Does ` + "`request_message`" + ` state that the item named in ` + "`order_items`" + ` with sku ${JSON.stringify(String(it.sku))} (${JSON.stringify(it.name ?? "")}) is unopened, still sealed, in original packaging, or never opened or used?`,
      criteria: {
        true: "some text asserts that this specific item is unopened, sealed, or never opened or used",
        false: "no such assertion about this specific item",
      },
    };
  });
  return q;
}

function parseDay(s) {
  if (typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  return t;
}

function flag(noul) {
  if (typeof noul !== "number" || Number.isNaN(noul)) return "uncertain";
  if (noul >= 0.7) return true;
  if (noul <= 0.3) return false;
  return "uncertain";
}

function isGiftCard(item) {
  const c = String(item?.category ?? "").toLowerCase();
  const n = String(item?.name ?? "").toLowerCase();
  return c.includes("gift") || n.includes("gift card") || n === "giftcard";
}

export function decide(answers, input) {
  try {
    const items = input?.order?.items ?? [];
    if (!items.length) return { eligible: "abstain" };
    const t = answers?.target_item;
    if (!t || typeof t.choice !== "string") return { eligible: "abstain" };
    if (t.choice === "ambiguous") return { eligible: "abstain" };
    const idx = items.findIndex((it) => String(it.sku) === t.choice);
    if (idx < 0) return { eligible: "abstain" };
    const p = t.probabilities?.[t.choice];
    if (typeof p !== "number" || p < 0.8) return { eligible: "abstain" };

    const item = items[idx];
    const del = parseDay(item?.delivered_date);
    const req = parseDay(input?.request?.date);
    if (del === null || req === null) return { eligible: "abstain" };
    const days = Math.round((req - del) / 86400000) + 1;
    if (!Number.isFinite(days) || days < 1) return { eligible: "abstain" };

    if (item?.final_sale === true) return { eligible: "no" };
    if (isGiftCard(item)) return { eligible: "no" };

    const isElectronics = String(item?.category ?? "").toLowerCase() === "electronics";
    if (!isElectronics) {
      return { eligible: days <= 30 ? "yes" : "no" };
    }

    const def = flag(answers?.[`defective_${idx}`]?.noul);
    if (def === "uncertain") return { eligible: "abstain" };
    if (def === true) {
      return { eligible: days <= 30 ? "yes" : "no" };
    }
    const un = flag(answers?.[`unopened_${idx}`]?.noul);
    if (un === "uncertain") return { eligible: "abstain" };
    if (un === true && days <= 15) return { eligible: "yes" };
    return { eligible: "no" };
  } catch {
    return { eligible: "abstain" };
  }
}
