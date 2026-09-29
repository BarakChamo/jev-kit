const GATE = 0.8;

const YEARS = Array.from({ length: 100 }, (_, i) => 2000 + i);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

function opts(values) {
  const criteria = {};
  for (const value of values) criteria[String(value)] = String(value);
  criteria.unknown = "not present or cannot be read";
  return criteria;
}

function stampQuestions(prefix, what) {
  return {
    [`${prefix}_year`]: {
      type: "choice",
      instructions: `In \`ticket_log\`, what is the UTC year of ${what}? Use unknown if it is not present.`,
      criteria: opts(YEARS),
    },
    [`${prefix}_month`]: {
      type: "choice",
      instructions: `In \`ticket_log\`, what is the UTC month number of ${what}? January is 1. Use unknown if it is not present.`,
      criteria: opts(MONTHS),
    },
    [`${prefix}_day`]: {
      type: "choice",
      instructions: `In \`ticket_log\`, what is the UTC day of the month of ${what}? Use unknown if it is not present.`,
      criteria: opts(DAYS),
    },
    [`${prefix}_hour`]: {
      type: "choice",
      instructions: `In \`ticket_log\`, what is the UTC hour of ${what}? Use 0 to 23. Use unknown if it is not present.`,
      criteria: opts(HOURS),
    },
    [`${prefix}_minute`]: {
      type: "choice",
      instructions: `In \`ticket_log\`, what is the UTC minute of ${what}? Use 0 to 59. Use unknown if it is not present.`,
      criteria: opts(MINUTES),
    },
  };
}

function okChoice(answer) {
  return Boolean(
    answer &&
      typeof answer.choice === "string" &&
      answer.probabilities &&
      typeof answer.probabilities[answer.choice] === "number" &&
      answer.probabilities[answer.choice] >= GATE
  );
}

function readStamp(answers, prefix) {
  const parts = ["year", "month", "day", "hour", "minute"];
  const values = [];

  for (const part of parts) {
    const answer = answers[`${prefix}_${part}`];
    if (!okChoice(answer) || answer.choice === "unknown") return null;

    const value = Number(answer.choice);
    if (!Number.isInteger(value)) return null;
    values.push(value);
  }

  const [year, month, day, hour, minute] = values;

  if (
    year < 2000 ||
    year > 2099 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  const ms = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const date = new Date(ms);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute
  ) {
    return null;
  }

  return { ms, date };
}

function getPolicyFacts(input) {
  const text = String(input?.policy_text ?? "");
  const defaultHolidays = ["2026-01-01", "2026-04-03", "2026-05-25", "2026-12-25"];

  const holidayIndex = text.search(/public holidays?:/i);
  let holidays =
    holidayIndex >= 0
      ? text.slice(holidayIndex).match(/\b\d{4}-\d{2}-\d{2}\b/g) || []
      : defaultHolidays;

  if (!holidays.length) holidays = defaultHolidays;

  const business = {
    startHour: 9,
    startMinute: 0,
    endHour: 17,
    endMinute: 0,
    weekdays: [1, 2, 3, 4, 5],
    holidays,
  };

  const hoursMatch = text.match(
    /(\d{1,2}):(\d{2})\s*(?:UTC)?\s*to\s*(\d{1,2}):(\d{2})/i
  );

  if (hoursMatch) {
    const startHour = Number(hoursMatch[1]);
    const startMinute = Number(hoursMatch[2]);
    const endHour = Number(hoursMatch[3]);
    const endMinute = Number(hoursMatch[4]);

    if (endHour * 60 + endMinute > startHour * 60 + startMinute) {
      business.startHour = startHour;
      business.startMinute = startMinute;
      business.endHour = endHour;
      business.endMinute = endMinute;
    }
  }

  if (!/Monday to Friday/i.test(text) && /all days/i.test(text)) {
    business.weekdays = [0, 1, 2, 3, 4, 5, 6];
  }

  const businessMinutesPerDay =
    business.endHour * 60 + business.endMinute -
    (business.startHour * 60 + business.startMinute);

  const targets = {
    urgentMinutes: 60,
    highBusinessMinutes: 240,
    normalLowBusinessMinutes: 960,
  };

  const urgentMatch = text.match(/Urgent:\s*within\s*(\d+(?:\.\d+)?)\s*hour/i);
  if (urgentMatch) targets.urgentMinutes = Number(urgentMatch[1]) * 60;

  const highMatch = text.match(
    /High:\s*within\s*(\d+(?:\.\d+)?)\s*business hours?/i
  );
  if (highMatch) targets.highBusinessMinutes = Number(highMatch[1]) * 60;

  const normalLowHoursMatch = text.match(
    /Normal and Low:\s*within\s*(?:\d+(?:\.\d+)?\s*business days?\s*)?\((\d+(?:\.\d+)?)\s*business hours?\)/i
  );

  if (normalLowHoursMatch) {
    targets.normalLowBusinessMinutes = Number(normalLowHoursMatch[1]) * 60;
  } else {
    const normalLowDaysMatch = text.match(
      /Normal and Low:\s*within\s*(\d+(?:\.\d+)?)\s*business days?/i
    );
    if (normalLowDaysMatch && businessMinutesPerDay > 0) {
      targets.normalLowBusinessMinutes =
        Number(normalLowDaysMatch[1]) * businessMinutesPerDay;
    }
  }

  return { business, targets };
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function isBusinessDay(date, business) {
  return (
    business.weekdays.includes(date.getUTCDay()) &&
    !business.holidays.includes(dateKey(date))
  );
}

function businessStartForDay(date, business) {
  const result = new Date(date);
  result.setUTCHours(business.startHour, business.startMinute, 0, 0);
  return result;
}

function businessEndForDay(date, business) {
  const result = new Date(date);
  result.setUTCHours(business.endHour, business.endMinute, 0, 0);
  return result;
}

function nextBusinessStart(date, business) {
  const cursor = new Date(date);
  cursor.setUTCSeconds(0, 0);

  for (let i = 0; i < 400; i += 1) {
    if (isBusinessDay(cursor, business)) {
      const start = businessStartForDay(cursor, business);
      const end = businessEndForDay(cursor, business);

      if (cursor < start) return start;
      if (cursor < end) return cursor;

      cursor.setUTCDate(cursor.getUTCDate() + 1);
      cursor.setUTCHours(0, 0, 0, 0);
    } else {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      cursor.setUTCHours(0, 0, 0, 0);
    }
  }

  return cursor;
}

function addBusinessMinutes(startDate, minutes, business) {
  if (!(minutes > 0)) return new Date(startDate);

  let cursor = nextBusinessStart(startDate, business);
  let remaining = minutes;

  for (let i = 0; i < 400 && remaining > 0; i += 1) {
    const end = businessEndForDay(cursor, business);
    const available = (end - cursor) / 60000;

    if (available <= 0) {
      cursor = nextBusinessStart(new Date(cursor.getTime() + 60000), business);
      continue;
    }

    if (remaining <= available) {
      return new Date(cursor.getTime() + remaining * 60000);
    }

    remaining -= available;
    cursor = nextBusinessStart(
      new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 1)),
      business
    );
  }

  return cursor;
}

