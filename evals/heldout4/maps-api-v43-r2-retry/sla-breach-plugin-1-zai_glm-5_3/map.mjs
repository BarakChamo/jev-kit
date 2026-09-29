// map.mjs — first-response SLA breach check, built on Jev.
// Division of labour: Jev reads facts (which log line, which priority, the numbers the policy
// states); this code does every comparison and all date arithmetic, then applies the policy
// in order. Rule numbers refer to the jev-questions skill.

const PRIORITIES = ["urgent", "high", "normal", "low"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const AMOUNTS = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 48, 72];
const UNITS = ["clock_hours", "business_hours", "business_days"];
const MAX_LINES = 250; // a `choice` refuses above 255 options; above this we abstain rather than pre-filter (rule 16)

// Gates on the probability of the label we act on, not the `confidence` scalar (rule 13).
// These are placeholders — fit them per question with jev-audit on labelled cases.
const GATE = { choice: 0.75, line: 0.7, line_if_autoack: 0.85, noul_true: 0.7, noul_false: 0.3 };

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    ticket_log: input.ticket_log,
    convention:
      "All timestamps in `ticket_log` and the business hours in `policy_text` are UTC. " +
      "Business time is counted fractionally: a target of N business hours is met only if at most " +
      "N business hours elapse between the ticket being opened and the first reply from a support " +
      "agent. Only a reply written by a human support agent counts as a first response; customer " +
      "messages and automatic acknowledgements never do. The priority that applies is the one the " +
      "ticket had when it was opened, even if it is changed later.",
  };
}

