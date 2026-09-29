const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const READ_GATE = 0.7;
const EXISTS_GATE = 0.7;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function opts(values, unknownDescription) {
  const criteria = {};
  for (const value of values) criteria[String(value)] = String(value);
  criteria.unknown = unknownDescription;
  return criteria;
}

function yearOptions(log) {
  const text = String(log ?? "");
  const found = Array.from(
    new Set((text.match(/\b(?:19|20|21)\d{2}\b/g) || []).map(Number))
  );
  const base = Array.from({ length: 16 }, (_, i) => 2020 + i);
  return Array.from(new Set([...base, ...found])).sort((a, b) => a - b);
}

function parsePolicy(input) {
  const text = String(input?.policy_text ?? "");

  const holidayStart = text.search(/excluding[^:]*holidays?[:]?/i);
  const holidayText = holidayStart >= 0 ? text.slice(holidayStart) : text;
  const holidays = Array.from(
    new Set(holidayText.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [])
  );

  const hm = text.match(
    /(\d{1,2}):(\d{2})\s*(?:to|-|–|—|until)\s*(\d{1,2}):(\d{2})\s*UTC/i
  );

  let startMinute = hm ? Number(hm[1]) * 60 + Number(hm[2]) : 9 * 60;
  let endMinute = hm ? Number(hm[3]) * 60 + Number(hm[4]) : 17 * 60;
  if (!(endMinute > startMinute)) {
    startMinute = 9 * 60;
    endMinute = 17 * 60;
  }

  const weekdays = [1, 2, 3, 4, 5];

  const targets = {
    urgent: { calendar: true, hours: 1 },
    high: { calendar: false, hours: 4 },
    normal: { calendar: false, hours: 16 },
    low: { calendar: false, hours: 16 },
  };

  const urgent = text.match(/urgent[^\n]*?within\s*(\d+(?:\.\d+)?)\s*hour/i);
  if (urgent) targets.urgent.hours = Number(urgent[1]);

  const high = text.match(
    /high[^\n]*?within\s*(\d+(?:\.\d+)?)\s*business hours/i
  );
  if (high) targets.high.hours = Number(high[1]);

  const normalHours = text.match(
    /normal[^\n]*?\((\d+(?:\.\d+)?)\s*business hours\)/i
  );
  const normalDays = text.match(
    /normal[^\n]*?within\s*(\d+(?:\.\d+)?)\s*business days/i
  );

  if (normalHours) {
    const v = Number(normalHours[1]);
    if (Number.isFinite(v)) {
      targets.normal.hours = v;
      targets.low.hours = v;
    }
  } else if (normalDays) {
    const dayLengthHours = Math.max(0, endMinute - startMinute) / 60 || 8;
    const v = Number(normalDays[1]) * dayLengthHours;
    if (Number.isFinite(v)) {
      targets.normal.hours = v;
      targets.low.hours = v;
    }
  }

  const lowHours =
    text.match(/\blow\b[^\n]*?\((\d+(?:\.\d+)?)\s*business hours\)/i) ||
    text.match(/\blow\b[^\n]*?within\s*(\d+(?:\.\d+)?)\s*business hours/i);
  if (lowHours) {
    const v = Number(lowHours[1]);
    if (Number.isFinite(v)) targets.low.hours = v;
  }

  return { holidays, startMinute, endMinute, weekdays, targets };
}

