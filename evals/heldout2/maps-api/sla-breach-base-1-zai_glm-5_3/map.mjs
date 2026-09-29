// map.mjs — first-response SLA breach check, built on Jev (TypeSafe System One).
// Strategy: Jev extracts the facts we cannot parse reliably (priority at open,
// which log line is the opening / first agent reply, policy target, business
// hours, workdays, holidays); decide() computes the deadline deterministically.

const CONF = 0.55; // minimum choice confidence to act on an answer
const PRIORITIES = ["urgent", "high", "normal", "low"];

const TARGET_BUCKETS = {
  "1_calendar_hour": { calendar: true, minutes: 60 },
  "2_calendar_hours": { calendar: true, minutes: 120 },
  "24_calendar_hours": { calendar: true, minutes: 1440 },
  "1_business_hour": { calendar: false, minutes: 60 },
  "4_business_hours": { calendar: false, minutes: 240 },
  "8_business_hours": { calendar: false, minutes: 480 },
  "16_business_hours": { calendar: false, minutes: 960 },
};

const pad = (n) => String(n).padStart(2, "0");

function splitEvents(log) {
  return String(log || "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
}

function firstTimestamp(line) {
  const m = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(line);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0));
}

function parseHM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ""));
  return m ? +m[1] * 60 + +m[2] : null;
}

function isChoice(a) {
  return !!a && a.type === "choice" && typeof a.choice === "string" &&
    typeof a.confidence === "number" && a.confidence >= CONF;
}

// Walk forward through business time until `minutes` are consumed.
function addBusinessMinutes(start, minutes, startMin, endMin, dayAllowed, holidays) {
  let t = new Date(start.getTime());
  let remaining = minutes;
  for (let guard = 0; guard < 4000; guard++) {
    const y = t.getUTCFullYear(), mo = t.getUTCMonth(), d = t.getUTCDate();
    const key = `${y}-${pad(mo + 1)}-${pad(d)}`;
    if (dayAllowed(t.getUTCDay()) && !holidays.has(key)) {
      const ws = Date.UTC(y, mo, d, Math.floor(startMin / 60), startMin % 60);
      const we = Date.UTC(y, mo, d, Math.floor(endMin / 60), endMin % 60);
      const cur = Math.max(t.getTime(), ws);
      if (cur < we) {
        const avail = (we - cur) / 60000;
        if (remaining <= avail + 1e-9) return new Date(cur + remaining * 60000);
        remaining -= avail;
      }
    }
    t = new Date(Date.UTC(y, mo, d + 1, 0, 0, 0));
  }
  return null;
}

export function buildState(input) {
  const events = splitEvents(input.ticket_log);
  return {
    policy_text: String(input.policy_text || ""),
    ticket_log: String(input.ticket_log || ""),
    events: events.map((text, i) => ({ id: `event_${i + 1}`, text })),
    policy_dates: [...new Set(String(input.policy_text || "").match(/\d{4}-\d{2}-\d{2}/g) || [])],
  };
}

