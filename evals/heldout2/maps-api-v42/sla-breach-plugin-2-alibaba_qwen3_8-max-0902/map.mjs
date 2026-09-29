const GATE = 0.8;
const MINUTE_MS = 60000;
const DAY_MS = 86400000;

function range(start, end) {
  const out = [];
  for (let i = start; i <= end; i += 1) out.push(i);
  return out;
}

function numericCriteria(values, what) {
  const criteria = {};
  for (const value of values) criteria[String(value)] = `${what} ${value}`;
  criteria.unknown = `The ${what} is not stated or is ambiguous.`;
  return criteria;
}

const MONTH_CRITERIA = (() => {
  const names = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const criteria = {};
  names.forEach((name, i) => {
    criteria[String(i + 1)] = `${name} (month ${i + 1})`;
  });
  criteria.unknown = "The month is not stated or is ambiguous.";
  return criteria;
})();

function dateTimeQuestions(prefix, event, missingNote) {
  return {
    [`${prefix}_year`]: {
      type: "choice",
      instructions: `According to \`ticket_log\`, what is the year of ${event}? ${missingNote}`,
      criteria: numericCriteria(range(2000, 2050), "year")
    },
    [`${prefix}_month`]: {
      type: "choice",
      instructions: `According to \`ticket_log\`, what is the month number of ${event}? Use 1 for January. ${missingNote}`,
      criteria: MONTH_CRITERIA
    },
    [`${prefix}_day`]: {
      type: "choice",
      instructions: `According to \`ticket_log\`, what is the day of the month of ${event}? ${missingNote}`,
      criteria: numericCriteria(range(1, 31), "day of month")
    },
    [`${prefix}_hour`]: {
      type: "choice",
      instructions: `According to \`ticket_log\`, what is the 24-hour UTC hour of ${event}? ${missingNote}`,
      criteria: numericCriteria(range(0, 23), "hour of day")
    },
    [`${prefix}_minute`]: {
      type: "choice",
      instructions: `According to \`ticket_log\`, what is the minute of ${event}? ${missingNote}`,
      criteria: numericCriteria(range(0, 59), "minute")
    }
  };
}

export function buildState(input) {
  return {
    policy_text: typeof input?.policy_text === "string" ? input.policy_text : "",
    ticket_log: typeof input?.ticket_log === "string" ? input.ticket_log : "",
    sla_convention:
      "Use the priority at ticket opening. Only a reply from a support agent counts as first response. " +
      "Urgent targets count elapsed clock hours. High, Normal, and Low targets count business hours only, " +
      "excluding weekends and listed public holidays."
  };
}

export function questions(input) {
  const opened = dateTimeQuestions(
    "open",
    "the date-time when the ticket was opened",
    "Choose unknown if it is not stated."
  );

  const reply = dateTimeQuestions(
    "reply",
    "the date-time of the first reply from a support agent",
    "If there is no support-agent reply, choose unknown."
  );

  return {
    priority: {
      type: "choice",
      instructions: "What priority does `ticket_log` say the ticket had when it was opened?",
      criteria: {
        urgent: "The ticket was opened with Urgent priority.",
        high: "The ticket was opened with High priority.",
        normal: "The ticket was opened with Normal priority.",
        low: "The ticket was opened with Low priority.",
        unknown: "The priority at opening is not stated or is ambiguous."
      }
    },
    has_agent_reply: {
      type: "choice",
      instructions:
        "Does `ticket_log` include at least one reply from a support agent after the ticket was opened? " +
        "Customer messages and automatic acknowledgements do not count.",
      criteria: {
        yes: "`ticket_log` includes a reply from a support agent after opening.",
        no: "`ticket_log` includes no support-agent reply after opening.",
        unknown: "Cannot determine whether a support-agent reply exists."
      }
    },
    ...opened,
    ...reply
  };
}

