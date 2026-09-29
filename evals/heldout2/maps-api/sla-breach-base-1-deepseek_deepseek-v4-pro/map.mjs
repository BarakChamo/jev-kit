export function buildState(input) {
  return {
    policy_text: input?.policy_text ?? "",
    ticket_log: input?.ticket_log ?? "",
  };
}

export function questions(input) {
  return {
    sla_breach: {
      type: "noul",
      instructions:
        "You are evaluating whether the first-response SLA for a support ticket was breached according to the policy and ticket log. " +
        "Read the policy and the ticket log carefully. Identify the priority at the time the ticket was opened, the first reply from a support agent, and the applicable first-response target. " +
        "A breach means the first agent reply occurred later than that target. Customer messages and automatic acknowledgements are not first responses.",
      criteria: {
        "true": "The first-response SLA was breached.",
        "false": "The first-response SLA was not breached.",
      },
    },
  };
}

function parseBusinessHours(policyText) {
  const m = policyText.match(
    /Business hours are\s+(\d{1,2}):(\d{2})\s*(?:to|[-–])\s*(\d{1,2}):(\d{2})\s*UTC/i
  );
  if (!m) return { start: 9, end: 17 };
  return { start: Number(m[1]), end: Number(m[3]) };
}

function parseHolidays(policyText) {
  const holidays = [];
  const re = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  let m;
  while ((m = re.exec(policyText)) !== null) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (!holidays.some((h) => h.getTime() === d.getTime())) {
      holidays.push(d);
    }
  }
  return holidays;
}

function parseUTCDateTime(line) {
  const m = line.match(/(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::\d{2})?\s*(?:UTC|Z)?/i);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0));
}

function isAgentReply(line) {
  const lower = line.toLowerCase();
  if (/customer replied|customer message|automatic acknowledgement|automatic acknowledgment|auto-?ack|bot replied|automated reply/i.test(lower)) {
    return false;
  }
  if (/first reply from support agent|first response from support agent|support agent .*(replied|responded)|first reply from agent/i.test(lower)) {
    return true;
  }
  if (/(?:^|:\s*|\b)agent\s+\w+\s+(?:replied|responded)/i.test(line)) {
    return true;
  }
  if (/support agent/i.test(line) && /repl|respond/i.test(line)) {
    return true;
  }
  return false;
}

function parseTicketLog(ticketLog) {
  const lines = ticketLog.split(/\r?\n/);
  let opened = null;
  let priority = null;
  let firstReply = null;

  for (const line of lines) {
    const ts = parseUTCDateTime(line);
    if (!ts) continue;

    if (!opened && /ticket opened|opened by .*customer/i.test(line)) {
      opened = ts;
      const pm = line.match(/\bpriority\s*(?:is\s*|was\s*|:\s*)?(Urgent|High|Normal|Low)/i);
      if (pm) priority = pm[1];
    }

    if (!firstReply && isAgentReply(line)) {
      firstReply = ts;
    }
  }

  return { opened, priority, firstReply };
}

function isHoliday(date, holidays) {
  return holidays.some(
    (h) =>
      h.getUTCFullYear() === date.getUTCFullYear() &&
      h.getUTCMonth() === date.getUTCMonth() &&
      h.getUTCDate() === date.getUTCDate()
  );
}

function isBusinessDay(date, holidays) {
  const day = date.getUTCDay();
  return day >= 1 && day <= 5 && !isHoliday(date, holidays);
}

function isBusinessTime(date, hours, holidays) {
  if (!isBusinessDay(date, holidays)) return false;
  const hour = date.getUTCHours();
  const minute = date.getUTCMinutes();
  const second = date.getUTCSeconds();
  const value = hour + minute / 60 + second / 3600;
  return value >= hours.start && value < hours.end;
}

function nextBusinessStart(date, hours, holidays) {
  const d = new Date(date.getTime());
  d.setUTCMinutes(0, 0, 0);

  if (isBusinessDay(d, holidays) && d.getUTCHours() < hours.start) {
    d.setUTCHours(hours.start, 0, 0, 0);
    return d;
  }

  d.setUTCHours(hours.start, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 1);

  while (!isBusinessDay(d, holidays)) {
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(hours.start, 0, 0, 0);
  }

  d.setUTCHours(hours.start, 0, 0, 0);
  return d;
}

function addBusinessHours(start, targetHours, hours, holidays) {
  let remaining = targetHours;
  let current = new Date(start.getTime());

  if (!isBusinessTime(current, hours, holidays)) {
    current = nextBusinessStart(current, hours, holidays);
  }

  let guard = 0;
  while (remaining > 0 && guard < 10000) {
    guard += 1;

    if (!isBusinessTime(current, hours, holidays)) {
      current = nextBusinessStart(current, hours, holidays);
      continue;
    }

    const dayEnd = new Date(
      Date.UTC(
        current.getUTCFullYear(),
        current.getUTCMonth(),
        current.getUTCDate(),
        hours.end,
        0,
        0
      )
    );
    const availableHours = (dayEnd - current) / 3600000;

    if (availableHours <= 0) {
      current = nextBusinessStart(current, hours, holidays);
      continue;
    }

    if (remaining <= availableHours) {
      current = new Date(current.getTime() + remaining * 3600000);
      remaining = 0;
    } else {
      remaining -= availableHours;
      current = nextBusinessStart(
        new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate() + 1, 0, 0, 0)),
        hours,
        holidays
      );
    }
  }

  return current;
}

function computeDue(opened, priority, hours, holidays) {
  if (priority === "Urgent") {
    return new Date(opened.getTime() + 1 * 3600000);
  }

  const targetHours = priority === "High" ? 4 : priority === "Normal" || priority === "Low" ? 16 : null;
  if (targetHours === null) return null;

  return addBusinessHours(opened, targetHours, hours, holidays);
}

export function decide(answers, input) {
  if (!input?.policy_text || !input?.ticket_log) {
    return { breached: "abstain" };
  }

  const hours = parseBusinessHours(input.policy_text);
  const holidays = parseHolidays(input.policy_text);
  const log = parseTicketLog(input.ticket_log);

  if (!log.opened || !log.priority || !log.firstReply) {
    const prob = answers?.sla_breach?.noul;
    if (typeof prob === "number" && !Number.isNaN(prob)) {
      if (prob >= 0.65) return { breached: "yes" };
      if (prob <= 0.35) return { breached: "no" };
    }
    return { breached: "abstain" };
  }

  const due = computeDue(log.opened, log.priority, hours, holidays);
  if (!due) {
    const prob = answers?.sla_breach?.noul;
    if (typeof prob === "number" && !Number.isNaN(prob)) {
      if (prob >= 0.65) return { breached: "yes" };
      if (prob <= 0.35) return { breached: "no" };
    }
    return { breached: "abstain" };
  }

  return { breached: log.firstReply > due ? "yes" : "no" };
}