const splitLines = (log) =>
  String(log ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

// Every date the policy states, as candidate holidays. No pre-filtering: Jev confirms each one.
const holidayCandidates = (policy) => [
  ...new Set(String(policy ?? "").match(/\d{4}-\d{2}-\d{2}/g) || []),
];

export function questions(input) {
  const lines = splitLines(input.ticket_log).slice(0, MAX_LINES);
  const lineOpts = Object.fromEntries(lines.map((t, i) => [String(i), t])); // every line, no filter
  const hourOpts = Object.fromEntries(
    Array.from({ length: 24 }, (_, h) => [String(h), `${String(h).padStart(2, "0")}:00`])
  );
  const amountOpts = Object.fromEntries(AMOUNTS.map((a) => [String(a), `the stated number is ${a}`]));
  const holidays = holidayCandidates(input.policy_text);

  const q = {
    open_line: {
      type: "choice",
      instructions:
        "Which line of `ticket_log` records the moment the ticket was opened by the customer? " +
        "The line must state the ticket being opened or created, together with its timestamp. " +
        "A reply, a status change or a priority change is not the opening. If no line records the " +
        "opening, choose none_found. If more than one line could equally be the opening, choose " +
        "no_single_clear_answer.",
      criteria: {
        ...lineOpts,
        none_found: "no line in `ticket_log` records the ticket being opened",
        no_single_clear_answer: "more than one line equally records the ticket being opened",
      },
    },
    first_reply_line: {
      type: "choice",
      instructions:
        "Which line of `ticket_log` records the FIRST reply from a support agent? Only a message " +
        "written by a human member of the support team counts as a first response. Customer " +
        "messages do not count, and automatic acknowledgements (system-generated confirmations " +
        "that the ticket was received) do not count. If no reply from a support agent appears, " +
        "choose none_found.",
      criteria: {
        ...lineOpts,
        none_found: "no reply from a support agent appears in `ticket_log`",
      },
    },
    priority_at_open: {
      type: "choice",
      instructions:
        "What priority does `ticket_log` state for this ticket at the moment it was opened? " +
        "Use only the priority stated at the opening; ignore any change of priority made later " +
        "in the log. If the opening states no priority, choose not_stated.",
      criteria: {
        urgent: "the opening states Urgent (or P1)",
        high: "the opening states High (or P2)",
        normal: "the opening states Normal (or P3)",
        low: "the opening states Low (or P4)",
        not_stated: "the opening states no priority",
      },
    },
    autoack_present: {
      type: "noul",
      instructions:
        "Does `ticket_log` contain an automatic or system-generated acknowledgement, such as a " +
        "confirmation that the ticket was received? Messages written by a human being do not count.",
      criteria: {
        true: "an automatic or system-generated acknowledgement appears in `ticket_log`",
        false: "no automatic or system-generated message appears in `ticket_log`",
      },
    },
    bh_start_hour: {
      type: "choice",
      instructions:
        "At which hour of the day do the business hours stated in `policy_text` begin? For " +
        "'09:00 to 17:00' the answer is 9. Answer with the hour number only. If `policy_text` " +
        "states no business hours, choose not_stated.",
      criteria: { ...hourOpts, not_stated: "`policy_text` states no business hours" },
    },
    bh_end_hour: {
      type: "choice",
      instructions:
        "At which hour of the day do the business hours stated in `policy_text` end? For " +
        "'09:00 to 17:00' the answer is 17: the hour at which business hours stop. Answer with " +
        "the hour number only. If `policy_text` states no business hours, choose not_stated.",
      criteria: { ...hourOpts, not_stated: "`policy_text` states no business hours" },
    },
    has_holidays: {
      type: "noul",
      instructions: "Does `policy_text` exclude any public holidays from business hours?",
      criteria: {
        true: "`policy_text` excludes one or more public holidays",
        false: "`policy_text` excludes no public holidays",
      },
    },
  };

  for (const d of DAY_NAMES) {
    q[`business_day_${d}`] = {
      type: "noul",
      instructions:
        `According to \`policy_text\`, is ${d} a business day, that is, a day on which business ` +
        `hours apply?`,
      criteria: {
        true: `business hours apply on ${d}`,
        false: `business hours do not apply on ${d}`,
      },
    };
  }

  for (const p of PRIORITIES) {
    q[`target_amount_${p}`] = {
      type: "choice",
      instructions:
        `In \`policy_text\`, how long is the first-response target for ${p.toUpperCase()} priority ` +
        `tickets? Give the stated number only (the count of hours or of days), or choose ` +
        `not_stated if \`policy_text\` sets no first-response target for ${p} priority.`,
      criteria: {
        ...amountOpts,
        not_stated: `no first-response target is stated for ${p} priority`,
      },
    };
    q[`target_unit_${p}`] = {
      type: "choice",
      instructions:
        `In \`policy_text\`, how is the first-response target for ${p.toUpperCase()} priority ` +
        `measured: in hours that count around the clock (all days, all hours), in business hours, ` +
        `or in business days? Choose not_stated if \`policy_text\` sets no first-response target ` +
        `for ${p} priority.`,
      criteria: {
        clock_hours: "hours that count around the clock, on all days and at all hours",
        business_hours: "business hours only",
        business_days: "business days",
        not_stated: `no first-response target is stated for ${p} priority`,
      },
    };
  }

  for (const h of holidays) {
    q[`holiday_${h}`] = {
      type: "noul",
      instructions:
        `Does \`policy_text\` list the date ${h} as a public holiday that is excluded from ` +
        `business hours?`,
      criteria: {
        true: `${h} is listed as an excluded public holiday`,
        false: `${h} is not listed as an excluded public holiday`,
      },
    };
  }

  return q;
}

// ---- decision code: every comparison and all arithmetic happen here (rules 8, 9, 12, 13) ----

function parseTimestamp(text) {
  const m = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(text ?? ""));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], se = m[6] ? +m[6] : 0;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null; // rejects e.g. 2026-02-30
  return dt;
}

function readNoul(a) {
  if (!a || a.type !== "noul" || typeof a.noul !== "number") return null;
  if (a.noul >= GATE.noul_true) return true;
  if (a.noul <= GATE.noul_false) return false;
  return null; // ambiguous — never let doubt relax a decision
}

function isHoliday(day, A) {
  const a = A[`holiday_${day.toISOString().slice(0, 10)}`];
  if (!a) return false; // not among the dates the policy states
  return readNoul(a);
}

function businessMsBetween(from, to, startH, endH, A) {
  let total = 0;
  for (let day = new Date(from); day.getTime() <= to.getTime(); day.setUTCDate(day.getUTCDate() + 1)) {
    day.setUTCHours(0, 0, 0, 0);
    const bizDay = readNoul(A[`business_day_${DAY_NAMES[day.getUTCDay()]}`]);
    if (bizDay === null) return null; // an unresolved fact inside the span -> a person decides
    if (!bizDay) continue;
    const hol = isHoliday(day, A);
    if (hol === null) return null;
    if (hol) continue;
    const ws = new Date(day); ws.setUTCHours(startH, 0, 0, 0);
    const we = new Date(day); we.setUTCHours(endH, 0, 0, 0);
    total += Math.max(0, Math.min(to.getTime(), we.getTime()) - Math.max(from.getTime(), ws.getTime()));
  }
  return total;
}