export function decide(answers, input) {
  const policy = parsePolicy(input?.policy_text);
  if (!policy.ok) return { breached: "abstain" };

  const priorityAnswer = answers?.priority;
  if (!okChoice(priorityAnswer) || priorityAnswer.choice === "unknown") {
    return { breached: "abstain" };
  }

  const hasReply = answers?.has_agent_reply;
  if (!okChoice(hasReply) || hasReply.choice !== "yes") {
    return { breached: "abstain" };
  }

  const openYear = getNumber(answers?.open_year);
  const openMonth = getNumber(answers?.open_month);
  const openDay = getNumber(answers?.open_day);
  const openHour = getNumber(answers?.open_hour);
  const openMinute = getNumber(answers?.open_minute);

  const replyYear = getNumber(answers?.reply_year);
  const replyMonth = getNumber(answers?.reply_month);
  const replyDay = getNumber(answers?.reply_day);
  const replyHour = getNumber(answers?.reply_hour);
  const replyMinute = getNumber(answers?.reply_minute);

  const values = [
    openYear, openMonth, openDay, openHour, openMinute,
    replyYear, replyMonth, replyDay, replyHour, replyMinute
  ];
  if (values.some((v) => v === null)) return { breached: "abstain" };

  if (!validDateTime(openYear, openMonth, openDay, openHour, openMinute)) {
    return { breached: "abstain" };
  }
  if (!validDateTime(replyYear, replyMonth, replyDay, replyHour, replyMinute)) {
    return { breached: "abstain" };
  }

  const openMs = Date.UTC(openYear, openMonth - 1, openDay, openHour, openMinute);
  const replyMs = Date.UTC(replyYear, replyMonth - 1, replyDay, replyHour, replyMinute);

  if (!(replyMs >= openMs)) return { breached: "abstain" };

  const target = policy.targets[priorityAnswer.choice];
  if (!target) return { breached: "abstain" };

  let deadline;
  if (target.mode === "clock") {
    deadline = openMs + target.minutes * MINUTE_MS;
  } else {
    deadline = addBusinessMinutes(openMs, target.minutes, policy);
  }

  if (!Number.isFinite(deadline)) return { breached: "abstain" };

  return { breached: replyMs > deadline ? "yes" : "no" };
}

function okChoice(answer) {
  return Boolean(
    answer &&
    typeof answer.choice === "string" &&
    (answer.probabilities?.[answer.choice] ?? 0) >= GATE
  );
}

function getNumber(answer) {
  if (!okChoice(answer) || answer.choice === "unknown") return null;
  const n = Number(answer.choice);
  return Number.isFinite(n) ? n : null;
}

function validDateTime(year, month, day, hour, minute) {
  if (![year, month, day, hour, minute].every(Number.isInteger)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return false;

  const ms = Date.UTC(year, month - 1, day, hour, minute);
  const dt = new Date(ms);
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day &&
    dt.getUTCHours() === hour &&
    dt.getUTCMinutes() === minute
  );
}

