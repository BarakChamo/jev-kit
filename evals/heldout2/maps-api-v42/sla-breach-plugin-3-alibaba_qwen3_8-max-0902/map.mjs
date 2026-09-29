const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const STATUS_GATE = 0.70;
const READ_GATE = 0.65;
const PRIORITY_GATE = 0.65;

const pad2 = (n) => String(n).padStart(2, "0");
const range = (start, length) => Array.from({ length }, (_, i) => start + i);

function choiceProbability(answer) {
  if (!answer) return 0;

  if (answer.probabilities && typeof answer.probabilities === "object") {
    const candidates = [
      answer.choice,
      String(answer.choice),
      String(Number(answer.choice))
    ];
    for (const key of candidates) {
      const p = answer.probabilities[key];
      if (typeof p === "number" && Number.isFinite(p)) return p;
    }
  }

  if (typeof answer.confidence === "number" && Number.isFinite(answer.confidence)) {
    return answer.confidence;
  }

  if (typeof answer.noul === "number" && Number.isFinite(answer.noul)) {
    return answer.noul;
  }

  return 0;
}

function choiceIs(answer, expected, gate) {
  if (!answer) return false;
  const choice = String(answer.choice ?? "").toLowerCase();
  return choice === expected && choiceProbability(answer) >= gate;
}

function makeDate(year, month, day, hour, minute) {
  if (![year, month, day, hour, minute].every(Number.isInteger)) return null;

  const t = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const d = new Date(t);

  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day ||
    d.getUTCHours() !== hour ||
    d.getUTCMinutes() !== minute
  ) {
    return null;
  }

  return d;
}

function parsePolicy(input) {
  const text = String(input?.policy_text ?? "");

  const policy = {
    startHour: 9,
    startMinute: 0,
    endHour: 17,
    endMinute: 0,
    holidays: new Set([
      "2026-01-01",
      "2026-04-03",
      "2026-05-25",
      "2026-12-25"
    ]),
    urgentHours: 1,
    highHours: 4,
    normalLowHours: 16
  };

  const bm = text.match(/(\d{1,2}):(\d{2})\s*(?:to|-)\s*(\d{1,2}):(\d{2})\s*UTC/i);
  if (bm) {
    const startHour = Number(bm[1]);
    const startMinute = Number(bm[2]);
    const endHour = Number(bm[3]);
    const endMinute = Number(bm[4]);

    const start = startHour * 60 + startMinute;
    const end = endHour * 60 + endMinute;

    if (Number.isInteger(startHour) && Number.isInteger(endHour) && end > start) {
      policy.startHour = startHour;
      policy.startMinute = startMinute;
      policy.endHour = endHour;
      policy.endMinute = endMinute;
    }
  }

  const holidayIndex = text.search(/public holidays?/i);
  const holidayScope = holidayIndex >= 0 ? text.slice(holidayIndex) : text;
  const holidayDates = holidayScope.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
  if (holidayDates.length > 0) {
    policy.holidays = new Set(holidayDates);
  }

  const urgent = text.match(/urgent:\s*within\s+(\d+(?:\.\d+)?)\s*hours?/i);
  if (urgent) policy.urgentHours = Number(urgent[1]);

  const high = text.match(/high:\s*within\s+(\d+(?:\.\d+)?)\s*business hours/i);
  if (high) policy.highHours = Number(high[1]);

  const normalLowDays = text.match(
    /normal(?:\s+and\s+|\s*\/\s*)?low:\s*within\s+(\d+(?:\.\d+)?)\s*business days\s*(?:\((\d+(?:\.\d+)?)\s*business hours\))?/i
  );

  if (normalLowDays) {
    if (normalLowDays[2]) {
      policy.normalLowHours = Number(normalLowDays[2]);
    } else {
      const dayLengthHours =
        policy.endHour + policy.endMinute / 60 -
        (policy.startHour + policy.startMinute / 60);
      policy.normalLowHours = Number(normalLowDays[1]) * dayLengthHours;
    }
  } else {
    const normalLowHours = text.match(
      /normal(?:\s+and\s+|\s*\/\s*)?low:\s*within\s+(\d+(?:\.\d+)?)\s*business hours/i
    );
    if (normalLowHours) policy.normalLowHours = Number(normalLowHours[1]);
  }

  return policy;
}

