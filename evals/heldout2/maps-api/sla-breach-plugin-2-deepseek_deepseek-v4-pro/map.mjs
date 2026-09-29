const MIN_PROB = 0.7;

function getLines(input) {
  return input.ticket_log
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function lineCriteria(lines) {
  return Object.fromEntries(lines.map((text, i) => [String(i), text]));
}

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    ticket_log: input.ticket_log,
    ticket_lines: getLines(input),
  };
}

export function questions(input) {
  const lines = getLines(input);
  const noResponseCriteria = {
    ...lineCriteria(lines),
    none: 'there is no line in `ticket_lines` that records a reply from a support agent',
  };

  return {
    priority: {
      type: 'choice',
      instructions:
        'What priority did the ticket have when it was opened, according to `ticket_log`? Use the priority at opening, even if the ticket priority was changed later.',
      criteria: {
        urgent: 'the ticket was opened with priority Urgent',
        high: 'the ticket was opened with priority High',
        normal: 'the ticket was opened with priority Normal',
        low: 'the ticket was opened with priority Low',
      },
    },
    opened_line: {
      type: 'choice',
      instructions: 'Which line in `ticket_lines` records the ticket being opened?',
      criteria: lineCriteria(lines),
    },
    first_response_line: {
      type: 'choice',
      instructions:
        'Which line in `ticket_lines` records the first reply from a support agent? Only a reply from a support agent counts; customer messages and automatic acknowledgements do not. If no such line exists, choose `none`.',
      criteria: noResponseCriteria,
    },
  };
}

function parseTimestamp(text) {
  const match = String(text).match(
    /(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:UTC|Z)?/i,
  );
  if (!match) return null;

  const date = new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      match[6] ? Number(match[6]) : 0,
    ),
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

function parsePolicy(text = '') {
  const policy = {
    startHour: 9,
    startMinute: 0,
    endHour: 17,
    endMinute: 0,
    weekdays: true,
    holidays: [],
    urgentMinutes: 60,
    highMinutes: 240,
    normalLowMinutes: 960,
  };

  const hours = /Business hours are\s+(\d{1,2}):(\d{2})\s+to\s+(\d{1,2}):(\d{2})\s+UTC/i.exec(text);
  if (hours) {
    policy.startHour = Number(hours[1]);
    policy.startMinute = Number(hours[2]);
    policy.endHour = Number(hours[3]);
    policy.endMinute = Number(hours[4]);
  }

  policy.weekdays = /Monday\s+to\s+Friday/i.test(text);

  const holidays = text.match(/\d{4}-\d{2}-\d{2}/g) || [];
  if (holidays.length) policy.holidays = holidays;

  const urgent = /Urgent:\s*within\s+(\d+)\s+hour/i.exec(text);
  if (urgent) policy.urgentMinutes = Number(urgent[1]) * 60;

  const high = /High:\s*within\s+(\d+)\s+business hour/i.exec(text);
  if (high) policy.highMinutes = Number(high[1]) * 60;

  const normal = /Normal and Low:\s*within\s+\d+\s+business days?\s*\(\s*(\d+)\s+business hours?\s*\)/i.exec(text);
  if (normal) policy.normalLowMinutes = Number(normal[1]) * 60;

  return policy;
}

function businessMinutesBetween(start, end, policy) {
  const holidays = new Set(policy.holidays || []);
  const startMinutes = policy.startHour * 60 + policy.startMinute;
  const endMinutes = policy.endHour * 60 + policy.endMinute;
  const endTime = end.getTime();

  let total = 0;
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));

  while (cursor.getTime() <= endTime) {
    const key = cursor.toISOString().slice(0, 10);
    const dow = cursor.getUTCDay();
    const isBusinessDay = policy.weekdays
      ? dow >= 1 && dow <= 5
      : true;

    if (isBusinessDay && !holidays.has(key)) {
      const dayBase = Date.UTC(
        cursor.getUTCFullYear(),
        cursor.getUTCMonth(),
        cursor.getUTCDate(),
      );
      const workStart = dayBase + startMinutes * 60000;
      const workEnd = dayBase + endMinutes * 60000;
      const overlapStart = Math.max(start.getTime(), workStart);
      const overlapEnd = Math.min(endTime, workEnd);

      if (overlapEnd > overlapStart) {
        total += (overlapEnd - overlapStart) / 60000;
      }
    }

    cursor = new Date(
      Date.UTC(
        cursor.getUTCFullYear(),
        cursor.getUTCMonth(),
        cursor.getUTCDate() + 1,
      ),
    );
  }

  return total;
}

function topProbability(answer) {
  if (!answer || !answer.probabilities || !answer.choice) return 0;
  return answer.probabilities[answer.choice] || 0;
}

export function decide(answers, input) {
  const priorityAnswer = answers.priority;
  const openedAnswer = answers.opened_line;
  const responseAnswer = answers.first_response_line;

  if (!priorityAnswer || !openedAnswer || !responseAnswer) {
    return { breached: 'abstain' };
  }

  if (
    topProbability(priorityAnswer) < MIN_PROB ||
    topProbability(openedAnswer) < MIN_PROB ||
    topProbability(responseAnswer) < MIN_PROB
  ) {
    return { breached: 'abstain' };
  }

  if (responseAnswer.choice === 'none') {
    return { breached: 'abstain' };
  }

  const priority = priorityAnswer.choice;
  if (!['urgent', 'high', 'normal', 'low'].includes(priority)) {
    return { breached: 'abstain' };
  }

  const lines = getLines(input);
  const openedLine = lines[Number(openedAnswer.choice)];
  const responseLine = lines[Number(responseAnswer.choice)];

  if (!openedLine || !responseLine) {
    return { breached: 'abstain' };
  }

  const openedAt = parseTimestamp(openedLine);
  const respondedAt = parseTimestamp(responseLine);

  if (!openedAt || !respondedAt || respondedAt <= openedAt) {
    return { breached: 'abstain' };
  }

  const policy = parsePolicy(input.policy_text);

  const targetMinutes = priority === 'urgent'
    ? policy.urgentMinutes
    : priority === 'high'
      ? policy.highMinutes
      : policy.normalLowMinutes;

  const elapsedMinutes = priority === 'urgent'
    ? (respondedAt.getTime() - openedAt.getTime()) / 60000
    : businessMinutesBetween(openedAt, respondedAt, policy);

  return { breached: elapsedMinutes > targetMinutes ? 'yes' : 'no' };
}