export function buildState(input) {
  return {
    policy_text: String(input?.policy_text ?? ""),
    ticket_log: String(input?.ticket_log ?? ""),
    policy_facts: getPolicyFacts(input),
    convention:
      "Timestamps are UTC. The priority at opening applies. Only support-agent replies count as first response.",
  };
}

export function questions(input) {
  return {
    has_first_support_reply: {
      type: "noul",
      instructions:
        "Does `ticket_log` contain at least one reply from a support agent? Customer messages and automatic acknowledgements do not count.",
      criteria: {
        true: "at least one support-agent reply is present",
        false: "no support-agent reply is present",
      },
    },

    priority_at_open: {
      type: "choice",
      instructions:
        "In `ticket_log`, what priority is stated on the line where the ticket was opened? Use the priority at opening, ignoring later changes.",
      criteria: {
        urgent: "the opening line says urgent",
        high: "the opening line says high",
        normal: "the opening line says normal",
        low: "the opening line says low",
        unknown: "no opening priority can be read",
      },
    },

    ...stampQuestions("opened", "the timestamp on the line where the ticket was opened"),
    ...stampQuestions(
      "response",
      "the timestamp of the first reply from a support agent, not a customer message or automatic acknowledgement"
    ),
  };
}

export function decide(answers, input) {
  const abstain = { breached: "abstain" };

  if (!answers) return abstain;

  const hasReply = answers.has_first_support_reply;
  if (!hasReply || typeof hasReply.noul !== "number" || hasReply.noul < GATE) {
    return abstain;
  }

  const priority = answers.priority_at_open;
  if (!okChoice(priority) || priority.choice === "unknown") return abstain;

  const opened = readStamp(answers, "opened");
  const responded = readStamp(answers, "response");

  if (!opened || !responded) return abstain;
  if (responded.ms < opened.ms) return abstain;

  const policy = getPolicyFacts(input);
  let deadlineMs;

  if (priority.choice === "urgent") {
    deadlineMs = opened.ms + policy.targets.urgentMinutes * 60000;
  } else if (priority.choice === "high") {
    deadlineMs = addBusinessMinutes(
      opened.date,
      policy.targets.highBusinessMinutes,
      policy.business
    ).getTime();
  } else if (priority.choice === "normal" || priority.choice === "low") {
    deadlineMs = addBusinessMinutes(
      opened.date,
      policy.targets.normalLowBusinessMinutes,
      policy.business
    ).getTime();
  } else {
    return abstain;
  }

  if (!Number.isFinite(deadlineMs)) return abstain;

  return { breached: responded.ms > deadlineMs ? "yes" : "no" };
}