function parsePolicy(text) {
  if (typeof text !== "string" || !text.trim()) return { ok: false };

  const holidays = new Set(text.match(/\b\d{4}-\d{2}-\d{2}\b/g) || []);

  const businessHours = text.match(
    /business hours[^\n]*?(\d{1,2}):(\d{2})\s*(?:to|-)\s*(\d{1,2}):(\d{2})\s*UTC/i
  );
  if (!businessHours) return { ok: false };

  const startMinutes = Number(businessHours[1]) * 60 + Number(businessHours[2]);
  const endMinutes = Number(businessHours[3]) * 60 + Number(businessHours[4]);
  if (!(startMinutes >= 0 && endMinutes <= 1440 && endMinutes > startMinutes)) {
    return { ok: false };
  }

  const businessDayMinutes = endMinutes - startMinutes;
  const targets = {};

  const urgentLine = text.match(/Urgent:[^\n]*/i)?.[0] ?? "";
  const urgentHours = urgentLine.match(/within\s*(\d+(?:\.\d+)?)\s*[-\s]?hours?/i);
  if (!urgentHours) return { ok: false };
  const urgentClock = !/business/i.test(urgentLine) || /around the clock|all days|all hours|clock/i.test(urgentLine);
  targets.urgent = {
    mode: urgentClock ? "clock" : "business",
    minutes: Math.round(Number.parseFloat(urgentHours[1]) * 60)
  };

  const highLine = text.match(/High:[^\n]*/i)?.[0] ?? "";
  const highHours = highLine.match(/within\s*(\d+(?:\.\d+)?)\s*[-\s]?business hours?/i);
  if (!highHours) return { ok: false };
  targets.high = {
    mode: "business",
    minutes: Math.round(Number.parseFloat(highHours[1]) * 60)
  };

  const normalLine = text.match(/Normal(?:\s+and\s+|\s*\/\s*)Low:[^\n]*/i)?.[0] ?? "";
  const parenHours = normalLine.match(/\((\d+(?:\.\d+)?)\s*[-\s]?business hours?\)/i);
  const normalDays = normalLine.match(/within\s*(\d+(?:\.\d+)?)\s*[-\s]?business days?/i);
  const normalHours = normalLine.match(/within\s*(\d+(?:\.\d+)?)\s*[-\s]?business hours?/i);

  let normalMinutes = null;
  if (parenHours) {
    normalMinutes = Math.round(Number.parseFloat(parenHours[1]) * 60);
  } else if (normalDays) {
    normalMinutes = Math.round(Number.parseFloat(normalDays[1]) * businessDayMinutes);
  } else if (normalHours) {
    normalMinutes = Math.round(Number.parseFloat(normalHours[1]) * 60);
  }

  if (normalMinutes === null) return { ok: false };

  targets.normal = targets.low = {
    mode: "business",
    minutes: normalMinutes
  };

  if (!(targets.urgent.minutes > 0 && targets.high.minutes > 0 && normalMinutes > 0)) {
    return { ok: false };
  }

  return {
    ok: true,
    holidays,
    startMinutes,
    endMinutes,
    targets
  };
}

function dayStart(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function toDateKey(ms) {
  const d = new Date(ms);
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${month}-${day}`;
}

function isBusinessDay(dayStartMs, policy) {
  const d = new Date(dayStartMs);
  const weekday = d.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !policy.holidays.has(toDateKey(dayStartMs));
}

function startOfBusinessIntervalAtOrAfter(ms, policy) {
  let day = dayStart(ms);

  for (let i = 0; i < 1000; i += 1) {
    if (isBusinessDay(day, policy)) {
      const intervalStart = day + policy.startMinutes * MINUTE_MS;
      const intervalEnd = day + policy.endMinutes * MINUTE_MS;

      if (ms <= intervalStart) return intervalStart;
      if (ms < intervalEnd) return ms;
    }
    day += DAY_MS;
  }

  return NaN;
}

function addBusinessMinutes(startMs, minutes, policy) {
  let cursor = startOfBusinessIntervalAtOrAfter(startMs, policy);
  if (!Number.isFinite(cursor)) return NaN;

  let remainingMs = minutes * MINUTE_MS;
  if (remainingMs <= 0) return cursor;

  for (let i = 0; i < 1000 && remainingMs > 0; i += 1) {
    const day = dayStart(cursor);
    const intervalEnd = day + policy.endMinutes * MINUTE_MS;
    const availableMs = intervalEnd - cursor;

    if (availableMs <= 0) {
      cursor = startOfBusinessIntervalAtOrAfter(cursor + MINUTE_MS, policy);
      if (!Number.isFinite(cursor)) return NaN;
      continue;
    }

    if (remainingMs <= availableMs) return cursor + remainingMs;

    remainingMs -= availableMs;
    cursor = startOfBusinessIntervalAtOrAfter(intervalEnd, policy);
    if (!Number.isFinite(cursor)) return NaN;
  }

  return remainingMs > 0 ? NaN : cursor;
}