function dateQuestions(prefix, event, unknownNote, years) {
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 60 }, (_, i) => i);

  return {
    [`${prefix}_year`]: {
      type: "choice",
      instructions: `What year does \`ticket_log\` state for ${event}? Choose unknown if ${unknownNote}.`,
      criteria: opts(years, `the year for ${event} is unknown`),
    },
    [`${prefix}_month`]: {
      type: "choice",
      instructions: `What month does \`ticket_log\` state for ${event}? Choose unknown if ${unknownNote}.`,
      criteria: opts(MONTHS, `the month for ${event} is unknown`),
    },
    [`${prefix}_day`]: {
      type: "choice",
      instructions: `What day of the month does \`ticket_log\` state for ${event}? Choose unknown if ${unknownNote}.`,
      criteria: opts(days, `the day for ${event} is unknown`),
    },
    [`${prefix}_hour`]: {
      type: "choice",
      instructions: `What UTC hour, 0 to 23, does \`ticket_log\` state for ${event}? Choose unknown if ${unknownNote}.`,
      criteria: opts(hours, `the hour for ${event} is unknown`),
    },
    [`${prefix}_minute`]: {
      type: "choice",
      instructions: `What minute, 0 to 59, does \`ticket_log\` state for ${event}? Choose unknown if ${unknownNote}.`,
      criteria: opts(minutes, `the minute for ${event} is unknown`),
    },
  };
}

function getChoice(answer, gate = READ_GATE) {
  if (!answer || typeof answer.choice !== "string") return null;
  const choice = answer.choice;
  if (choice === "unknown") return null;

  const p = answer.probabilities?.[choice];
  if (typeof p !== "number" || p < gate) return null;

  return choice;
}

function readTimestamp(prefix, answers) {
  const yearChoice = getChoice(answers[`${prefix}_year`]);
  if (!yearChoice || !/^\d{4}$/.test(yearChoice)) return null;

  const monthChoice = getChoice(answers[`${prefix}_month`]);
  if (!monthChoice) return null;

  let month = MONTHS.indexOf(monthChoice);
  if (month === -1 && /^\d{1,2}$/.test(monthChoice)) {
    const m = Number(monthChoice);
    if (m >= 1 && m <= 12) month = m - 1;
  }
  if (month < 0 || month > 11) return null;

  const dayChoice = getChoice(answers[`${prefix}_day`]);
  if (!dayChoice) return null;
  const day = Number(dayChoice);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;

  const hourChoice = getChoice(answers[`${prefix}_hour`]);
  if (!hourChoice) return null;
  const hour = Number(hourChoice);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;

  const minuteChoice = getChoice(answers[`${prefix}_minute`]);
  if (!minuteChoice) return null;
  const minute = Number(minuteChoice);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;

  const year = Number(yearChoice);
  const ms = Date.UTC(year, month, day, hour, minute, 0, 0);
  const dt = new Date(ms);

  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month ||
    dt.getUTCDate() !== day ||
    dt.getUTCHours() !== hour ||
    dt.getUTCMinutes() !== minute
  ) {
    return null;
  }

  return ms;
}

