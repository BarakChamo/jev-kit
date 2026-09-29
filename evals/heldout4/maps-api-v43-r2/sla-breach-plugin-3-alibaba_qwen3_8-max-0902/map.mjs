const DAY_MS = 86400000;
const BUSINESS_START_MIN = 9 * 60;
const BUSINESS_END_MIN = 17 * 60;

const HOLIDAYS = new Set([
  "2026-01-01",
  "2026-04-03",
  "2026-05-25",
  "2026-12-25",
]);

const TARGETS = {
  urgent: { mode: "calendar", minutes: 60 },
  high: { mode: "business", minutes: 4 * 60 },
  normal: { mode: "business", minutes: 16 * 60 },
  low: { mode: "business", minutes: 16 * 60 },
};

const GATE = 0.7;

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

function splitLines(log) {
  return String(log ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function range(start, end) {
  const out = [];
  for (let i = start; i <= end; i += 1) out.push(i);
  return out;
}

function lineCriteria(lines) {
  return Object.fromEntries(lines.map((line, i) => [String(i), line]));
}

function numericCriteria(values, label) {
  const criteria = {};
  for (const value of values) criteria[String(value)] = `${label} ${value}`;
  criteria.unknown = "not stated or cannot be determined";
  return criteria;
}

function monthCriteria() {
  const criteria = {};
  MONTHS.forEach((month, i) => {
    criteria[String(i + 1)] = `${i + 1} (${month})`;
  });
  criteria.unknown = "not stated or cannot be determined";
  return criteria;
}

function dateTimeQuestions(prefix, what) {
  return {
    [`${prefix}_year`]: {
      type: "choice",
      instructions: `In which year does \`ticket_log\` say ${what}?`,
      criteria: numericCriteria(range(2000, 2100), "year"),
    },
    [`${prefix}_month`]: {
      type: "choice",
      instructions: `In which month does \`ticket_log\` say ${what}?`,
      criteria: monthCriteria(),
    },
    [`${prefix}_day`]: {
      type: "choice",
      instructions: `On which day of the month does \`ticket_log\` say ${what}?`,
      criteria: numericCriteria(range(1, 31), "day"),
    },
    [`${prefix}_hour`]: {
      type: "choice",
      instructions: `At which hour in UTC does \`ticket_log\` say ${what}? Use 0 to 23.`,
      criteria: numericCriteria(range(0, 23), "hour"),
    },
    [`${prefix}_minute`]: {
      type: "choice",
      instructions: `At which minute does \`ticket_log\` say ${what}?`,
      criteria: numericCriteria(range(0, 59), "minute"),
    },
  };
}

export function buildState(input) {
  const lines = splitLines(input.ticket_log);

  return {
    policy_text: String(input.policy_text ?? ""),
    ticket_log: String(input.ticket_log ?? ""),
    ticket_log_lines: lines,
    sla_convention:
      "Urgent targets count calendar hours. High, Normal and Low targets count only 09:00 to 17:00 UTC, Monday to Friday, excluding listed holidays. The priority at opening applies. Only a support-agent reply is a first response.",
  };
}

export function questions(input) {
  const lines = splitLines(input.ticket_log);

  const qs = {
    priority: {
      type: "choice",
      instructions:
        "What priority does `ticket_log` state the ticket had when it was opened? Use the priority at opening, even if a later line changes it.",
      criteria: {
        urgent: "the ticket was opened as Urgent",
        high: "the ticket was opened as High",
        normal: "the ticket was opened as Normal",
        low: "the ticket was opened as Low",
        unknown: "the priority at opening is not stated",
      },
    },
  };

  if (lines.length <= 254) {
    const criteria = lineCriteria(lines);

    qs.opened_line = {
      type: "choice",
      instructions:
        "Which line of `ticket_log_lines` states the date and time when the ticket was opened? Choose the earliest line that records the ticket opening.",
      criteria: {
        ...criteria,
        unknown: "no line states when the ticket was opened",
      },
    };

    qs.first_reply_line = {
      type: "choice",
      instructions:
        "Which line of `ticket_log_lines` is the first reply from a support agent? Customer messages and automatic acknowledgements do not count. If there are several support-agent replies, choose the earliest one.",
      criteria: {
        ...criteria,
        none: "no line is a reply from a support agent",
      },
    };

    return qs;
  }

  qs.has_agent_reply = {
    type: "choice",
    instructions:
      "Does `ticket_log` include at least one reply from a support agent? Customer messages and automatic acknowledgements do not count.",
    criteria: {
      yes: "at least one line is a reply from a support agent",
      no: "no line is a reply from a support agent",
      unknown: "cannot determine whether a support-agent reply exists",
    },
  };

  Object.assign(
    qs,
    dateTimeQuestions("open", "the ticket was opened"),
    dateTimeQuestions(
      "reply",
      "the first reply from a support agent was sent; choose unknown if there is no support-agent reply"
    )
  );

  return qs;
}

function chosen(answers, id) {
  const answer = answers?.[id];
  if (!answer || answer.type !== "choice" || typeof answer.choice !== "string") {
    return undefined;
  }

  const p = answer.probabilities?.[answer.choice] ?? answer.confidence ?? 0;
  if (p < GATE) return undefined;

  return answer.choice;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function holidayKey(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function isBusinessDayAtMidnight(ms) {
  const date = new Date(ms);
  const weekday = date.getUTCDay();

  if (weekday === 0 || weekday === 6) return false;

  return !HOLIDAYS.has(
    holidayKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
  );
}

function startOfDayMs(ms) {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function ensureBusinessStart(ms) {
  const dayStart = startOfDayMs(ms);
  const date = new Date(ms);
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();

  if (isBusinessDayAtMidnight(dayStart)) {
    if (minutes < BUSINESS_START_MIN) {
      return dayStart + BUSINESS_START_MIN * 60000;
    }

    if (minutes < BUSINESS_END_MIN) {
      return ms;
    }
  }

  let cursor = dayStart + DAY_MS;
  while (!isBusinessDayAtMidnight(cursor)) cursor += DAY_MS;

  return cursor + BUSINESS_START_MIN * 60000;
}

function nextBusinessStartAfterDay(dayStartMs) {
  let cursor = dayStartMs + DAY_MS;
  while (!isBusinessDayAtMidnight(cursor)) cursor += DAY_MS;

  return cursor + BUSINESS_START_MIN * 60000;
}

function addBusinessMinutes(openMs, minutes) {
  let cursor = ensureBusinessStart(openMs);
  let remainingMs = minutes * 60000;

  for (let i = 0; i < 1000 && remainingMs > 0; i += 1) {
    const dayStart = startOfDayMs(cursor);
    const dayEnd = dayStart + BUSINESS_END_MIN * 60000;
    const availableMs = dayEnd - cursor;

    if (availableMs <= 0) {
      cursor = nextBusinessStartAfterDay(dayStart);
      continue;
    }

    if (remainingMs <= availableMs) {
      return cursor + remainingMs;
    }

    remainingMs -= availableMs;
    cursor = nextBusinessStartAfterDay(dayStart);
  }

  return null;
}

function dueFor(openMs, target) {
  if (target.mode === "calendar") {
    return openMs + target.minutes * 60000;
  }

  return addBusinessMinutes(openMs, target.minutes);
}

function toUtcMs(year, month, day, hour, minute) {
  if (![year, month, day, hour, minute].every(Number.isInteger)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23) return null;
  if (minute < 0 || minute > 59) return null;

  const ms = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const date = new Date(ms);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return ms;
}

function parseTimestamp(text) {
  const match = String(text).match(
    /(\d{4})-(\d{2})-(\d{2})[ T]?(\d{2}):(\d{2})/
  );

  if (!match) return null;

  return toUtcMs(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5])
  );
}

function latestTimestamp(lines) {
  let last = null;

  for (const line of lines) {
    const ms = parseTimestamp(line);
    if (ms != null && (last == null || ms > last)) last = ms;
  }

  return last;
}

function readDateTime(answers, prefix) {
  const parts = [];

  for (const key of ["year", "month", "day", "hour", "minute"]) {
    const value = chosen(answers, `${prefix}_${key}`);
    if (!value || value === "unknown") return null;

    const n = Number(value);
    if (!Number.isInteger(n)) return null;

    parts.push(n);
  }

  return toUtcMs(parts[0], parts[1], parts[2], parts[3], parts[4]);
}

function decideTimestamps(openMs, replyMs, target) {
  if (replyMs < openMs) return { breached: "abstain" };

  const dueMs = dueFor(openMs, target);
  if (dueMs == null) return { breached: "abstain" };

  return { breached: replyMs <= dueMs ? "no" : "yes" };
}

function decideNoReply(openMs, target, lines) {
  const dueMs = dueFor(openMs, target);
  if (dueMs == null) return { breached: "abstain" };

  const lastMs = latestTimestamp(lines);
  if (lastMs != null && lastMs >= dueMs) return { breached: "yes" };

  return { breached: "abstain" };
}

export function decide(answers, input) {
  const priority = chosen(answers, "priority");
  if (!priority || priority === "unknown") return { breached: "abstain" };

  const target = TARGETS[priority];
  if (!target) return { breached: "abstain" };

  const lines = splitLines(input.ticket_log);

  if (answers.opened_line) {
    const openChoice = chosen(answers, "opened_line");
    if (!openChoice || openChoice === "unknown") return { breached: "abstain" };

    const openIndex = Number(openChoice);
    if (!Number.isInteger(openIndex) || !lines[openIndex]) {
      return { breached: "abstain" };
    }

    const openMs = parseTimestamp(lines[openIndex]);
    if (openMs == null) return { breached: "abstain" };

    const replyChoice = chosen(answers, "first_reply_line");
    if (!replyChoice) return { breached: "abstain" };

    if (replyChoice === "none") {
      return decideNoReply(openMs, target, lines);
    }

    const replyIndex = Number(replyChoice);
    if (!Number.isInteger(replyIndex) || !lines[replyIndex]) {
      return { breached: "abstain" };
    }

    const replyMs = parseTimestamp(lines[replyIndex]);
    if (replyMs == null) return { breached: "abstain" };

    return decideTimestamps(openMs, replyMs, target);
  }

  const openMs = readDateTime(answers, "open");
  if (openMs == null) return { breached: "abstain" };

  const hasAgentReply = chosen(answers, "has_agent_reply");
  if (!hasAgentReply || hasAgentReply === "unknown") {
    return { breached: "abstain" };
  }

  if (hasAgentReply === "no") {
    return decideNoReply(openMs, target, lines);
  }

  const replyMs = readDateTime(answers, "reply");
  if (replyMs == null) return { breached: "abstain" };

  return decideTimestamps(openMs, replyMs, target);
}
