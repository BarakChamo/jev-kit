function parseEvents(log) {
  const lines = String(log ?? "").split(/\n/);
  const evs = [];
  let idx = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let t = null;
    const m = line.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s*UTC/i);
    if (m) t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    evs.push({ i: idx++, t, iso: t == null ? null : new Date(t).toISOString(), text: line.slice(0, 300) });
  }
  return evs;
}
function bizMs(a, b, hols) {
  if (!(b > a)) return 0;
  let tot = 0;
  const da = new Date(a), db = new Date(b);
  let cur = Date.UTC(da.getUTCFullYear(), da.getUTCMonth(), da.getUTCDate());
  const end = Date.UTC(db.getUTCFullYear(), db.getUTCMonth(), db.getUTCDate());
  while (cur <= end) {
    const d = new Date(cur), w = d.getUTCDay();
    const iso = d.toISOString().slice(0, 10);
    if (w !== 0 && w !== 6 && !hols.has(iso)) {
      const s = cur + 9 * 360e4, e = cur + 17 * 360e4;
      const oS = Math.max(a, s), oE = Math.min(b, e);
      if (oE > oS) tot += oE - oS;
    }
    cur += 864e5;
  }
  return tot;
}
export function buildState(input) {
  const evs = parseEvents(input.ticket_log);
  return {
    policy: input.policy_text,
    log: input.ticket_log,
    events: evs.map(e => ({ i: e.i, t: e.iso, text: e.text }))
  };
}
export function questions(input) {
  let evs = parseEvents(input.ticket_log);
  if (evs.length > 254) evs = evs.slice(0, 254);
  const oc = {}, rc = {};
  for (const e of evs) {
    const d = (`[${e.iso || "no-time"}] ${e.text}`).slice(0, 220);
    oc[String(e.i)] = d;
    rc[String(e.i)] = d;
  }
  oc.none = "No line clearly shows ticket creation/opening.";
  rc.none = "No human agent reply; only customer / auto-ack / system / bot, or nothing.";
  return {
    priority: {
      type: "choice",
      instructions: "What priority did the ticket have WHEN OPENED? Use only the ticket-opening line. Ignore later priority changes.",
      criteria: {
        Urgent: "Opened as Urgent",
        High: "Opened as High",
        Normal: "Opened as Normal",
        Low: "Opened as Low"
      }
    },
    open: {
      type: "choice",
      instructions: "Which entry is the ticket opening/creation event? Choose the line where the ticket was opened/created.",
      criteria: oc
    },
    first_response: {
      type: "choice",
      instructions: "Which entry is the FIRST human support-agent reply counting as first response? Exclude customer messages and automatic acknowledgements/auto-replies/system/bot messages. Only a human agent reply counts. Choose the earliest qualifying reply, else none.",
      criteria: rc
    }
  };
}
export function decide(answers, input) {
  try {
    const p = answers?.priority, o = answers?.open, r = answers?.first_response;
    if (!p || !o || !r) return { breached: "abstain" };
    if (p.choice == null || o.choice == null || r.choice == null) return { breached: "abstain" };
    if (typeof p.confidence === "number" && p.confidence < 0.6) return { breached: "abstain" };
    if (typeof o.confidence === "number" && o.confidence < 0.6) return { breached: "abstain" };
    if (typeof r.confidence === "number" && r.confidence < 0.6) return { breached: "abstain" };
    const prio = String(p.choice);
    if (!["Urgent", "High", "Normal", "Low"].includes(prio)) return { breached: "abstain" };
    if (String(o.choice) === "none") return { breached: "abstain" };
    const evs = parseEvents(input.ticket_log);
    const byId = new Map(evs.map(e => [String(e.i), e.t]));
    const openT = byId.get(String(o.choice));
    if (openT == null) return { breached: "abstain" };
    const hols = new Set(String(input.policy_text || "").match(/\d{4}-\d{2}-\d{2}/g) || []);
    const target = prio === "Urgent" ? 36e5 : prio === "High" ? 4 * 36e5 : 16 * 36e5;
    const elapsed = (end) => prio === "Urgent" ? end - openT : bizMs(openT, end, hols);
    if (String(r.choice) === "none") {
      let last = null;
      for (const e of evs) if (e.t != null && e.t > openT && (last == null || e.t > last)) last = e.t;
      if (last == null) return { breached: "abstain" };
      if (elapsed(last) > target) return { breached: "yes" };
      return { breached: "abstain" };
    }
    const respT = byId.get(String(r.choice));
    if (respT == null) return { breached: "abstain" };
    if (respT < openT) return { breached: "abstain" };
    if (String(r.choice) === String(o.choice)) return { breached: "abstain" };
    return { breached: elapsed(respT) > target ? "yes" : "no" };
  } catch {
    return { breached: "abstain" };
  }
}
