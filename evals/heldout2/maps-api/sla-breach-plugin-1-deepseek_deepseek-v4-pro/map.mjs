export function buildState(input) {
  return {
    policy_text: input.policy_text,
    ticket_log: input.ticket_log,
    timestamps: extractTimestamps(input.ticket_log),
    policy: parsePolicy(input.policy_text),
  };
}

export function questions(input) {
  const timestamps = extractTimestamps(input.ticket_log);
  const timestampOptions = Object.fromEntries(
    timestamps.map((ts, i) => [String(i), ts])
  );
  const openingOptions =
    timestamps.length === 0
      ? { none: "No timestamp appears in `ticket_log`." }
      : { ...timestampOptions, none: "No opening timestamp appears in `ticket_log`." };
  const responseOptions = {
    ...timestampOptions,
    none: "No support-agent response appears in `ticket_log`.",
  };

  return {
    opened_priority: {
      type: "choice",
      instructions:
        "In `ticket_log`, what priority did the ticket have at the moment it was first opened by the customer? Use the priority at opening even if it is changed later.",
      criteria: {
        Urgent: "The ticket was opened as Urgent.",
        High: "The ticket was opened as High.",
        Normal: "The ticket was opened as Normal.",
        Low: "The ticket was opened as Low.",
        unknown: "The priority at opening cannot be determined.",
      },
    },
    opened_timestamp: {
      type: "choice",
      instructions:
        "Which timestamp in `ticket_log` is the time the ticket was first opened by the customer?",
      criteria: openingOptions,
    },
    first_response_timestamp: {
      type: "choice",
      instructions:
        "Which timestamp in `ticket_log` is the first response from a support agent? Ignore customer messages, automatic acknowledgements, and system notes. If no support-agent response exists, choose none.",
      criteria: responseOptions,
    },
    first_response_by_agent: {
      type: "noul",
      instructions:
        "Is the first response in `ticket_log` a reply from a support agent, rather than an automatic acknowledgement, a customer message, or a system note?",
      criteria: {
        true: "The first response is written by a support agent.",
        false:
          "The first response is not written by a support agent, or there is no first response.",
      },
    },
  };
}

export function decide(answers, input) {
  const requireChoice = (answer, allowedNoneAllowed = false) => {
    if (!answer || !answer.choice) return null;
    if (!allowedNoneAllowed && answer.choice === "none") return null;
    const p = answer.probabilities && answer.probabilities[answer.choice];
    if (p === undefined || p < 0.8) return null;
    return answer.choice;
  };

  const priorityChoice = requireChoice(answers.opened_priority);
  if (!priorityChoice || priorityChoice === "unknown") return { breached: "abstain" };

  const openChoice = requireChoice(answers.opened_timestamp);
  const responseChoice = requireChoice(answers.first_response_timestamp);

  if (openChoice === null || responseChoice === null || openChoice === "none" || responseChoice === "none") {
    return { breached: "abstain" };
  }

  const agent = answers.first_response_by_agent && answers.first_response_by_agent.noul;
  if (agent === undefined || agent < 0.8) return { breached: "abstain" };

  const timestamps = extractTimestamps(input.ticket_log);
  const openTs = timestamps[Number(openChoice)];
  const responseTs = timestamps[Number(responseChoice)];
  if (!openTs || !responseTs) return { breached: "abstain" };

  const openDate = parseTimestamp(openTs);
  const responseDate = parseTimestamp(responseTs);
  if (!openDate || !responseDate || responseDate < openDate) return { breached: "abstain" };

  const policy = parsePolicy(input.policy_text);
  const target = policy.targets[priorityChoice];
  if (!target || target.hours === null) return { breached: "abstain" };

  const targetMs = target.hours * 60 * 60 * 1000;
  const elapsedMs = target.businessOnly
    ? businessElapsedMs(openDate, responseDate, policy)
    : responseDate - openDate;

  return { breached: elapsedMs > targetMs ? "yes" : "no" };
}

function extractTimestamps(text = "") {
  const re = /\b(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*UTC|Z)?\b/g;
  return [...String(text).matchAll(re)].map((m) => m[0]);
}

function parseTimestamp(value) {
  const m = String(value).match(
    /(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/
  );
  if (!m) return null;
  return new Date(
    Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      0
    )
  );
}

function parsePolicy(text = "") {
  const business = {
    startHour: 9,
    startMinute: 0,
    endHour: 17,
    endMinute: 0,
    days: [1, 2, 3, 4, 5], // Monday-Friday
    holidays: [],
  };

  const bh = String(text).match(
    /Business hours are\s+(\d{1,2})\s*:\s*(\d{2})\s+to\s+(\d{1,2})\s*:\s*(\d{2})/i
  );
  if (bh) {
    business.startHour = Number(bh[1]);
    business.startMinute = Number(bh[2]);
    business.endHour = Number(bh[3]);
    business.endMinute = Number(bh[4]);
  }

  const holidays = new Set(
    [...String(text).matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)].map((m) => m[0])
  );
  business.holidays = [...holidays].sort();

  const urgentTarget = String(text).match(
    /Urgent:\s*within\s+(\d+(?:\.\d+)?)\s*hour/i
  );
  const highTarget = String(text).match(
    /High:\s*within\s+(\d+(?:\.\d+)?)\s*business hours?/i
  );
  const normalLowTarget = String(text).match(
    /Normal and Low:\s*within\s+(\d+(?:\.\d+)?)\s*business days?\s*(?:\((\d+(?:\.\d+)?)\s*business hours?\))?/i
  );

  const urgentBusinessOnly = !/around the clock|all days, all hours|24\s*\/\s*7/i.test(
    text
  );

  const businessDayHours =
    business.endHour +
    business.endMinute / 60 -
    (business.startHour + business.startMinute / 60);

  const normalLowHours = normalLowTarget
    ? normalLowTarget[2]
      ? Number(normalLowTarget[2])
      : Number(normalLowTarget[1]) * businessDayHours
    : null;

  return {
    business,
    targets: {
      Urgent: {
        hours: urgentTarget ? Number(urgentTarget[1]) : null,
        businessOnly: urgentBusinessOnly,
      },
      High: {
        hours: highTarget ? Number(highTarget[1]) : null,
        businessOnly: true,
      },
      Normal: {
        hours: normalLowHours,
        businessOnly: true,
      },
      Low: {
        hours: normalLowHours,
        businessOnly: true,
      },
    },
  };
}

function businessElapsedMs(start, end, policy) {
  if (!policy || !policy.business || start >= end) return 0;

  const b = policy.business;
  const holidays = new Set(b.holidays || []);
  let total = 0;

  const startDay = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
  );
  const endDay = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())
  );

  for (
    let day = new Date(startDay);
    day <= endDay;
    day = new Date(day.getTime() + 24 * 60 * 60 * 1000)
  ) {
    const dayOfWeek = day.getUTCDay();
    const dayKey = day.toISOString().slice(0, 10);

    if (!b.days.includes(dayOfWeek) || holidays.has(dayKey)) continue;

    const dayStart = new Date(day);
    dayStart.setUTCHours(b.startHour, b.startMinute, 0, 0);

    const dayEnd = new Date(day);
    dayEnd.setUTCHours(b.endHour, b.endMinute, 0, 0);

    const segmentStart = start > dayStart ? start : dayStart;
    const segmentEnd = end < dayEnd ? end : dayEnd;

    if (segmentStart < segmentEnd) {
      total += segmentEnd - segmentStart;
    }
  }

  return total;
}