function formatYMD(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function isBusinessDay(d, policy) {
  const weekday = d.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !policy.holidays.has(formatYMD(d));
}

function businessStartOfDay(d, policy) {
  const x = new Date(d);
  x.setUTCHours(policy.startHour, policy.startMinute, 0, 0);
  return x;
}

function businessEndOfDay(d, policy) {
  const x = new Date(d);
  x.setUTCHours(policy.endHour, policy.endMinute, 0, 0);
  return x;
}

function nextDayStart(d) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + 1);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function atBusinessStart(d, policy) {
  let cursor = new Date(d);

  for (let i = 0; i < 1000; i += 1) {
    if (!isBusinessDay(cursor, policy)) {
      cursor = nextDayStart(cursor);
      continue;
    }

    const start = businessStartOfDay(cursor, policy);
    const end = businessEndOfDay(cursor, policy);

    if (cursor.getTime() < start.getTime()) {
      cursor = start;
      continue;
    }

    if (cursor.getTime() >= end.getTime()) {
      cursor = nextDayStart(cursor);
      continue;
    }

    return cursor;
  }

  return null;
}

function addBusinessHours(start, hours, policy) {
  if (!Number.isFinite(hours) || hours < 0) return null;

  let cursor = atBusinessStart(start, policy);
  if (!cursor) return null;

  let remainingMs = hours * 3_600_000;

  while (remainingMs > 0) {
    cursor = atBusinessStart(cursor, policy);
    if (!cursor) return null;

    const end = businessEndOfDay(cursor, policy);
    const availableMs = end.getTime() - cursor.getTime();

    if (availableMs <= 0) {
      cursor = nextDayStart(cursor);
      continue;
    }

    if (remainingMs <= availableMs) {
      return new Date(cursor.getTime() + remainingMs);
    }

    remainingMs -= availableMs;
    cursor = nextDayStart(cursor);
  }

  return cursor;
}

export function buildState(input) {
  return {
    policy_text: input?.policy_text ?? "",
    ticket_log: input?.ticket_log ?? ""
  };
}

export function questions() {
  const yearCriteria = Object.fromEntries(range(2000, 100).map((y) => [String(y), String(y)]));

  const monthCriteria = Object.fromEntries(
    MONTHS.map((name, i) => [String(i + 1), `${i + 1} (${name})`])
  );

  const dayCriteria = Object.fromEntries(range(1, 31).map((d) => [String(d), pad2(d)]));
  const hourCriteria = Object.fromEntries(range(0, 24).map((h) => [String(h), pad2(h)]));
  const minuteCriteria = Object.fromEntries(range(0, 60).map((m) => [String(m), pad2(m)]));

  const openingStatus = {
    found: "`ticket_log` contains the opening event where the customer opened the ticket, with a timestamp and an initial priority",
    none: "`ticket_log` does not contain such an opening event",
    ambiguous: "the log genuinely supports more than one answer; a person should decide"
  };

  const firstResponseStatus = {
    found: "`ticket_log` contains at least one reply from a support agent after the ticket was opened",
    none: "`ticket_log` contains no support-agent reply after the ticket was opened",
    ambiguous: "the log genuinely supports more than one answer; a person should decide"
  };

  return {
    opening_status: {
      type: "choice",
      instructions:
        "Does `ticket_log` contain the first event where the customer opened the ticket, including a timestamp and the initial priority?",
      criteria: openingStatus
    },

    first_response_status: {
      type: "choice",
      instructions:
        "Does `ticket_log` contain at least one reply from a support agent after the ticket was opened? Customer messages and automatic acknowledgements do not count.",
      criteria: firstResponseStatus
    },

    opened_priority: {
      type: "choice",
      instructions:
        "What priority did the ticket have when it was opened, according to the opening event in `ticket_log`? Use the priority at opening, even if a later line changes it.",
      criteria: {
        urgent: "the opening priority is urgent",
        high: "the opening priority is high",
        normal: "the opening priority is normal",
        low: "the opening priority is low",
        unknown: "the opening priority is not stated or is ambiguous"
      }
    },

    open_year: {
      type: "choice",
      instructions: "In which year does the opening event in `ticket_log` say the ticket was opened?",
      criteria: yearCriteria
    },
    open_month: {
      type: "choice",
      instructions:
        "In which month does the opening event in `ticket_log` say the ticket was opened? Use 1 for January.",
      criteria: monthCriteria
    },
    open_day: {
      type: "choice",
      instructions: "On which day of the month does the opening event in `ticket_log` say the ticket was opened?",
      criteria: dayCriteria
    },
    open_hour: {
      type: "choice",
      instructions: "At which hour, in UTC on a 24-hour clock, does the opening event in `ticket_log` say the ticket was opened?",
      criteria: hourCriteria
    },
    open_minute: {
      type: "choice",
      instructions: "At which minute does the opening event in `ticket_log` say the ticket was opened?",
      criteria: minuteCriteria
    },

    first_year: {
      type: "choice",
      instructions:
        "In which year does the first support-agent reply in `ticket_log` say it was sent? Customer messages and automatic acknowledgements do not count.",
      criteria: yearCriteria
    },
    first_month: {
      type: "choice",
      instructions:
        "In which month does the first support-agent reply in `ticket_log` say it was sent? Use 1 for January. Customer messages and automatic acknowledgements do not count.",
      criteria: monthCriteria
    },
    first_day: {
      type: "choice",
      instructions:
        "On which day of the month does the first support-agent reply in `ticket_log` say it was sent? Customer messages and automatic acknowledgements do not count.",
      criteria: dayCriteria
    },
    first_hour: {
      type: "choice",
      instructions:
        "At which hour, in UTC on a 24-hour clock, does the first support-agent reply in `ticket_log` say it was sent? Customer messages and automatic acknowledgements do not count.",
      criteria: hourCriteria
    },
    first_minute: {
      type: "choice",
      instructions:
        "At which minute does the first support-agent reply in `ticket_log` say it was sent? Customer messages and automatic acknowledgements do not count.",
      criteria: minuteCriteria
    }
  };
}

