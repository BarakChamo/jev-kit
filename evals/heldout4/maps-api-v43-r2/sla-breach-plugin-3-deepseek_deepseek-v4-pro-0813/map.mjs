const PRIORITY_GATE = 0.65;
const LINE_GATE = 0.65;

function toLines(text) {
  return String(text ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function parseTimestamp(line) {
  const m = line.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?:\s+UTC)?/);
  if (!m) return null;
  const [year, month, day] = m[1].split('-').map(Number);
  const [hour, minute] = m[2].split(':').map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute));
}

function parseTimeHM(str) {
  const m = str.match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function parsePolicy(text) {
  if (!text) return null;
  if (!/monday\s*(?:to|through|-)\s*friday/i.test(text)) return null;

  const urgentMatch = text.match(/Urgent:\s*within\s+(\d+(?:\.\d+)?)\s*hour/i);
  const highMatch = text.match(/High:\s*within\s+(\d+(?:\.\d+)?)\s*business hours?/i);
  const normalLowMatch = text.match(
    /Normal\s*(?:and|&|\/)\s*Low:\s*within\s+(\d+(?:\.\d+)?)\s*business days?\s*(?:\((\d+(?:\.\d+)?)\s*business hours?\))?/i
  );
  const hoursMatch = text.match(
    /Business hours are\s+(\d{1,2}:\d{2})\s+to\s+(\d{1,2}:\d{2})\s+UTC/i
  );

  const businessStart = hoursMatch ? parseTimeHM(hoursMatch[1]) : null;
  const businessEnd = hoursMatch ? parseTimeHM(hoursMatch[2]) : null;

  if (!urgentMatch || !highMatch || !normalLowMatch || businessStart === null || businessEnd === null) {
    return null;
  }

  const urgentHours = parseFloat(urgentMatch[1]);
  const highHours = parseFloat(highMatch[1]);
  const normalLowDays = parseFloat(normalLowMatch[1]);
  const normalLowHours = normalLowMatch[2]
    ? parseFloat(normalLowMatch[2])
    : normalLowDays * ((businessEnd - businessStart) / 60);

  const holidaySection = text.split(/excluding these public holidays:/i)[1] ?? '';
  const holidays = holidaySection.match(/\d{4}-\d{2}-\d{2}/g) ?? [];

  return {
    urgentHours,
    highHours,
    normalLowHours,
    businessStart,
    businessEnd,
    holidays: new Set(holidays)
  };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function holidayKey(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function isBusinessDay(date, policy) {
  const day = date.getUTCDay();
  return day >= 1 && day <= 5 && !policy.holidays.has(holidayKey(date));
}

function isBusinessTime(date, policy) {
  if (!isBusinessDay(date, policy)) return false;
  const mins = date.getUTCHours() * 60 + date.getUTCMinutes();
  return mins >= policy.businessStart && mins < policy.businessEnd;
}

function nextBusinessStart(date, policy) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);

  const mins = date.getUTCHours() * 60 + date.getUTCMinutes();
  if (mins >= policy.businessEnd) {
    d.setUTCDate(d.getUTCDate() + 1);
  }

  while (!isBusinessDay(d, policy)) {
    d.setUTCDate(d.getUTCDate() + 1);
  }

  d.setUTCHours(Math.floor(policy.businessStart / 60), policy.businessStart % 60, 0, 0);
  return d;
}

function addBusinessHours(startDate, hours, policy) {
  let current = new Date(startDate);
  let remaining = Math.round(hours * 60);
  if (remaining <= 0) return current;

  if (!isBusinessTime(current, policy)) {
    current = nextBusinessStart(current, policy);
  }

  let guard = 0;
  while (remaining > 0 && guard++ < 100000) {
    if (!isBusinessTime(current, policy)) {
      current = nextBusinessStart(current, policy);
      continue;
    }

    const mins = current.getUTCHours() * 60 + current.getUTCMinutes();
    const remainingToday = policy.businessEnd - mins;
    const take = Math.min(remaining, remainingToday);

    current = new Date(current.getTime() + take * 60000);
    remaining -= take;

    if (remaining > 0) {
      current = nextBusinessStart(current, policy);
    }
  }

  return current;
}

function addRealHours(startDate, hours) {
  return new Date(startDate.getTime() + hours * 3600000);
}

function lineOptions(lines, noneText, ambiguousText) {
  const criteria = {};
  lines.forEach((line, idx) => {
    criteria[String(idx)] = line;
  });
  criteria.none = noneText;
  criteria.ambiguous = ambiguousText;
  return criteria;
}

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    ticket_log: input.ticket_log
  };
}

