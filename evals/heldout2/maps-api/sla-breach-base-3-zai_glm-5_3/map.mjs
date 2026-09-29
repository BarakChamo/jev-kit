// map.mjs — first-response SLA breach check, built on Jev (TypeSafe System One).
// Jev answers the fuzzy, semantic facts (priority at opening, which log entry is
// the opening, which entry is the first agent reply, holiday/weekend config);
// the deadline arithmetic is done deterministically here.

export function buildState(input) {
  const events = parseEvents(input);
  return {
    policy_text: text(input, "policy_text"),
    ticket_log: text(input, "ticket_log"),
    log_events: events.map((e, i) => ({
      index: i,
      timestamp_utc: `${e.date} ${String(Math.floor(e.min / 60)).padStart(2, "0")}:${String(e.min % 60).padStart(2, "0")}`,
      entry: e.text,
    })),
  };
}

export function questions(input) {
  const events = parseEvents(input);
  const qs = {
    priority: {
      type: "choice",
      instructions:
        "Read the ticket log in the state. What priority did the ticket have at the moment it was opened? Later priority changes do NOT apply; only the priority stated at opening counts.",
      criteria: {
        urgent: "The priority stated when the ticket was opened was Urgent.",
        high: "The priority stated when the ticket was opened was High.",
        normal: "The priority stated when the ticket was opened was Normal.",
        low: "The priority stated when the ticket was opened was Low.",
        unknown: "The log does not state the ticket's priority at opening.",
      },
    },
    any_agent_reply: {
      type: "noul",
      instructions:
        "Does the ticket log contain any reply from a support agent (a human agent responding to the customer)? Customer messages and automatic acknowledgements do not count.",
      criteria: {
        true: "At least one log entry is a reply from a support agent.",
        false: "No log entry is a reply from a support agent (only customer messages, automatic acknowledgements, or other events).",
      },
    },
    biz_sat: {
      type: "noul",
      instructions: "According to the policy's business hours definition, is Saturday a business day?",
      criteria: {
        true: "The policy's business week includes Saturday.",
        false: "Saturday is not a business day under the policy.",
      },
    },
    biz_sun: {
      type: "noul",
      instructions: "According to the policy's business hours definition, is Sunday a business day?",
      criteria: {
        true: "The policy's business week includes Sunday.",
        false: "Sunday is not a business day under the policy.",
      },
    },
  };
  events.forEach((e, i) => {
    qs["open_" + i] = {
      type: "noul",
      instructions: `Log entry: "${e.text}"\nIs this entry the event where the ticket was opened/created (the initial event that started the ticket)?`,
      criteria: {
        true: "This entry is the ticket being opened or created.",
        false: "This entry is something else (a reply, note, status or priority change, etc.).",
      },
    };
    qs["reply_" + i] = {
      type: "noul",
      instructions: `Log entry: "${e.text}"\nIs this entry a reply from a support agent? It counts only if written by a human support agent responding to the customer. Customer messages and automatic acknowledgements/auto-replies do NOT count.`,
      criteria: {
        true: "This entry is a reply from a human support agent.",
        false: "This entry is a customer message, an automatic acknowledgement, or not a reply at all.",
      },
    };
  });
  for (const d of spanDates(events)) {
    qs["holiday_" + d] = {
      type: "noul",
      instructions: `Is ${d} explicitly listed as an excluded public holiday in the SLA policy text in the state?`,
      criteria: {
        true: `${d} appears in the policy's list of public holidays.`,
        false: `${d} is not listed as a public holiday in the policy.`,
      },
    };
  }
  return qs;
}