export function decide(answers, input) {
  try {
    if (!answers || typeof answers !== "object") return { breached: "abstain" };

    if (!choiceIs(answers.opening_status, "found", STATUS_GATE)) {
      return { breached: "abstain" };
    }

    if (!choiceIs(answers.first_response_status, "found", STATUS_GATE)) {
      return { breached: "abstain" };
    }

    const priority = String(answers.opened_priority?.choice ?? "").toLowerCase();
    if (!["urgent", "high", "normal", "low"].includes(priority)) {
      return { breached: "abstain" };
    }
    if (choiceProbability(answers.opened_priority) < PRIORITY_GATE) {
      return { breached: "abstain" };
    }

    const readKeys = [
      "open_year",
      "open_month",
      "open_day",
      "open_hour",
      "open_minute",
      "first_year",
      "first_month",
      "first_day",
      "first_hour",
      "first_minute"
    ];

    for (const key of readKeys) {
      if (!answers[key] || choiceProbability(answers[key]) < READ_GATE) {
        return { breached: "abstain" };
      }
    }

    const openYear = Number(answers.open_year.choice);
    const openMonth = Number(answers.open_month.choice);
    const openDay = Number(answers.open_day.choice);
    const openHour = Number(answers.open_hour.choice);
    const openMinute = Number(answers.open_minute.choice);

    const firstYear = Number(answers.first_year.choice);
    const firstMonth = Number(answers.first_month.choice);
    const firstDay = Number(answers.first_day.choice);
    const firstHour = Number(answers.first_hour.choice);
    const firstMinute = Number(answers.first_minute.choice);

    const openedAt = makeDate(openYear, openMonth, openDay, openHour, openMinute);
    const firstResponseAt = makeDate(firstYear, firstMonth, firstDay, firstHour, firstMinute);

    if (!openedAt || !firstResponseAt) return { breached: "abstain" };
    if (firstResponseAt.getTime() < openedAt.getTime()) return { breached: "abstain" };

    const policy = parsePolicy(input);

    let deadline;
    if (priority === "urgent") {
      deadline = new Date(openedAt.getTime() + policy.urgentHours * 3_600_000);
    } else {
      const businessHours =
        priority === "high" ? policy.highHours : policy.normalLowHours;

      deadline = addBusinessHours(openedAt, businessHours, policy);
    }

    if (!deadline) return { breached: "abstain" };

    return {
      breached: firstResponseAt.getTime() > deadline.getTime() ? "yes" : "no"
    };
  } catch {
    return { breached: "abstain" };
  }
}
