function getLines(input) {
  if (!input || typeof input.ticket_log !== 'string') return [];
  return input.ticket_log
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function parseTimestamp(line) {
  if (typeof line !== 'string') return null;
  const iso = line.match(/(\d{4})[-/](\d{2})[-/](\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (iso) {
    const [, y, m, d, hh, mm, ss] = iso;
    return new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm, +(ss || 0)));
  }
  const prefix = line.split(/[-–—:]\s+/)[0];
  const dt = new Date(prefix.includes('UTC') || prefix.endsWith('Z') ? prefix : prefix + ' UTC');
  return isNaN(dt.getTime()) ? null : dt;
}

function parsePolicy(policyText) {
  const p = {
    urgentMinutes: 60,
    urgentAroundClock: true,
    highMinutes: 4 * 60,
    normalMinutes: 16 * 60,
    lowMinutes: 16 * 60,
    startHour: 9,
    startMinute: 0,
    endHour: 17,
    endMinute: 0,
    holidays: new Set(['2026-01-01', '2026-04-03', '2026-05-25', '2026-12-25']),
  };
  if (!policyText || typeof policyText !== 'string') return p;

  const holidayMatch = policyText.match(/holidays?:?\s*([^\n.]+)/i);
  if (holidayMatch) {
    const dates = holidayMatch[1].match(/\d{4}-\d{2}-\d{2}/g);
    if (dates && dates.length > 0) p.holidays = new Set(dates);
  }

  const hoursMatch = policyText.match(/(\d{1,2}):(\d{2})\s*(?:to|-)\s*(\d{1,2}):(\d{2})\s*UTC/i);
  if (hoursMatch) {
    p.startHour = parseInt(hoursMatch[1], 10);
    p.startMinute = parseInt(hoursMatch[2], 10);
    p.endHour = parseInt(hoursMatch[3], 10);
    p.endMinute = parseInt(hoursMatch[4], 10);
  }

  const urgentMatch = policyText.match(/urgent[^\n]*?within\s+(\d+)\s*(hour|minute|day)/i);
  if (urgentMatch) {
    const val = parseInt(urgentMatch[1], 10);
    const unit = urgentMatch[2].toLowerCase();
    p.urgentMinutes = unit.startsWith('hour') ? val * 60 : unit.startsWith('day') ? val * 1440 : val;
    p.urgentAroundClock = /around the clock|24\/7|all days|all hours/i.test(urgentMatch[0]);
  }

  const highMatch = policyText.match(/high[^\n]*?within\s+(\d+)\s*(business\s+hour|business\s+day|hour|day)/i);
  if (highMatch) {
    const val = parseInt(highMatch[1], 10);
    const unit = highMatch[2].toLowerCase();
    const dayHours = p.endHour - p.startHour;
    p.highMinutes = unit.includes('day') ? val * dayHours * 60 : val * 60;
  }

  const normMatch = policyText.match(/(?:normal\s+and\s+low|normal)[^\n]*?within\s+(\d+)\s*(business\s+hour|business\s+day|hour|day)/i);
  if (normMatch) {
    const val = parseInt(normMatch[1], 10);
    const unit = normMatch[2].toLowerCase();
    const dayHours = p.endHour - p.startHour;
    const mins = unit.includes('day') ? val * dayHours * 60 : val * 60;
    p.normalMinutes = mins;
    p.lowMinutes = mins;
  }

  const normParen = policyText.match(/(?:normal\s+and\s+low|normal)[^\n]*?\((\d+)\s*business\s*hours\)/i);
  if (normParen) {
    const mins = parseInt(normParen[1], 10) * 60;
    p.normalMinutes = mins;
    p.lowMinutes = mins;
  }

  return p;
}

function getBusinessMinutes(startDate, endDate, policy) {
  if (endDate <= startDate) return 0;
  let current = new Date(startDate.getTime());
  let totalMinutes = 0;

  while (current < endDate) {
    const year = current.getUTCFullYear();
    const month = String(current.getUTCMonth() + 1).padStart(2, '0');
    const day = String(current.getUTCDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    const dayOfWeek = current.getUTCDay();

    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isHoliday = policy.holidays.has(dateStr);

    if (!isWeekend && !isHoliday) {
      const windowStart = new Date(Date.UTC(year, current.getUTCMonth(), current.getUTCDate(), policy.startHour, policy.startMinute));
      const windowEnd = new Date(Date.UTC(year, current.getUTCMonth(), current.getUTCDate(), policy.endHour, policy.endMinute));
      const endOfDay = new Date(Date.UTC(year, current.getUTCMonth(), current.getUTCDate() + 1, 0, 0));
      const chunkEnd = endDate < endOfDay ? endDate : endOfDay;

      const overlapStart = Math.max(current.getTime(), windowStart.getTime());
      const overlapEnd = Math.min(chunkEnd.getTime(), windowEnd.getTime());

      if (overlapEnd > overlapStart) {
        totalMinutes += (overlapEnd - overlapStart) / 60000;
      }
      current = endOfDay;
    } else {
      current = new Date(Date.UTC(year, current.getUTCMonth(), current.getUTCDate() + 1, 0, 0));
    }
  }

  return totalMinutes;
}

function getProb(answer, choice) {
  if (!answer) return 0;
  if (answer.probabilities && choice in answer.probabilities) {
    return answer.probabilities[choice];
  }
  return answer.confidence ?? 0;
}

export function buildState(input) {
  const lines = getLines(input);
  return {
    policy_text: input?.policy_text ?? '',
    ticket_log: input?.ticket_log ?? '',
    lines,
  };
}

export function questions(input) {
  const lines = getLines(input);
  const lineEntries = Object.fromEntries(lines.slice(0, 250).map((l, i) => [String(i), l]));

  return {
    opened_line: {
      type: 'choice',
      instructions:
        'Which line of `lines` records when the ticket was opened or created by the customer?',
      criteria: {
        ...lineEntries,
        none: 'No ticket opening line exists in `lines`',
        ambiguous: 'Genuinely ambiguous which line records the opening of the ticket',
      },
    },
    first_agent_reply_line: {
      type: 'choice',
      instructions:
        'Which line of `lines` is the first response sent by a human support agent? Per `policy_text`, customer messages and automatic acknowledgements do not count as a first response.',
      criteria: {
        ...lineEntries,
        none: 'No qualifying response from a support agent appears in `lines`',
        ambiguous: 'Genuinely ambiguous which line (if any) is a qualifying agent response',
      },
    },
    initial_priority: {
      type: 'choice',
      instructions:
        'What was the priority assigned to the ticket when it was opened, according to `ticket_log` and `policy_text`? Per `policy_text`, the priority at the time of opening applies even if it changed later.',
      criteria: {
        urgent: 'Urgent priority',
        high: 'High priority',
        normal: 'Normal priority',
        low: 'Low priority',
        ambiguous: 'The initial priority is not stated, unclear, or outside Urgent/High/Normal/Low',
      },
    },
  };
}

export function decide(answers, input) {
  if (!answers) return { breached: 'abstain' };

  const lines = getLines(input);
  const openedAns = answers.opened_line;
  const replyAns = answers.first_agent_reply_line;
  const prioAns = answers.initial_priority;

  if (!openedAns || !replyAns || !prioAns) return { breached: 'abstain' };

  const openedChoice = openedAns.choice;
  const replyChoice = replyAns.choice;
  const prioChoice = prioAns.choice;

  const GATE = 0.65;
  if (
    getProb(openedAns, openedChoice) < GATE ||
    getProb(replyAns, replyChoice) < GATE ||
    getProb(prioAns, prioChoice) < GATE
  ) {
    return { breached: 'abstain' };
  }

  if (openedChoice === 'ambiguous' || openedChoice === 'none') {
    return { breached: 'abstain' };
  }
  if (prioChoice === 'ambiguous') {
    return { breached: 'abstain' };
  }
  if (replyChoice === 'ambiguous') {
    return { breached: 'abstain' };
  }

  const openedIdx = parseInt(openedChoice, 10);
  if (isNaN(openedIdx) || openedIdx < 0 || openedIdx >= lines.length) {
    return { breached: 'abstain' };
  }

  const openedTime = parseTimestamp(lines[openedIdx]);
  if (!openedTime) return { breached: 'abstain' };

  const policy = parsePolicy(input?.policy_text);

  let targetMinutes;
  let is247 = false;
  if (prioChoice === 'urgent') {
    targetMinutes = policy.urgentMinutes;
    is247 = policy.urgentAroundClock;
  } else if (prioChoice === 'high') {
    targetMinutes = policy.highMinutes;
  } else if (prioChoice === 'normal') {
    targetMinutes = policy.normalMinutes;
  } else if (prioChoice === 'low') {
    targetMinutes = policy.lowMinutes;
  } else {
    return { breached: 'abstain' };
  }

  if (replyChoice === 'none') {
    let latestTime = null;
    for (const line of lines) {
      const t = parseTimestamp(line);
      if (t && (!latestTime || t > latestTime)) latestTime = t;
    }
    if (!latestTime || latestTime <= openedTime) return { breached: 'abstain' };

    const elapsed = is247
      ? (latestTime.getTime() - openedTime.getTime()) / 60000
      : getBusinessMinutes(openedTime, latestTime, policy);

    return elapsed > targetMinutes ? { breached: 'yes' } : { breached: 'abstain' };
  }

  const replyIdx = parseInt(replyChoice, 10);
  if (isNaN(replyIdx) || replyIdx < 0 || replyIdx >= lines.length) {
    return { breached: 'abstain' };
  }

  const replyTime = parseTimestamp(lines[replyIdx]);
  if (!replyTime || replyTime < openedTime) return { breached: 'abstain' };

  const elapsedMinutes = is247
    ? (replyTime.getTime() - openedTime.getTime()) / 60000
    : getBusinessMinutes(openedTime, replyTime, policy);

  return { breached: elapsedMinutes > targetMinutes ? 'yes' : 'no' };
}
