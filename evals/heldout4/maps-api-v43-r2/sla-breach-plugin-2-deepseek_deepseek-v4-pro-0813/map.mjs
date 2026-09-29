// map.mjs
const GATE = 0.8;
const PRIORITIES = ['Urgent', 'High', 'Normal', 'Low'];

function extractTimestamps(log = '') {
  const lines = log.split('\n');
  const items = [];
  for (const line of lines) {
    const re = /\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/g;
    for (const match of line.matchAll(re)) {
      items.push({
        id: `t${items.length}`,
        timestamp: match[0],
        line: line.trim(),
      });
    }
  }
  return items;
}

function parseTimestamp(s) {
  if (!s) return null;
  const cleaned = s.trim().replace(' UTC', '');
  const [datePart, timePart] = cleaned.split(' ');
  if (!datePart || !timePart) return null;
  const parts = timePart.split(':');
  const second = parts.length >= 3 ? parts[2] : '00';
  const iso = `${datePart}T${parts[0]}:${parts[1]}:${second}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parsePolicy(text = '') {
  const businessMatch = text.match(/Business hours are (\d{1,2}):(\d{2}) to (\d{1,2}):(\d{2}) UTC/);
  const urgentMatch = text.match(/Urgent:\s*within (\d+)\s*hour/i);
  const highMatch = text.match(/High:\s*within (\d+)\s*business hours?/i);
  const normalMatch = text.match(/Normal and Low:\s*within \d+\s*business days?\s*\((\d+)\s*business hours\)/i);
  const holidayMatch = text.match(/excluding these public holidays:\s*([^\n]+)/i);

  const holidays = holidayMatch
    ? holidayMatch[1]
        .split(',')
        .map(s => s.trim().replace(/\.$/, ''))
        .filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s))
    : [];

  return {
    startHour: businessMatch ? Number(businessMatch[1]) : 9,
    startMin: businessMatch ? Number(businessMatch[2]) : 0,
    endHour: businessMatch ? Number(businessMatch[3]) : 17,
    endMin: businessMatch ? Number(businessMatch[4]) : 0,
    urgentHours: urgentMatch ? Number(urgentMatch[1]) : 1,
    highBusinessHours: highMatch ? Number(highMatch[1]) : 4,
    normalBusinessHours: normalMatch ? Number(normalMatch[1]) : 16,
    holidays: new Set(holidays),
  };
}

function toDateKey(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isBusinessDay(date, holidays) {
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  if (holidays.has(toDateKey(date))) return false;
  return true;
}

function businessStart(date, policy) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    policy.startHour,
    policy.startMin,
    0,
    0,
  ));
}

function businessEnd(date, policy) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    policy.endHour,
    policy.endMin,
    0,
    0,
  ));
}

function nextDay(date) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  ));
}

function nextBusinessStart(date, policy) {
  let cur = new Date(date.getTime());
  for (let i = 0; i < 30; i += 1) {
    if (isBusinessDay(cur, policy.holidays)) {
      const dayStart = businessStart(cur, policy);
      const dayEnd = businessEnd(cur, policy);
      if (cur.getTime() >= dayStart.getTime() && cur.getTime() < dayEnd.getTime()) {
        return cur;
      }
      if (cur.getTime() < dayStart.getTime()) {
        return dayStart;
      }
    }
    cur = nextDay(cur);
  }
  return cur;
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addBusinessHours(date, hours, policy) {
  let cur = nextBusinessStart(date, policy);
  let remaining = hours * 60 * 60 * 1000;

  for (let i = 0; i < 1000 && remaining > 0; i += 1) {
    const dayStart = businessStart(cur, policy);
    const dayEnd = businessEnd(cur, policy);

    if (!isBusinessDay(cur, policy.holidays)) {
      cur = nextBusinessStart(nextDay(cur), policy);
      continue;
    }

    if (cur.getTime() < dayStart.getTime()) {
      cur = new Date(dayStart.getTime());
    }

    const available = dayEnd.getTime() - cur.getTime();
    if (available >= remaining) {
      cur = new Date(cur.getTime() + remaining);
      remaining = 0;
    } else {
      remaining -= available;
      cur = nextBusinessStart(nextDay(cur), policy);
    }
  }

  return cur;
}

function choiceProbability(answer) {
  if (!answer) return 0;
  if (answer.probabilities && typeof answer.probabilities[answer.choice] === 'number') {
    return answer.probabilities[answer.choice];
  }
  if (typeof answer.confidence === 'number') {
    return answer.confidence;
  }
  return 0;
}

export function buildState(input) {
  return {
    policy_text: input.policy_text || '',
    ticket_log: input.ticket_log || '',
    timestamps: extractTimestamps(input.ticket_log || ''),
  };
}

export function questions(input) {
  const timestamps = extractTimestamps(input.ticket_log || '');
  const timeCriteria = Object.fromEntries(
    timestamps.map(t => [t.id, `${t.timestamp} — ${t.line}`]),
  );
  if (timestamps.length === 0) {
    timeCriteria.none = 'no timestamps were found in `ticket_log`';
  }
  timeCriteria.ambiguous = 'more than one timestamp may fit; a person should decide';

  return {
    priority_at_open: {
      type: 'choice',
      instructions:
        'In `ticket_log`, what priority did the ticket have when it was opened? Use the priority at open even if it later changes.',
      criteria: {
        Urgent: 'the ticket was opened as Urgent priority',
        High: 'the ticket was opened as High priority',
        Normal: 'the ticket was opened as Normal priority',
        Low: 'the ticket was opened as Low priority',
        ambiguous: 'the open priority is not clear; a person should decide',
      },
    },
    opened_at: {
      type: 'choice',
      instructions:
        'Which timestamp in `timestamps` marks when the ticket was opened, according to `ticket_log`?',
      criteria: timeCriteria,
    },
    first_agent_response_at: {
      type: 'choice',
      instructions:
        'Which timestamp in `timestamps` marks the first reply from a support agent in `ticket_log`? Customer messages and automatic acknowledgements do not count. If there is no support-agent first response, choose `none`.',
      criteria: {
        ...timeCriteria,
        none: 'no support-agent first response exists in `ticket_log`',
      },
    },
  };
}

export function decide(answers, input) {
  const policy = parsePolicy(input.policy_text || '');
  const timestamps = extractTimestamps(input.ticket_log || '');
  const timestampById = new Map(timestamps.map(t => [t.id, t.timestamp]));

  const priority = answers.priority_at_open?.choice;
  const openedId = answers.opened_at?.choice;
  const firstResponseId = answers.first_agent_response_at?.choice;

  if (!PRIORITIES.includes(priority)) return { breached: 'abstain' };
  if (choiceProbability(answers.priority_at_open) < GATE) return { breached: 'abstain' };

  if (!openedId || !timestampById.has(openedId)) return { breached: 'abstain' };
  if (choiceProbability(answers.opened_at) < GATE) return { breached: 'abstain' };

  if (!firstResponseId || !timestampById.has(firstResponseId)) return { breached: 'abstain' };
  if (choiceProbability(answers.first_agent_response_at) < GATE) return { breached: 'abstain' };

  const open = parseTimestamp(timestampById.get(openedId));
  const firstResponse = parseTimestamp(timestampById.get(firstResponseId));
  if (!open || !firstResponse) return { breached: 'abstain' };
  if (firstResponse.getTime() <= open.getTime()) return { breached: 'abstain' };

  let due;
  if (priority === 'Urgent') {
    due = addHours(open, policy.urgentHours);
  } else if (priority === 'High') {
    due = addBusinessHours(open, policy.highBusinessHours, policy);
  } else {
    due = addBusinessHours(open, policy.normalBusinessHours, policy);
  }

  return {
    breached: firstResponse.getTime() > due.getTime() ? 'yes' : 'no',
  };
}
