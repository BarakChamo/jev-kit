const DAY_MS = 24 * 60 * 60 * 1000;
const YES_GATE = 0.85;
const NO_GATE = 0.15;
const CHOICE_GATE = 0.85;

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function linesOf(input) {
  return String(input?.ticket_log ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
}

function parseTimestamp(text) {
  const match = String(text).match(
    /\b(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:UTC|Z)?\b/i,
  );
  if (!match) return null;

  const [, year, month, day, hour, minute, second = "0"] = match;
  const value = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );

  const date = new Date(value);
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day) ||
    date.getUTCHours() !== Number(hour) ||
    date.getUTCMinutes() !== Number(minute)
  ) {
    return null;
  }

  return value;
}

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function dateRangeFromLog(input) {
  const timestamps = linesOf(input).map(parseTimestamp).filter((x) => x !== null);
  if (timestamps.length === 0) return [];
  const first = Math.min(...timestamps);
  const last = Math.max(...timestamps);
  const dates = [];

  for (let day = Date.UTC(
    new Date(first).getUTCFullYear(),
    new Date(first).getUTCMonth(),
    new Date(first).getUTCDate(),
  ); day <= last; day += DAY_MS) {
    dates.push(isoDate(day));
  }

  return dates;
}

function timeCriteria() {
  const criteria = {};
  for (let hour = 0; hour < 24; hour += 1) {
    for (const minute of [0, 15, 30, 45]) {
      const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      criteria[time] = `The business-hours boundary stated in \`policy_text\` is ${time} UTC.`;
    }
  }
  criteria.not_stated_or_other =
    "No single business-hours boundary is stated, or it is not on a 15-minute boundary.";
  return criteria;
}

function amountCriteria() {
  const criteria = {};
  for (let amount = 0; amount <= 240; amount += 1) {
    criteria[String(amount)] =
      `The numeric magnitude of the applicable first-response target is exactly ${amount}.`;
  }
  criteria.not_stated_or_other =
    "The applicable target has no clear whole-number magnitude from 0 through 240.";
  return criteria;
}

function binaryQuestion(instructions) {
  return {
    type: "noul",
    instructions,
    criteria: {
      true: "This is true.",
      false: "This is false.",
    },
  };
}

function answerProbability(answer, label) {
  return Number(answer?.probabilities?.[label] ?? 0);
}

function selectedChoice(answer) {
  if (!answer || typeof answer.choice !== "string") return null;
  return answer.choice;
}