function startOfDay(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function minuteOfDay(ms) {
  const d = new Date(ms);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function isBusinessDay(ms, policy) {
  const d = new Date(ms);
  if (!policy.weekdays.includes(d.getUTCDay())) return false;
  const key = d.toISOString().slice(0, 10);
  return !policy.holidays.includes(key);
}

function nextBusinessStart(ms, policy) {
  let day = startOfDay(ms);
  const mod = minuteOfDay(ms);

  if (isBusinessDay(day, policy) && mod < policy.startMinute) {
    return day + policy.startMinute * MINUTE_MS;
  }

  day += DAY_MS;
  for (let i = 0; i < 1000; i += 1) {
    if (isBusinessDay(day, policy)) {
      return day + policy.startMinute * MINUTE_MS;
    }
    day += DAY_MS;
  }

  return NaN;
}

function addBusinessMinutes(startMs, targetMinutes, policy) {
  if (!Number.isFinite(targetMinutes) || targetMinutes <= 0) return NaN;
  if (!(policy.endMinute > policy.startMinute)) return NaN;

  let remainingMs = targetMinutes * MINUTE_MS;

  const startDay = startOfDay(startMs);
  const mod = minuteOfDay(startMs);

  let cursor;
  if (
    isBusinessDay(startDay, policy) &&
    mod >= policy.startMinute &&
    mod < policy.endMinute
  ) {
    cursor = startMs;
  } else {
    cursor = nextBusinessStart(startMs, policy);
    if (!Number.isFinite(cursor)) return NaN;
  }

  for (let i = 0; i < 1000 && remainingMs > 0; i += 1) {
    const day = startOfDay(cursor);

    if (!isBusinessDay(day, policy)) {
      cursor = nextBusinessStart(cursor, policy);
      if (!Number.isFinite(cursor)) return NaN;
      continue;
    }

    const dayStart = day + policy.startMinute * MINUTE_MS;
    const dayEnd = day + policy.endMinute * MINUTE_MS;

    if (cursor < dayStart) cursor = dayStart;

    if (cursor >= dayEnd) {
      cursor = nextBusinessStart(dayEnd, policy);
      if (!Number.isFinite(cursor)) return NaN;
      continue;
    }

    const availableMs = dayEnd - cursor;
    if (remainingMs <= availableMs) return cursor + remainingMs;

    remainingMs -= availableMs;
    cursor = nextBusinessStart(dayEnd, policy);
    if (!Number.isFinite(cursor)) return NaN;
  }

  return remainingMs <= 0 ? cursor : NaN;
}

export function buildState(input) {
  return {
    policy_text: input?.policy_text ?? "",
    ticket_log: input?.ticket_log ?? "",
    sla_convention:
      "The priority at opening controls. Urgent target is elapsed clock hours. " +
      "Other targets count only business hours. Business hours run from the stated start " +
      "to the stated end UTC on weekdays, excluding holidays. If a ticket opens outside " +
      "business hours, counting starts at the next business-hour start. Only a support-agent " +
      "reply is a first response.",
    policy_terms: parsePolicy(input),
  };
}

export function questions(input) {
  const years = yearOptions(input?.ticket_log);

  return {
    support_reply_exists: {
      type: "noul",
      instructions:
        "Does `ticket_log` include at least one reply from a support agent? Customer messages and automatic acknowledgements do not count.",
      criteria: {
        true: "`ticket_log` includes at least one support-agent reply",
        false: "`ticket_log` includes no support-agent reply",
      },
    },

    priority_at_open: {
      type: "choice",
      instructions:
        "What priority does `ticket_log` state the ticket had when it was opened? Use the priority stated in the opening event, not any later change. Choose unknown if the opening priority is not stated.",
      criteria: {
        urgent: "the opening event says Urgent",
        high: "the opening event says High",
        normal: "the opening event says Normal",
        low: "the opening event says Low",
        unknown: "the opening priority is not stated or cannot be determined",
      },
    },

    ...dateQuestions(
      "open",
      "the time the ticket was opened",
      "the opening time is not stated or cannot be determined",
      years
    ),

    ...dateQuestions(
      "response",
      "the first reply from a support agent",
      "there is no support-agent reply or its time is not stated",
      years
    ),
  };
}

export function decide(answers, input) {
  try {
    const exists = answers?.support_reply_exists?.noul;
    if (typeof exists !== "number" || exists < EXISTS_GATE) {
      return { breached: "abstain" };
    }

    const priority = getChoice(answers?.priority_at_open);
    if (!priority || !["urgent", "high", "normal", "low"].includes(priority)) {
      return { breached: "abstain" };
    }

    const policy = parsePolicy(input);
    const target = policy.targets?.[priority];
    if (!target || !Number.isFinite(target.hours) || target.hours <= 0) {
      return { breached: "abstain" };
    }

    const openMs = readTimestamp("open", answers);
    if (openMs == null) return { breached: "abstain" };

    const responseMs = readTimestamp("response", answers);
    if (responseMs == null) return { breached: "abstain" };

    if (responseMs < openMs) return { breached: "abstain" };

    const deadlineMs = target.calendar
      ? openMs + target.hours * HOUR_MS
      : addBusinessMinutes(openMs, target.hours * 60, policy);

    if (!Number.isFinite(deadlineMs)) return { breached: "abstain" };

    return { breached: responseMs > deadlineMs ? "yes" : "no" };
  } catch {
    return { breached: "abstain" };
  }
}