export function decide(answers, input) {
  const A = answers ?? {};
  const ABSTAIN = { breached: "abstain" };
  const lines = splitLines(input.ticket_log);
  if (lines.length > MAX_LINES) return ABSTAIN; // never decide on a truncated view

  const choice = (id) => {
    const a = A[id];
    if (!a || a.type !== "choice") return null;
    return { label: a.choice, p: (a.probabilities && a.probabilities[a.choice]) ?? 0 };
  };
  const linePick = (c) => {
    if (!c) return null;
    const idx = Number(c.label);
    if (!Number.isInteger(idx) || idx < 0 || idx >= lines.length) return null;
    return { idx, ts: parseTimestamp(lines[idx]), p: c.p };
  };

  // 1. When was the ticket opened?
  const open = choice("open_line");
  if (!open || open.label === "none_found" || open.label === "no_single_clear_answer" || open.p < GATE.line)
    return ABSTAIN;
  const openedAt = linePick(open)?.ts;
  if (!openedAt) return ABSTAIN;

  // 2. First reply from a support agent (detector: an auto-ack in the log raises the gate, rule 15)
  const reply = choice("first_reply_line");
  if (!reply || reply.label === "none_found") return ABSTAIN; // no first response yet — a person looks
  const ack = A.autoack_present && typeof A.autoack_present.noul === "number" ? A.autoack_present.noul : null;
  const replyGate = ack === null || ack >= GATE.noul_false ? GATE.line_if_autoack : GATE.line;
  if (reply.p < replyGate) return ABSTAIN;
  const picked = linePick(reply);
  const repliedAt = picked && picked.idx !== linePick(open)?.idx ? picked.ts : null;
  if (!repliedAt || repliedAt < openedAt) return ABSTAIN;

  // 3. Priority at open, and the target the policy sets for it
  const prio = choice("priority_at_open");
  if (!prio || !PRIORITIES.includes(prio.label) || prio.p < GATE.choice) return ABSTAIN;
  const amount = choice(`target_amount_${prio.label}`);
  const unit = choice(`target_unit_${prio.label}`);
  if (!amount || !unit) return ABSTAIN;
  if (amount.label === "not_stated" || unit.label === "not_stated" || !UNITS.includes(unit.label))
    return ABSTAIN;
  const amt = Number(amount.label);
  if (!Number.isFinite(amt) || amount.p < GATE.choice || unit.p < GATE.choice) return ABSTAIN;

  // 4. Clock-hours targets need no business calendar.
  if (unit.label === "clock_hours") {
    return { breached: repliedAt.getTime() - openedAt.getTime() > amt * 3600000 ? "yes" : "no" };
  }
  if (unit.label === "business_days" && amt > 10) return ABSTAIN; // implausible read (likely the hour count)

  // 5. Business-hours arithmetic, entirely in code.
  const s = choice("bh_start_hour"), e = choice("bh_end_hour");
  if (!s || !e || s.label === "not_stated" || e.label === "not_stated") return ABSTAIN;
  const startH = Number(s.label), endH = Number(e.label);
  if (!Number.isInteger(startH) || !Number.isInteger(endH) || endH <= startH) return ABSTAIN;
  if (s.p < GATE.choice || e.p < GATE.choice) return ABSTAIN;

  const hasHol = readNoul(A.has_holidays);
  if (hasHol === null) return ABSTAIN;
  if (hasHol && holidayCandidates(input.policy_text).length === 0) return ABSTAIN; // holidays exist but are not machine-readable

  const elapsed = businessMsBetween(openedAt, repliedAt, startH, endH, A);
  if (elapsed === null) return ABSTAIN;

  const allowed =
    unit.label === "business_hours" ? amt * 3600000 : amt * (endH - startH) * 3600000;
  return { breached: elapsed > allowed ? "yes" : "no" };
}
