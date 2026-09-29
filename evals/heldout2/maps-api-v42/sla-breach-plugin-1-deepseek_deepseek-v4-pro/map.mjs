// map.mjs — Jev SLA first-response breach checker.
//
// The fixed SLA policy is pinned from the supplied policy_text:
// - Urgent: 1 calendar hour, 24/7
// - High: 4 business hours
// - Normal/Low: 16 business hours (2 business days)
// - Business hours: 09:00-17:00 UTC, Mon-Fri
// - Holidays: 2026-01-01, 2026-04-03, 2026-05-25, 2026-12-25
//
// If policy_text changes, update these constants and the instructions below.

const HOLIDAYS = new Set([
  '2026-01-01',
  '2026-04-03',
  '2026-05-25',
  '2026-12-25',
]);

const CHOICE_GATE = 0.6;

function getLines(input) {
  if (!input || typeof input.ticket_log !== 'string') return [];
  return input.ticket_log
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseTimestamp(line) {
  const match = line.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
}

function isBusinessDay(date) {
  const day = date.getUTCDay();
  if (day < 1 || day > 5) return false;
  const iso = date.toISOString().slice(0, 10);
  return !HOLIDAYS.has(iso);
}

function isBusinessMinute(ms) {
  const d = new Date(ms);
  return isBusinessDay(d) && d.getUTCHours() >= 9 && d.getUTCHours() < 17;
}

function nextBusinessMinute(ms) {
  const d = new Date(ms);
  d.setUTCMilliseconds(0);
  if (d.getUTCSeconds() > 0) {
    d.setUTCSeconds(0);
    d.setUTCMinutes(d.getUTCMinutes() + 1);
  }

  let guard = 0;
  while (!isBusinessMinute(d.getTime())) {
    if (guard++ > 20000) throw new Error('nextBusinessMinute failed');
    if (isBusinessDay(d) && d.getUTCHours() < 9) {
      d.setUTCHours(9, 0, 0, 0);
      continue;
    }
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(9, 0, 0, 0);
  }
  return d.getTime();
}

function addBusinessMinutes(startMs, totalMinutes) {
  let current = startMs;
  let remaining = totalMinutes;

  if (!isBusinessMinute(current)) {
    current = nextBusinessMinute(current);
  }

  let guard = 0;
  while (remaining > 0) {
    if (guard++ > 10000) throw new Error('addBusinessMinutes failed');
    if (!isBusinessMinute(current)) {
      current = nextBusinessMinute(current);
    }

    const endOfDay = new Date(current);
    endOfDay.setUTCHours(17, 0, 0, 0);

    const available = Math.max(0, Math.round((endOfDay.getTime() - current) / 60000));
    const take = Math.min(remaining, available);
    current += take * 60000;
    remaining -= take;
  }

  return current;
}

function computeDeadline(openMs, priority) {
  if (priority === 'urgent') {
    return openMs + 60 * 60 * 1000;
  }

  const businessHours = {
    high: 4,
    normal: 16,
    low: 16,
  }[priority];

  if (!businessHours) return null;
  return addBusinessMinutes(openMs, businessHours * 60);
}

function isDecidedChoice(question) {
  if (!question || typeof question.choice !== 'string') return false;
  if (question.choice === 'none' || question.choice === 'ambiguous') return false;
  const p = question.probabilities?.[question.choice];
  return typeof p === 'number' && p >= CHOICE_GATE;
}

export function buildState(input) {
  return {
    ticket_log: input.ticket_log,
    policy_text: input.policy_text,
  };
}

export function questions(input) {
  const lines = getLines(input);

  const lineCriteria = {};
  for (let i = 0; i < lines.length; i += 1) {
    lineCriteria[String(i)] = lines[i];
  }
  lineCriteria.none = 'No such line exists in `ticket_log`.';
  lineCriteria.ambiguous =
    'More than one line could be the answer; a person should decide which line.';

  return {
    opened_line: {
      type: 'choice',
      instructions:
        'Which line of `ticket_log` records the ticket being opened? The line usually says the ticket was opened by the customer. If no such line exists, choose `none`. If it is genuinely ambiguous, choose `ambiguous`.',
      criteria: lineCriteria,
    },
    opened_priority: {
      type: 'choice',
      instructions:
        'At the time the ticket was opened in `ticket_log`, what priority was assigned? Use the opening entry, not any later priority change.',
      criteria: {
        urgent: 'The ticket was opened with priority Urgent.',
        high: 'The ticket was opened with priority High.',
        normal: 'The ticket was opened with priority Normal.',
        low: 'The ticket was opened with priority Low.',
        unknown: 'The opening priority is not clearly stated.',
      },
    },
    first_agent_reply_line: {
      type: 'choice',
      instructions:
        'Which line of `ticket_log` records the first reply from a support agent — a human support agent, not a customer message and not an automatic acknowledgement? If there are several support-agent replies, pick the earliest one. If no such line exists, choose `none`. If it is genuinely ambiguous, choose `ambiguous`.',
      criteria: lineCriteria,
    },
  };
}

export function decide(answers, input) {
  const lines = getLines(input);

  const opened = answers.opened_line;
  const replied = answers.first_agent_reply_line;
  const priorityAnswer = answers.opened_priority;

  if (!isDecidedChoice(opened) || !isDecidedChoice(replied)) {
    return { breached: 'abstain' };
  }

  const priority =
    priorityAnswer && typeof priorityAnswer.choice === 'string'
      ? priorityAnswer.choice.toLowerCase()
      : '';

  if (!priority || priority === 'unknown' || priority === 'ambiguous') {
    return { breached: 'abstain' };
  }

  if (!isDecidedChoice(priorityAnswer)) {
    return { breached: 'abstain' };
  }

  const openedLine = lines[Number(opened.choice)];
  const repliedLine = lines[Number(replied.choice)];

  if (!openedLine || !repliedLine) {
    return { breached: 'abstain' };
  }

  const openMs = parseTimestamp(openedLine);
  const replyMs = parseTimestamp(repliedLine);

  if (!openMs || !replyMs || replyMs < openMs) {
    return { breached: 'abstain' };
  }

  const deadline = computeDeadline(openMs, priority);
  if (!deadline) {
    return { breached: 'abstain' };
  }

  return { breached: replyMs <= deadline ? 'no' : 'yes' };
}