export function questions(input) {
  const events = splitEvents(input.ticket_log);
  const eventOpts = {};
  events.forEach((text, i) => { eventOpts[`event_${i + 1}`] = text.slice(0, 300); });
  eventOpts.none_of_the_above_or_unclear =
    "None of the entries above matches, or it cannot be determined from the log.";
  eventOpts.no_agent_reply =
    "No reply from a support agent appears anywhere in the log.";

  const targetCriteria = {
    "1_calendar_hour": "Within 1 hour of real elapsed time, counting all days and all hours (around the clock).",
    "2_calendar_hours": "Within 2 hours of real elapsed time, around the clock.",
    "24_calendar_hours": "Within 1 full calendar day (24 hours) of real elapsed time, around the clock.",
    "1_business_hour": "Within 1 business hour, counted only during the policy's business hours.",
    "4_business_hours": "Within 4 business hours, counted only during the policy's business hours.",
    "8_business_hours": "Within 8 business hours (one business day), counted only during the policy's business hours.",
    "16_business_hours": "Within 16 business hours (two business days), counted only during the policy's business hours.",
    not_specified: "The policy does not state any first-response target for this priority.",
    other_target: "Some other first-response target not covered by the options above.",
  };

  const halfHours = [];
  for (let h = 0; h < 24; h++) for (const mm of [0, 30]) halfHours.push(`${pad(h)}:${pad(mm)}`);
  const hmCriteria = (what) => {
    const c = {};
    for (const t of halfHours) c[t] = `${what} at ${t}.`;
    c.not_specified = `The policy does not specify ${what.toLowerCase()}.`;
    return c;
  };

  const q = {
    priority_at_open: {
      type: "choice",
      instructions: "Read the ticket log. What priority did the ticket have at the moment it was opened? Ignore any later priority changes.",
      criteria: {
        urgent: "The ticket was opened with priority Urgent.",
        high: "The ticket was opened with priority High.",
        normal: "The ticket was opened with priority Normal (also called Medium).",
        low: "The ticket was opened with priority Low.",
        priority_unclear: "The priority at opening cannot be determined from the log.",
      },
    },
    open_event: {
      type: "choice",
      instructions: "Which log entry records the moment the ticket was opened (created) by the customer?",
      criteria: { ...eventOpts },
    },
    first_agent_reply: {
      type: "choice",
      instructions: "Which log entry records the FIRST reply from a support agent (a human agent of the support team responding to the customer)? Customer messages and automatic acknowledgements do NOT count. If no support agent reply appears in the log, choose no_agent_reply.",
      criteria: { ...eventOpts },
    },
    workdays: {
      type: "choice",
      instructions: "According to the policy text, which days of the week are business days / business hours days?",
      criteria: {
        monday_to_friday: "Business hours apply Monday through Friday only.",
        monday_to_saturday: "Business hours apply Monday through Saturday.",
        all_days: "Business hours apply on all days of the week.",
        not_specified: "The policy does not specify which days business hours apply to.",
        other_workdays: "Some other set of business days.",
      },
    },
    business_start: {
      type: "choice",
      instructions: "According to the policy text, at what time of day do business hours start? If the policy defines no business hours, choose not_specified.",
      criteria: hmCriteria("Business hours start"),
    },
    business_end: {
      type: "choice",
      instructions: "According to the policy text, at what time of day do business hours end? If the policy defines no business hours, choose not_specified.",
      criteria: hmCriteria("Business hours end"),
    },
  };

  for (const p of PRIORITIES) {
    q[`target_${p}`] = {
      type: "choice",
      instructions: `According to the policy text, what is the first-response target for tickets with priority ${p}? ("Business hours" means time counted only during the policy's business hours.)`,
      criteria: { ...targetCriteria },
    };
  }

  for (const d of new Set(String(input.policy_text || "").match(/\d{4}-\d{2}-\d{2}/g) || [])) {
    q[`holiday_${d}`] = {
      type: "noul",
      instructions: `Does the policy text list ${d} as a public holiday that is excluded from business hours?`,
      criteria: {
        true: `The policy explicitly excludes ${d} as a public holiday.`,
        false: `The policy does not exclude ${d} as a public holiday.`,
      },
    };
  }

  return q;
}

export function decide(answers, input) {
  const ABSTAIN = { breached: "abstain" };
  answers = answers || {};
  const events = splitEvents(input.ticket_log);

  const pri = answers.priority_at_open;
  if (!isChoice(pri) || !PRIORITIES.includes(pri.choice)) return ABSTAIN;

  const eventTime = (a) => {
    if (!isChoice(a)) return null;
    const m = /^event_(\d+)$/.exec(a.choice);
    if (!m) return null;
    const line = events[+m[1] - 1];
    return line ? firstTimestamp(line) : null;
  };

  const open = eventTime(answers.open_event);
  const reply = eventTime(answers.first_agent_reply);
  if (!open || !reply) return ABSTAIN;

  const t = answers[`target_${pri.choice}`];
  if (!isChoice(t)) return ABSTAIN;
  const tgt = TARGET_BUCKETS[t.choice];
  if (!tgt) return ABSTAIN;

  let deadline;
  if (tgt.calendar) {
    deadline = new Date(open.getTime() + tgt.minutes * 60000);
  } else {
    const bs = answers.business_start, be = answers.business_end;
    if (!isChoice(bs) || !isChoice(be)) return ABSTAIN;
    if (bs.choice === "not_specified" || be.choice === "not_specified") return ABSTAIN;
    const s = parseHM(bs.choice), e = parseHM(be.choice);
    if (s === null || e === null || e <= s) return ABSTAIN;

    const wd = answers.workdays;
    if (!isChoice(wd)) return ABSTAIN;
    let dayAllowed;
    if (wd.choice === "monday_to_friday") dayAllowed = (d) => d >= 1 && d <= 5;
    else if (wd.choice === "monday_to_saturday") dayAllowed = (d) => d >= 1 && d <= 6;
    else if (wd.choice === "all_days") dayAllowed = () => true;
    else return ABSTAIN;

    const holidays = new Set();
    for (const key of Object.keys(answers)) {
      if (key.startsWith("holiday_")) {
        const a = answers[key];
        if (a && a.type === "noul" && typeof a.noul === "number" && a.noul > 0.5) {
          holidays.add(key.slice("holiday_".length));
        }
      }
    }

    deadline = addBusinessMinutes(open, tgt.minutes, s, e, dayAllowed, holidays);
  }
  if (!deadline) return ABSTAIN;

  return reply.getTime() <= deadline.getTime() ? { breached: "no" } : { breached: "yes" };
}