export function decide(answers, input) {
  const events = parseEvents(input);
  if (!events.length || !answers || typeof answers !== "object") return ABSTAIN();
  const policy = text(input, "policy_text");

  // 1) Priority at opening (Jev choice).
  const pa = answers.priority;
  const priority = pa?.type === "choice" ? String(pa.choice).toLowerCase() : null;
  if (!priority || priority === "unknown") return ABSTAIN();
  if ((pa.probabilities?.[priority] ?? pa.confidence ?? 0) < 0.5) return ABSTAIN();

  // 2) Target deadline from the written policy.
  const target = parseTarget(policy, priority);
  if (!target) return ABSTAIN();
  const win = parseWindow(policy);
  if (target.business && !win) return ABSTAIN();
  if (target.business && !spanDates(events).every((d) => answers["holiday_" + d] !== undefined)) return ABSTAIN();

  const dayMin = win ? win.end - win.start : 480;
  let targetMin;
  if (target.unit === "min") targetMin = target.n;
  else if (target.unit === "hour") targetMin = target.n * 60;
  else targetMin = target.business ? target.n * dayMin : target.n * 1440;

  const isBizDay = makeIsBizDay(answers);
  const elapsed = (a, b) => (target.business ? businessMinutes(a, b, win, isBizDay) : clockMinutes(a, b));

  // 3) Opening event (Jev noul per entry).
  let openIdx = -1;
  for (let i = 0; i < events.length; i++) {
    if ((answers["open_" + i]?.noul ?? 0) >= 0.5) { openIdx = i; break; }
  }
  if (openIdx < 0) {
    if ((answers.open_0?.noul ?? 0) >= 0.4) openIdx = 0;
    else return ABSTAIN();
  }

  // 4) First agent reply (earliest entry Jev marks as an agent reply).
  let replyIdx = -1, maxReply = 0;
  for (let i = 0; i < events.length; i++) {
    const v = answers["reply_" + i]?.noul ?? 0;
    if (v > maxReply) maxReply = v;
    if (replyIdx < 0 && v >= 0.5) replyIdx = i;
  }

  if (replyIdx >= 0) {
    return { breached: elapsed(events[openIdx], events[replyIdx]) > targetMin ? "yes" : "no" };
  }

  // No identifiable agent reply: if Jev says one exists but we can't pin it down, abstain.
  if ((answers.any_agent_reply?.noul ?? 0) >= 0.5 || maxReply >= 0.35) return ABSTAIN();

  // No first response in the log at all: breached only if the deadline had already
  // passed by the last log entry; otherwise we can't tell yet.
  if (events.length < 2 || openIdx === events.length - 1) return ABSTAIN();
  return elapsed(events[openIdx], events[events.length - 1]) > targetMin
    ? { breached: "yes" }
    : ABSTAIN();
}

// ---------- helpers ----------

function ABSTAIN() { return { breached: "abstain" }; }

function text(input, key) { return String((input && input[key]) ?? ""); }

function parseEvents(input) {
  const out = [];
  for (const line of text(input, "ticket_log").split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?/);
    if (m) out.push({ date: `${m[1]}-${m[2]}-${m[3]}`, min: +m[4] * 60 + +m[5], text: t });
  }
  return out;
}

function spanDates(events) {
  if (!events.length) return [];
  const ds = events.map((e) => e.date).sort();
  const out = [];
  const d = new Date(ds[0] + "T00:00:00Z");
  const end = new Date(ds[ds.length - 1] + "T00:00:00Z");
  for (let i = 0; i < 400 && d <= end; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function parseWindow(policy) {
  const m = policy.match(/(\d{1,2}):(\d{2})\s*(?:to|through|until|[-–—])\s*(\d{1,2}):(\d{2})/i);
  if (!m) return null;
  const start = +m[1] * 60 + +m[2], end = +m[3] * 60 + +m[4];
  return end > start ? { start, end } : null;
}

function parseTarget(policy, priority) {
  const name = new RegExp("\\b" + priority + "\\b", "i");
  const t = /within\s+(\d+(?:\.\d+)?)\s+(?:(clock)\s+)?(?:(business)\s+)?(minutes?|mins?|hours?|days?)/i;
  for (const line of policy.split(/\r?\n/)) {
    if (!name.test(line)) continue;
    const m = line.match(t);
    if (m) {
      const u = m[4].toLowerCase();
      return {
        n: +m[1],
        clock: !!m[2],
        business: !!m[3],
        unit: u.startsWith("min") ? "min" : u.startsWith("hour") ? "hour" : "day",
      };
    }
  }
  return null;
}

function clockMinutes(a, b) {
  return Math.round((Date.parse(b.date + "T00:00:00Z") - Date.parse(a.date + "T00:00:00Z")) / 60000) + (b.min - a.min);
}

function businessMinutes(a, b, win, isBizDay) {
  const days = Math.round((Date.parse(b.date + "T00:00:00Z") - Date.parse(a.date + "T00:00:00Z")) / 86400000);
  if (days > 380) return Infinity;
  if (days < 0) return 0;
  let total = 0;
  const d = new Date(a.date + "T00:00:00Z");
  for (let i = 0; i <= days; i++) {
    const ds = d.toISOString().slice(0, 10);
    if (isBizDay(ds)) {
      const s = ds === a.date ? Math.max(a.min, win.start) : win.start;
      const e = ds === b.date ? Math.min(b.min, win.end) : win.end;
      if (e > s) total += e - s;
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return total;
}

function makeIsBizDay(answers) {
  const holidays = new Set();
  for (const [k, v] of Object.entries(answers)) {
    if (k.startsWith("holiday_") && typeof v?.noul === "number" && v.noul >= 0.5) holidays.add(k.slice(8));
  }
  const sat = (answers.biz_sat?.noul ?? 0) >= 0.5;
  const sun = (answers.biz_sun?.noul ?? 0) >= 0.5;
  return (ds) => {
    const wd = new Date(ds + "T00:00:00Z").getUTCDay();
    if (wd === 6 && !sat) return false;
    if (wd === 0 && !sun) return false;
    return !holidays.has(ds);
  };
}
