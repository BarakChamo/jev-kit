export function buildState(input) {
  return { policy: input.policy_text, log: input.ticket_log };
}

export function questions(input) {
  const log = String(input?.ticket_log ?? "");
  const lines = log.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const q = {
    priority: {
      type: "choice",
      instructions: "From state.log, what priority did the ticket have WHEN OPENED? Use only the opening event. If missing or ambiguous choose unclear.",
      criteria: {
        urgent: "ticket opened with priority Urgent",
        high: "ticket opened with priority High",
        normal: "ticket opened with priority Normal",
        low: "ticket opened with priority Low",
        unclear: "priority at opening is missing, ambiguous, or cannot be determined"
      }
    }
  };
  lines.forEach((ln, i) => {
    q["r" + i] = {
      type: "noul",
      instructions: `Decide about one log line. Line ${i + 1}/${lines.length}: "${ln.slice(0, 400)}". Full log: "${log.slice(0, 1500)}". Is this line itself a reply from a human support agent that counts as first response? Opening events, customer messages and automatic/system acknowledgements do NOT count.`,
      criteria: {
        true: "human support-agent reply, counts as first response",
        false: "opening event, customer message, automatic acknowledgement/system note, or anything else"
      }
    };
  });
  return q;
}

function toMs(line) {
  const m = String(line).match(/(\d{4})-(\d{2})-(\d{2})\D+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], se = m[6] ? +m[6] : 0;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null;
  return Date.UTC(y, mo - 1, d, h, mi, se);
}

function bizBetween(a, b, hols, s, e) {
  if (b <= a) return 0;
  let tot = 0;
  const ad = new Date(a);
  let cur = Date.UTC(ad.getUTCFullYear(), ad.getUTCMonth(), ad.getUTCDate());
  while (cur <= b) {
    const cd = new Date(cur);
    const dow = cd.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const ds = cd.getUTCFullYear() + "-" + String(cd.getUTCMonth() + 1).padStart(2, "0") + "-" + String(cd.getUTCDate()).padStart(2, "0");
      if (!hols.has(ds)) {
        const bs = cur + s * 60000, be = cur + e * 60000;
        tot += Math.max(0, Math.min(b, be) - Math.max(a, bs));
      }
    }
    cur += 86400000;
  }
  return tot / 60000;
}

export function decide(answers, input) {
  try {
    const log = String(input?.ticket_log ?? "");
    const policy = String(input?.policy_text ?? "");
    const lines = log.split(/\n+/).map(s => s.trim()).filter(Boolean);
    if (!lines.length) return { breached: "abstain" };
    const times = lines.map(toMs);
    let openIdx = lines.findIndex(l => /opened|created/i.test(l));
    if (openIdx < 0 || times[openIdx] == null) openIdx = times.findIndex(t => t != null);
    if (openIdx < 0) return { breached: "abstain" };
    const open = times[openIdx];
    if (open == null) return { breached: "abstain" };
    const pa = answers?.priority;
    if (!pa || typeof pa.choice !== "string") return { breached: "abstain" };
    const pri = pa.choice.toLowerCase();
    if (!["urgent", "high", "normal", "low"].includes(pri)) return { breached: "abstain" };
    let conf = typeof pa.confidence === "number" ? pa.confidence : 0;
    if (pa.probabilities) {
      const v = Object.values(pa.probabilities);
      if (v.length) conf = Math.max(conf, Math.max(...v));
    }
    const om = (lines[openIdx] || "").match(/\b(urgent|high|normal|low)\b/i);
    if (om && om[1].toLowerCase() !== pri) return { breached: "abstain" };
    if (conf < 0.6) {
      const all = (lines[openIdx] || "").match(/\b(urgent|high|normal|low)\b/gi) || [];
      const uniq = [...new Set(all.map(s => s.toLowerCase()))];
      if (uniq.length !== 1 || uniq[0] !== pri) return { breached: "abstain" };
    }
    const hols = new Set([...policy.matchAll(/(\d{4}-\d{2}-\d{2})/g)].map(m => m[1]));
    let s = 540, e = 1020;
    const hm = policy.match(/(\d{1,2}):(\d{2})\s*(?:to|-|–|—)\s*(\d{1,2}):(\d{2})/);
    if (hm) { s = (+hm[1]) * 60 + (+hm[2]); e = (+hm[3]) * 60 + (+hm[4]); }
    const limit = pri === "urgent" ? 60 : pri === "high" ? 240 : 960;
    const isBiz = pri !== "urgent";
    let first = null;
    for (let i = 0; i < lines.length; i++) {
      if (i === openIdx) continue;
      const a = answers?.["r" + i];
      if (!a || typeof a.noul !== "number") return { breached: "abstain" };
      if (a.noul > 0.7) {
        const t = times[i];
        if (t == null || t < open) return { breached: "abstain" };
        if (first == null || t < first) first = t;
      }
    }
    for (let i = 0; i < lines.length; i++) {
      if (i === openIdx) continue;
      const p = answers["r" + i].noul;
      if (p >= 0.3 && p <= 0.7) {
        const t = times[i];
        if (t == null || t < open) continue;
        if (first == null || t <= first) return { breached: "abstain" };
      }
    }
    const elapsed = (a, b) => isBiz ? bizBetween(a, b, hols, s, e) : (b - a) / 60000;
    if (first != null) {
      const el = elapsed(open, first);
      if (el < -1e-9) return { breached: "abstain" };
      return { breached: el <= limit + 1e-9 ? "no" : "yes" };
    }
    let last = null;
    for (const t of times) if (t != null && (last == null || t > last)) last = t;
    if (last == null || last < open) return { breached: "abstain" };
    if (elapsed(open, last) > limit + 1e-9) return { breached: "yes" };
    return { breached: "abstain" };
  } catch {
    return { breached: "abstain" };
  }
}
