// map.mjs — first-response SLA breach check built on Jev (TypeSafe System One).
//
// Strategy: Jev reads the policy and log to extract structured facts (priority
// at open, which log lines are the open event and the first qualifying agent
// reply, SLA target and clock type per priority, business-hours window, and a
// per-date business-day flag covering weekends + holidays). The elapsed time
// is then computed deterministically in JS. Jev's direct breach verdict is
// used only as a cross-check; anything ambiguous is abstained to a human.

const MAX_LINES = 254; // choice options cap at 255 (lines + "none")
const MAX_DAYS = 62;   // cap on per-date business-day questions
const CONF = 0.6;      // minimum choice confidence we trust
const UNSURE_LO = 0.4, UNSURE_HI = 0.6; // noul band treated as "unsure"

const DAY_MS = 86400000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const PRIORITIES = ["urgent", "high", "normal", "low"];
const TARGET_HOURS = ["0.5", "1", "2", "3", "4", "6", "8", "12", "16", "24", "40", "48", "80"];

function splitLines(log) {
  return String(log ?? "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

function parseLineTime(line) {
  const m = String(line).match(/(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const dayMs = Date.UTC(+y, +mo - 1, +d);
  const minutes = +h * 60 + +mi;
  return { date: `${y}-${mo}-${d}`, dayMs, minutes, abs: dayMs + minutes * 60000 };
}

function isoDate(dayMs) {
  return new Date(dayMs).toISOString().slice(0, 10);
}

function toMinutes(hhmm) {
  const m = String(hhmm).match(/^(\d{2}):(\d{2})$/);
  return m ? (+m[1]) * 60 + (+m[2]) : NaN;
}

export function buildState(input) {
  const lines = splitLines(input?.ticket_log);
  return {
    task: "Decide whether the ticket's first-response SLA was breached under the written policy.",
    policy_text: String(input?.policy_text ?? ""),
    ticket_log: String(input?.ticket_log ?? ""),
    numbered_lines: lines.slice(0, MAX_LINES).map((l, i) => `${i}: ${l}`),
  };
}

export function questions(input) {
  const lines = splitLines(input?.ticket_log);
  const q = {};

  const lineOpts = {};
  lines.slice(0, MAX_LINES).forEach((l, i) => {
    lineOpts[String(i)] = `Line ${i}: ${l.slice(0, 200)}`;
  });
  lineOpts.none = "No numbered line matches.";

  q.open_line = {
    type: "choice",
    instructions: "In the numbered ticket log (see state), which line records the ticket being opened/created? Its timestamp starts the SLA clock.",
    criteria: lineOpts,
  };
  q.reply_line = {
    type: "choice",
    instructions: "In the numbered ticket log, which line is the FIRST reply from a human support agent? Only a support agent's reply counts as a first response; customer messages and automated acknowledgements do not. Choose 'none' if the log contains no qualifying agent reply.",
    criteria: lineOpts,
  };
  q.priority = {
    type: "choice",
    instructions: "What priority did the ticket have at the moment it was opened, according to the log? The priority at open applies even if it is changed later. Pick the closest tier; use 'other' only if none fits or it is never stated.",
    criteria: {
      urgent: "Urgent / critical top priority.",
      high: "High priority.",
      normal: "Normal / medium priority.",
      low: "Low priority.",
      other: "Some other priority, or the priority at open is not stated.",
    },
  };

  const targetCriteria = {};
  for (const t of TARGET_HOURS) targetCriteria[t] = `${t} hours`;
  targetCriteria.other = "A different target, or the policy defines none for this priority.";

  for (const p of PRIORITIES) {
    q[`sched_${p}`] = {
      type: "choice",
      instructions: `Under the policy, for a ticket opened at ${p} priority, does the first-response SLA clock run around the clock (calendar time, all days and hours) or only during business hours?`,
      criteria: {
        around_the_clock: "The clock runs continuously, every day, all hours.",
        business_hours: "Only business hours count (per the policy's business days, hours and holidays).",
      },
    };
    q[`target_${p}`] = {
      type: "choice",
      instructions: `Under the policy, what is the first-response target for a ticket opened at ${p} priority, expressed in hours? Convert when needed: e.g. '2 business days' with 8-hour business days is 16 hours; '1 business day' is the length of one business day in hours.`,
      criteria: targetCriteria,
    };
  }

  const startOpts = {}, endOpts = {};
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, "0");
    for (const t of [`${hh}:00`, `${hh}:30`]) {
      startOpts[t] = `Business hours start at ${t}.`;
      endOpts[t] = `Business hours end at ${t}.`;
    }
  }
  q.biz_start = { type: "choice", instructions: "According to the policy, at what time of day do business hours start?", criteria: startOpts };
  q.biz_end = { type: "choice", instructions: "According to the policy, at what time of day do business hours end?", criteria: endOpts };

  q.tz_match = {
    type: "noul",
    instructions: "Can the ticket-log timestamps be compared directly with the policy's business hours — i.e. they are in the same timezone, or no conflicting timezones are indicated anywhere?",
    criteria: {
      true: "Same timezone (or none indicated), so times compare directly.",
      false: "The log and the policy use different or conflicting timezones.",
    },
  };

  q.breach = {
    type: "noul",
    instructions: "Apply the policy end to end: priority at open, the correct clock (around-the-clock vs business hours), business days, public holidays, and the rule that only a human support agent's reply counts as a first response. Was the first-response SLA breached for this ticket?",
    criteria: {
      true: "Breached — the allowed time elapsed with no qualifying agent reply.",
      false: "Not breached — a qualifying agent reply arrived within the allowed time, or the allowed time had not yet elapsed by the end of the log.",
    },
  };

  const times = lines.map(parseLineTime).filter(Boolean);
  if (times.length) {
    const minDay = Math.min(...times.map(t => t.dayMs));
    const maxDay = Math.max(...times.map(t => t.dayMs));
    for (let day = minDay, i = 0; day <= maxDay && i < MAX_DAYS; day += DAY_MS, i++) {
      const ds = isoDate(day);
      q[`d_${ds}`] = {
        type: "noul",
        instructions: `Under the SLA policy, is ${WEEKDAYS[new Date(day).getUTCDay()]} ${ds} a business day — a day on which business hours run? Apply both the policy's weekly business days and its list of excluded public holidays.`,
        criteria: {
          true: "A business day: on the policy's weekly business days and not a listed public holiday.",
          false: "Not a business day: outside the weekly business days, or a listed public holiday.",
        },
      };
    }
  }

  return q;
}

const ABSTAIN = { breached: "abstain" };

function confidentChoice(a) {
  return a && a.type === "choice" && typeof a.choice === "string" && (a.confidence ?? 0) >= CONF
    ? a.choice
    : null;
}

export function decide(answers, input) {
  try {
    const lines = splitLines(input?.ticket_log);
    if (lines.length > MAX_LINES) return ABSTAIN;
    const times = lines.map(parseLineTime);
    const get = id => answers?.[id];

    // Timezone sanity gate.
    const tz = get("tz_match");
    if (!tz || tz.type !== "noul" || typeof tz.noul !== "number" || tz.noul < UNSURE_HI) return ABSTAIN;

    // Priority at open and its SLA terms.
    const prio = confidentChoice(get("priority"));
    if (!prio || prio === "other") return ABSTAIN;
    const sched = confidentChoice(get(`sched_${prio}`));
    const targetStr = confidentChoice(get(`target_${prio}`));
    if (!sched || !targetStr || targetStr === "other") return ABSTAIN;
    const targetMin = Math.round(parseFloat(targetStr) * 60);
    if (!Number.isFinite(targetMin) || targetMin <= 0) return ABSTAIN;

    // Open event.
    const openIdx = confidentChoice(get("open_line"));
    if (openIdx === null || openIdx === "none") return ABSTAIN;
    const openT = times[+openIdx];
    if (!openT) return ABSTAIN;

    // First qualifying agent reply; if none, measure to the end of the log.
    const replyChoice = confidentChoice(get("reply_line"));
    let endT;
    if (replyChoice && replyChoice !== "none") {
      endT = times[+replyChoice];
      if (!endT) return ABSTAIN;
    } else if (replyChoice === "none") {
      const all = times.filter(Boolean);
      if (!all.length) return ABSTAIN;
      endT = all.reduce((a, b) => (b.abs > a.abs ? b : a));
    } else {
      return ABSTAIN;
    }
    if (endT.abs < openT.abs) return ABSTAIN;

    // Elapsed minutes on the applicable clock.
    let elapsedMin;
    if (sched === "around_the_clock") {
      elapsedMin = Math.round((endT.abs - openT.abs) / 60000);
    } else if (sched === "business_hours") {
      const sMin = toMinutes(confidentChoice(get("biz_start")));
      const eMin = toMinutes(confidentChoice(get("biz_end")));
      if (!Number.isFinite(sMin) || !Number.isFinite(eMin) || eMin <= sMin) return ABSTAIN;
      elapsedMin = 0;
      for (let day = openT.dayMs; day <= endT.dayMs; day += DAY_MS) {
        const a = get(`d_${isoDate(day)}`);
        if (!a || a.type !== "noul" || typeof a.noul !== "number") return ABSTAIN;
        if (a.noul > UNSURE_LO && a.noul < UNSURE_HI) return ABSTAIN;
        if (a.noul < 0.5) continue; // weekend / holiday
        const lo = day === openT.dayMs ? Math.max(openT.minutes, sMin) : sMin;
        const hi = day === endT.dayMs ? Math.min(endT.minutes, eMin) : eMin;
        if (hi > lo) elapsedMin += hi - lo;
      }
    } else {
      return ABSTAIN;
    }

    const breached = elapsedMin > targetMin;

    // Cross-check against Jev's direct verdict: defer to a human if Jev is
    // unsure or confidently disagrees with the deterministic computation.
    const v = get("breach");
    if (!v || v.type !== "noul" || typeof v.noul !== "number") return ABSTAIN;
    if (v.noul > UNSURE_LO && v.noul < UNSURE_HI) return ABSTAIN;
    if ((v.noul >= 0.5) !== breached && (v.noul >= 0.65 || v.noul <= 0.35)) return ABSTAIN;

    return { breached: breached ? "yes" : "no" };
  } catch {
    return ABSTAIN;
  }
}
