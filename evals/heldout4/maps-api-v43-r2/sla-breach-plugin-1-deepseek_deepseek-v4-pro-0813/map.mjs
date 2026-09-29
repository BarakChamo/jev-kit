const GATE = 0.8;

const DEFAULT_POLICY = {
  urgentHours: 1,
  highHours: 4,
  normalLowHours: 16,
  businessStart: 9 * 60,
  businessEnd: 17 * 60,
  holidays: ['2026-01-01', '2026-04-03', '2026-05-25', '2026-12-25'],
  aroundClockUrgent: true,
};

function getLines(ticketLog) {
  return String(ticketLog || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parsePolicy(policyText) {
  const policy = {
    ...DEFAULT_POLICY,
    holidays: new Set(DEFAULT_POLICY.holidays),
  };

  for (const line of String(policyText || '').split(/\r?\n/)) {
    if (/Urgent/.test(line)) {
      const m = line.match(/(\d+(?:\.\d+)?)\s*hours?/i);
      if (m) policy.urgentHours = parseFloat(m[1]);
      policy.aroundClockUrgent = /all days|around the clock|24/i.test(line);
    }

    if (/High:/.test(line)) {
      const m = line.match(/(\d+(?:\.\d+)?)\s*business hours?/i);
      if (m) policy.highHours = parseFloat(m[1]);
    }

    if (/Normal and Low:/.test(line)) {
      const m = line.match(/(\d+(?:\.\d+)?)\s*business hours?/i);
      if (m) policy.normalLowHours = parseFloat(m[1]);
    }

    if (/Business hours are/.test(line)) {
      const m = line.match(/(\d{2}):(\d{2})\s*to\s*(\d{2}):(\d{2})/i);
      if (m) {
        policy.businessStart = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
        policy.businessEnd = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
      }
    }

    if (/public holidays/i.test(line)) {
      const hm = line.match(/:\s*([^\n]+)/);
      if (hm) {
        const dates = hm[1].match(/\d{4}-\d{2}-\d{2}/g);
        if (dates && dates.length > 0) {
          policy.holidays = new Set(dates);
        }
      }
    }
  }

  return policy;
}

function timestampFromLine(line) {
  const m = String(line || '').match(
    /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/
  );
  if (!m) return null;

  return {
    year: parseInt(m[1], 10),
    month: parseInt(m[2], 10),
    day: parseInt(m[3], 10),
    hour: parseInt(m[4], 10),
    minute: parseInt(m[5], 10),
    second: m[6] ? parseInt(m[6], 10) : 0,
  };
}

function toDate(ts) {
  return new Date(
    Date.UTC(ts.year, ts.month - 1, ts.day, ts.hour, ts.minute, ts.second, 0)
  );
}

function dateToIso(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isBusinessDay(date, holidays) {
  const dow = date.getUTCDay();
  if (dow < 1 || dow > 5) return false;
  return !holidays.has(dateToIso(date));
}

function isBusinessTime(date, start, end) {
  const mins = date.getUTCHours() * 60 + date.getUTCMinutes();
  return mins >= start && mins < end;
}

function nextBusinessStart(date, holidays, start) {
  const startHour = Math.floor(start / 60);
  const startMinute = start % 60;

  let cur = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + 1,
      startHour,
      startMinute,
      0,
      0
    )
  );

  while (!isBusinessDay(cur, holidays)) {
    cur = new Date(
      Date.UTC(
        cur.getUTCFullYear(),
        cur.getUTCMonth(),
        cur.getUTCDate() + 1,
        startHour,
        startMinute,
        0,
        0
      )
    );
  }

  return cur;
}

function alignToBusiness(date, holidays, start, end) {
  let cur = new Date(date.getTime());
  const startHour = Math.floor(start / 60);
  const startMinute = start % 60;

  if (
    isBusinessDay(cur, holidays) &&
    cur.getUTCHours() * 60 + cur.getUTCMinutes() < start
  ) {
    cur = new Date(
      Date.UTC(
        cur.getUTCFullYear(),
        cur.getUTCMonth(),
        cur.getUTCDate(),
        startHour,
        startMinute,
        0,
        0
      )
    );
  }

  while (!(isBusinessDay(cur, holidays) && isBusinessTime(cur, start, end))) {
    cur = nextBusinessStart(cur, holidays, start);
  }

  return cur;
}

function addBusinessMinutes(openDate, minutes, holidays, start, end) {
  let cur = alignToBusiness(openDate, holidays, start, end);
  let remaining = minutes;

  while (remaining > 0) {
    const currentMinutes = cur.getUTCHours() * 60 + cur.getUTCMinutes();
    const available = end - currentMinutes;

    if (available >= remaining) {
      cur = new Date(cur.getTime() + remaining * 60000);
      remaining = 0;
    } else {
      cur = new Date(cur.getTime() + available * 60000);
      remaining -= available;
      cur = nextBusinessStart(cur, holidays, start);
    }
  }

  return cur;
}

function pickLine(answer, lines) {
  if (!answer || answer.type !== 'choice') return { abstain: true };

  const choice = String(answer.choice ?? '');
  const probability = answer.probabilities?.[choice];

  if (typeof probability !== 'number' || probability < GATE) {
    return { abstain: true };
  }

  if (choice === 'none') return { abstain: true };

  const idx = Number(choice);
  if (!Number.isInteger(idx) || idx < 0 || idx >= lines.length) {
    return { abstain: true };
  }

  return { abstain: false, line: lines[idx] };
}

export function buildState(input) {
  return {
    ticket_log: input.ticket_log,
    policy_text: input.policy_text,
  };
}

export function questions(input) {
  const lines = getLines(input.ticket_log);
  const lineCriteria = {};

  for (let i = 0; i < lines.length; i += 1) {
    lineCriteria[String(i)] = lines[i];
  }

  return {
    opened_line: {
      type: 'choice',
      instructions:
        'Which line of `ticket_log` records the ticket being opened? Use the 0-based line number from the options. If no line records the opening, choose `none`.',
      criteria: {
        ...lineCriteria,
        none: 'No line records the ticket being opened.',
      },
    },
    first_agent_reply_line: {
      type: 'choice',
      instructions:
        'Which line of `ticket_log` records the first reply from a support agent? Customer messages and automatic acknowledgements do not count. Use the 0-based line number from the options. If no support-agent reply exists, choose `none`.',
      criteria: {
        ...lineCriteria,
        none: 'No reply from a support agent exists in `ticket_log`.',
      },
    },
    opened_priority: {
      type: 'choice',
      instructions:
        'What priority does `ticket_log` state the ticket had when it was opened? Use the priority at opening, even if a later line changes it.',
      criteria: {
        urgent: 'The ticket was opened as Urgent.',
        high: 'The ticket was opened as High.',
        normal: 'The ticket was opened as Normal.',
        low: 'The ticket was opened as Low.',
      },
    },
  };
}

export function decide(answers, input) {
  const policy = parsePolicy(input.policy_text);
  const lines = getLines(input.ticket_log);

  const opened = pickLine(answers.opened_line, lines);
  if (opened.abstain) return { breached: 'abstain' };

  const agentReply = pickLine(answers.first_agent_reply_line, lines);
  if (agentReply.abstain) return { breached: 'abstain' };

  const priorityAnswer = answers.opened_priority;
  if (!priorityAnswer || priorityAnswer.type !== 'choice') {
    return { breached: 'abstain' };
  }

  const priority = String(priorityAnswer.choice ?? '');
  if (!['urgent', 'high', 'normal', 'low'].includes(priority)) {
    return { breached: 'abstain' };
  }

  const priorityProbability = priorityAnswer.probabilities?.[priority];
  if (typeof priorityProbability !== 'number' || priorityProbability < GATE) {
    return { breached: 'abstain' };
  }

  const openTs = timestampFromLine(opened.line);
  const replyTs = timestampFromLine(agentReply.line);
  if (!openTs || !replyTs) return { breached: 'abstain' };

  const openDate = toDate(openTs);
  const replyDate = toDate(replyTs);

  let targetMinutes;
  if (priority === 'urgent') {
    targetMinutes = Math.round(policy.urgentHours * 60);
  } else if (priority === 'high') {
    targetMinutes = Math.round(policy.highHours * 60);
  } else {
    targetMinutes = Math.round(policy.normalLowHours * 60);
  }

  const dueDate =
    priority === 'urgent' && policy.aroundClockUrgent
      ? new Date(openDate.getTime() + targetMinutes * 60000)
      : addBusinessMinutes(
          openDate,
          targetMinutes,
          policy.holidays,
          policy.businessStart,
          policy.businessEnd
        );

  return {
    breached: replyDate.getTime() > dueDate.getTime() ? 'yes' : 'no',
  };
}