export function questions(input) {
  const lines = toLines(input.ticket_log);

  return {
    priority: {
      type: 'choice',
      instructions: 'What priority does `ticket_log` say the ticket had when it was opened?',
      criteria: {
        urgent: 'Urgent priority',
        high: 'High priority',
        normal: 'Normal priority',
        low: 'Low priority',
        ambiguous: 'The priority at opening cannot be determined from `ticket_log`; a person should decide.'
      }
    },
    opened_line: {
      type: 'choice',
      instructions: 'Which line of `ticket_log` records that the ticket was opened?',
      criteria: lineOptions(
        lines,
        'No line in `ticket_log` records the ticket opening.',
        'It is unclear from `ticket_log` which line records the ticket opening; a person should decide.'
      )
    },
    first_response: {
      type: 'choice',
      instructions:
        'Which line of `ticket_log` records the first reply from a support agent? A support agent reply is a message written by a human support agent (for example, "first reply from support agent Sam"). It is not a customer message and not an automatic acknowledgement.',
      criteria: lineOptions(
        lines,
        'No line in `ticket_log` records a reply from a support agent.',
        'It is unclear from `ticket_log` which line is the first support agent reply; a person should decide.'
      )
    }
  };
}

export function decide(answers, input) {
  const policy = parsePolicy(input.policy_text);
  if (!policy) return { breached: 'abstain' };

  const priorityAnswer = answers?.priority;
  if (!priorityAnswer || !priorityAnswer.choice || priorityAnswer.choice === 'ambiguous') {
    return { breached: 'abstain' };
  }
  const priorityP = priorityAnswer.probabilities?.[priorityAnswer.choice] ?? 0;
  if (priorityP < PRIORITY_GATE) return { breached: 'abstain' };
  const priority = priorityAnswer.choice;

  const openedAnswer = answers?.opened_line;
  if (
    !openedAnswer ||
    !openedAnswer.choice ||
    openedAnswer.choice === 'ambiguous' ||
    openedAnswer.choice === 'none'
  ) {
    return { breached: 'abstain' };
  }
  const openedP = openedAnswer.probabilities?.[openedAnswer.choice] ?? 0;
  if (openedP < LINE_GATE) return { breached: 'abstain' };

  const firstAnswer = answers?.first_response;
  if (
    !firstAnswer ||
    !firstAnswer.choice ||
    firstAnswer.choice === 'ambiguous' ||
    firstAnswer.choice === 'none'
  ) {
    return { breached: 'abstain' };
  }
  const firstP = firstAnswer.probabilities?.[firstAnswer.choice] ?? 0;
  if (firstP < LINE_GATE) return { breached: 'abstain' };

  const lines = toLines(input.ticket_log);

  const openedIdx = Number(openedAnswer.choice);
  if (!Number.isInteger(openedIdx) || openedIdx < 0 || openedIdx >= lines.length) {
    return { breached: 'abstain' };
  }
  const openedTime = parseTimestamp(lines[openedIdx]);
  if (!openedTime) return { breached: 'abstain' };

  const firstIdx = Number(firstAnswer.choice);
  if (!Number.isInteger(firstIdx) || firstIdx < 0 || firstIdx >= lines.length) {
    return { breached: 'abstain' };
  }
  const firstResponseTime = parseTimestamp(lines[firstIdx]);
  if (!firstResponseTime) return { breached: 'abstain' };

  let deadline;
  if (priority === 'urgent') {
    deadline = addRealHours(openedTime, policy.urgentHours);
  } else if (priority === 'high') {
    deadline = addBusinessHours(openedTime, policy.highHours, policy);
  } else if (priority === 'normal' || priority === 'low') {
    deadline = addBusinessHours(openedTime, policy.normalLowHours, policy);
  } else {
    return { breached: 'abstain' };
  }

  const breached = firstResponseTime.getTime() > deadline.getTime() ? 'yes' : 'no';
  return { breached };
}