function parseTime(value) {
  const match = String(value).match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function addBusinessMinutes(startMs, minutes, schedule) {
  let current = startMs;
  let remaining = minutes;

  while (remaining > 0) {
    const currentDate = new Date(current);
    const date = isoDate(current);
    const weekday = WEEKDAYS[(currentDate.getUTCDay() + 6) % 7];

    if (!schedule.workingDays.has(weekday) || schedule.holidays.has(date)) {
      current = Date.UTC(
        currentDate.getUTCFullYear(),
        currentDate.getUTCMonth(),
        currentDate.getUTCDate() + 1,
        0,
        0,
      );
      continue;
    }

    const open = Date.UTC(
      currentDate.getUTCFullYear(),
      currentDate.getUTCMonth(),
      currentDate.getUTCDate(),
      Math.floor(schedule.startMinute / 60),
      schedule.startMinute % 60,
    );
    const close = Date.UTC(
      currentDate.getUTCFullYear(),
      currentDate.getUTCMonth(),
      currentDate.getUTCDate(),
      Math.floor(schedule.endMinute / 60),
      schedule.endMinute % 60,
    );

    if (current < open) current = open;
    if (current >= close) {
      current = Date.UTC(
        currentDate.getUTCFullYear(),
        currentDate.getUTCMonth(),
        currentDate.getUTCDate() + 1,
        0,
        0,
      );
      continue;
    }

    const available = Math.floor((close - current) / 60000);
    if (remaining <= available) return current + remaining * 60000;

    remaining -= available;
    current = Date.UTC(
      currentDate.getUTCFullYear(),
      currentDate.getUTCMonth(),
      currentDate.getUTCDate() + 1,
      0,
      0,
    );
  }

  return current;
}

export function buildState(input) {
  return {
    policy_text: String(input?.policy_text ?? ""),
    ticket_log: String(input?.ticket_log ?? ""),
    domain_convention:
      "All timestamps are UTC unless the policy explicitly says otherwise. A first response is the earliest message authored by a support agent after ticket opening. Automatic acknowledgements and customer messages do not count. For a business-hours target, elapsed time counts only while the stated business-hours schedule is open; time before opening starts at opening, and time after closing resumes at the next opening. A response exactly at its deadline is within the SLA.",
  };
}

export function questions(input) {
  const lines = linesOf(input);
  const dates = dateRangeFromLog(input);
  const map = {};

  for (let index = 0; index < lines.length; index += 1) {
    map[`opened_${index}`] = binaryQuestion(
      `Does line ${index} of \`ticket_log\` record that this ticket was opened by the customer?`,
    );
    map[`agent_reply_${index}`] = binaryQuestion(
      `Does line ${index} of \`ticket_log\` record a reply authored by a support agent? Customer messages and automatic acknowledgements do not count.`,
    );
  }

  map.priority_at_opening = {
    type: "choice",
    instructions:
      "What priority did the ticket have when it was opened, as stated in `ticket_log`? Ignore any later priority changes.",
    criteria: {
      Urgent: "The opening priority is Urgent.",
      High: "The opening priority is High.",
      Normal: "The opening priority is Normal.",
      Low: "The opening priority is Low.",
      other_or_unclear: "The opening priority is absent, unclear, or is not one of the listed priorities.",
    },
  };

  map.target_clock = {
    type: "choice",
    instructions:
      "How does `policy_text` measure the first-response target that applies to the ticket's priority at opening?",
    criteria: {
      calendar_hours:
        "The applicable target is measured in continuously elapsed calendar hours, including all days and hours.",
      calendar_days:
        "The applicable target is measured in continuously elapsed calendar days.",
      business_hours:
        "The applicable target is measured in business hours during the stated business-hours schedule.",
      business_days:
        "The applicable target is measured in business days during the stated business-hours schedule.",
      no_target_or_unclear:
        "No applicable first-response target can be determined clearly.",
    },
  };

  map.target_amount = {
    type: "choice",
    instructions:
      "What is the exact numeric magnitude of the first-response target in `policy_text` that applies to the ticket's priority at opening? Read the stated number; do not determine whether the ticket met it.",
    criteria: amountCriteria(),
  };

  map.business_start = {
    type: "choice",
    instructions:
      "What UTC time does `policy_text` state as the start of business hours?",
    criteria: timeCriteria(),
  };

  map.business_end = {
    type: "choice",
    instructions:
      "What UTC time does `policy_text` state as the end of business hours?",
    criteria: timeCriteria(),
  };

  for (const weekday of WEEKDAYS) {
    map[`working_${weekday}`] = binaryQuestion(
      `Does \`policy_text\` include ${weekday} as a business day or working day for the business-hours schedule?`,
    );
  }

  for (const date of dates) {
    map[`holiday_${date}`] = binaryQuestion(
      `Does \`policy_text\` list ${date} as a public holiday or excluded non-business date?`,
    );
  }

  return map;
}

export function decide(answers, input) {
  const lines = linesOf(input);
  const dates = dateRangeFromLog(input);

  if (lines.length === 0 || lines.length > 255 || dates.length === 0 || dates.length > 370) {
    return { breached: "abstain" };
  }

  const openings = [];
  const replies = [];

  for (let index = 0; index < lines.length; index += 1) {
    const timestamp = parseTimestamp(lines[index]);
    if (timestamp === null) {
      if (
        Number(answers?.[`opened_${index}`]?.noul) > NO_GATE ||
        Number(answers?.[`agent_reply_${index}`]?.noul) > NO_GATE
      ) {
        return { breached: "abstain" };
      }
      continue;
    }

    for (const [prefix, target] of [
      ["opened", openings],
      ["agent_reply", replies],
    ]) {
      const probability = Number(answers?.[`${prefix}_${index}`]?.noul);
      if (!Number.isFinite(probability) || (probability > NO_GATE && probability < YES_GATE)) {
        return { breached: "abstain" };
      }
      if (probability >= YES_GATE) target.push(timestamp);
    }
  }

  if (openings.length !== 1 || replies.length === 0) {
    return { breached: "abstain" };
  }

  const openedAt = openings[0];
  const firstReplyAt = Math.min(...replies);
  if (firstReplyAt < openedAt) return { breached: "abstain" };

  const priority = selectedChoice(answers?.priority_at_opening);
  const targetClock = selectedChoice(answers?.target_clock);
  const targetAmount = selectedChoice(answers?.target_amount);

  if (
    !priority ||
    priority === "other_or_unclear" ||
    !targetClock ||
    targetClock === "no_target_or_unclear" ||
    !targetAmount ||
    targetAmount === "not_stated_or_other" ||
    answerProbability(answers?.priority_at_opening, priority) < CHOICE_GATE ||
    answerProbability(answers?.target_clock, targetClock) < CHOICE_GATE ||
    answerProbability(answers?.target_amount, targetAmount) < CHOICE_GATE
  ) {
    return { breached: "abstain" };
  }

  const amount = Number(targetAmount);
  if (!Number.isInteger(amount) || amount < 0) return { breached: "abstain" };

  let deadline;

  if (targetClock === "calendar_hours") {
    deadline = openedAt + amount * 60 * 60 * 1000;
  } else if (targetClock === "calendar_days") {
    deadline = openedAt + amount * DAY_MS;
  } else {
    const start = selectedChoice(answers?.business_start);
    const end = selectedChoice(answers?.business_end);
    const startMinute = parseTime(start);
    const endMinute = parseTime(end);

    if (
      startMinute === null ||
      endMinute === null ||
      endMinute <= startMinute ||
      answerProbability(answers?.business_start, start) < CHOICE_GATE ||
      answerProbability(answers?.business_end, end) < CHOICE_GATE
    ) {
      return { breached: "abstain" };
    }

    const workingDays = new Set();
    for (const weekday of WEEKDAYS) {
      const probability = Number(answers?.[`working_${weekday}`]?.noul);
      if (!Number.isFinite(probability) || (probability > NO_GATE && probability < YES_GATE)) {
        return { breached: "abstain" };
      }
      if (probability >= YES_GATE) workingDays.add(weekday);
    }

    if (workingDays.size === 0) return { breached: "abstain" };

    const holidays = new Set();
    for (const date of dates) {
      const probability = Number(answers?.[`holiday_${date}`]?.noul);
      if (!Number.isFinite(probability) || (probability > NO_GATE && probability < YES_GATE)) {
        return { breached: "abstain" };
      }
      if (probability >= YES_GATE) holidays.add(date);
    }

    const minutesPerBusinessDay = endMinute - startMinute;
    const businessMinutes =
      targetClock === "business_hours"
        ? amount * 60
        : targetClock === "business_days"
          ? amount * minutesPerBusinessDay
          : null;

    if (businessMinutes === null) return { breached: "abstain" };

    deadline = addBusinessMinutes(openedAt, businessMinutes, {
      startMinute,
      endMinute,
      workingDays,
      holidays,
    });
  }

  return { breached: firstReplyAt > deadline ? "yes" : "no" };
}
