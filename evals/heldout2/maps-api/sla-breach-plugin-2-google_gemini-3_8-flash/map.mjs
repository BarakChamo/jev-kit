export function buildState(input) {
  const lines = (input?.ticket_log || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  return {
    policy_text: input?.policy_text || '',
    ticket_log: input?.ticket_log || '',
    ticket_lines: lines,
  };
}

export function questions(input) {
  const lines = (input?.ticket_log || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 250);

  const lineCriteria = Object.fromEntries(lines.map((text, i) => [String(i), text]));

  return {
    opened_line: {
      type: 'choice',
      instructions:
        'Which line in `ticket_lines` records when the ticket was created or opened by the customer?',
      criteria: {
        ...lineCriteria,
        ambiguous: 'Cannot determine which line records the ticket opening',
      },
    },
    initial_priority: {
      type: 'choice',
      instructions:
        'What was the priority of the ticket at the time it was opened, according to `ticket_log` and `policy_text`? Note that the priority when opened applies even if changed later.',
      criteria: {
        urgent: 'Urgent priority when the ticket was opened',
        high: 'High priority when the ticket was opened',
        normal: 'Normal priority when the ticket was opened',
        low: 'Low priority when the ticket was opened',
        ambiguous: 'The initial priority cannot be determined, is unstated, or is conflicting',
      },
    },
    first_response_line: {
      type: 'choice',
      instructions:
        'Which line in `ticket_lines` is the first qualifying response from a support agent? Under `policy_text`, only a reply from a human support agent counts; customer messages, automatic acknowledgements, bot messages, and system notifications do not count.',
      criteria: {
        ...lineCriteria,
        no_agent_reply: 'There is no qualifying response from a support agent anywhere in `ticket_lines`',
        ambiguous: 'It is ambiguous or uncertain which line, if any, is a qualifying response from a support agent',
      },
    },
  };
}

function parseTimestamp(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(/(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const min = parseInt(match[5], 10);
  const sec = match[6] ? parseInt(match[6], 10) : 0;
  const date = new Date(Date.UTC(year, month, day, hour, min, sec));
  return isNaN(date.getTime()) ? null : date;
}

function parsePolicy(policyText = '') {
  let bhStartHour = 9;
  let bhStartMin = 0;
  let bhEndHour = 17;
  let bhEndMin = 0;

  const bhMatch = policyText.match(/(\d{1,2}):(\d{2})\s*to\s*(\d{1,2}):(\d{2})/i);
  if (bhMatch) {
    bhStartHour = parseInt(bhMatch[1], 10);
    bhStartMin = parseInt(bhMatch[2], 10);
    bhEndHour = parseInt(bhMatch[3], 10);
    bhEndMin = parseInt(bhMatch[4], 10);
  }

  const holidays = new Set(policyText.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [
    '2026-01-01',
    '2026-04-03',
    '2026-05-25',
    '2026-12-25',
  ]);

  const targets = {
    urgent: { minutes: 60, aroundTheClock: true },
    high: { minutes: 4 * 60, aroundTheClock: false },
    normal: { minutes: 16 * 60, aroundTheClock: false },
    low: { minutes: 16 * 60, aroundTheClock: false },
  };

  const urgentMatch = policyText.match(/urgent:[^\n]*?(\d+)\s*hour/i);
  if (urgentMatch) {
    const hrs = parseInt(urgentMatch[1], 10);
    const roundTheClock = /around the clock|all hours|all days|24\/7|calendar/i.test(urgentMatch[0]);
    targets.urgent = { minutes: hrs * 60, aroundTheClock: roundTheClock };
  }

  const highMatch = policyText.match(/high:[^\n]*?(\d+)\s*(?:business\s*)?hour/i);
  if (highMatch) {
    targets.high = { minutes: parseInt(highMatch[1], 10) * 60, aroundTheClock: false };
  }

  const normalMatch = policyText.match(/normal[^\n]*?(\d+)\s*(business\s*days?|hours?)/i);
  if (normalMatch) {
    const val = parseInt(normalMatch[1], 10);
    const isDays = normalMatch[2].toLowerCase().includes('day');
    const hoursPerDay = bhEndHour - bhStartHour;
    targets.normal = { minutes: val * (isDays ? hoursPerDay : 1) * 60, aroundTheClock: false };
  }

  const lowMatch = policyText.match(/low:[^\n]*?(\d+)\s*(business\s*days?|hours?)/i);
  if (lowMatch) {
    const val = parseInt(lowMatch[1], 10);
    const isDays = lowMatch[2].toLowerCase().includes('day');
    const hoursPerDay = bhEndHour - bhStartHour;
    targets.low = { minutes: val * (isDays ? hoursPerDay : 1) * 60, aroundTheClock: false };
  } else if (/normal\s+and\s+low/i.test(policyText)) {
    targets.low = { ...targets.normal };
  }

  return { bhStartHour, bhStartMin, bhEndHour, bhEndMin, holidays, targets };
}

function computeElapsedMinutes(start, end, policy, aroundTheClock) {
  if (end < start) return -1;
  if (aroundTheClock) {
    return (end.getTime() - start.getTime()) / (60 * 1000);
  }

  const { bhStartHour, bhStartMin, bhEndHour, bhEndMin, holidays } = policy;
  let totalMinutes = 0;

  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));

  while (cur <= endDay) {
    const dayOfWeek = cur.getUTCDay();
    const dateStr = cur.toISOString().slice(0, 10);

    if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidays.has(dateStr)) {
      const dayStartMs = Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), cur.getUTCDate(), bhStartHour, bhStartMin);
      const dayEndMs = Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), cur.getUTCDate(), bhEndHour, bhEndMin);

      const activeStart = Math.max(dayStartMs, start.getTime());
      const activeEnd = Math.min(dayEndMs, end.getTime());

      if (activeEnd > activeStart) {
        totalMinutes += (activeEnd - activeStart) / (60 * 1000);
      }
    }

    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  return totalMinutes;
}

export function decide(answers, input) {
  if (!answers) return { breached: 'abstain' };

  const prio = answers.initial_priority;
  if (!prio) return { breached: 'abstain' };
  const prioChoice = prio.choice;
  const prioProb = prio.probabilities?.[prioChoice] ?? prio.confidence ?? 0;
  if (prioChoice === 'ambiguous' || prioProb < 0.75) {
    return { breached: 'abstain' };
  }

  const resp = answers.first_response_line;
  if (!resp) return { breached: 'abstain' };
  const respChoice = resp.choice;
  const respProb = resp.probabilities?.[respChoice] ?? resp.confidence ?? 0;
  if (respChoice === 'ambiguous' || respProb < 0.75) {
    return { breached: 'abstain' };
  }

  const lines = (input?.ticket_log || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let openedIdx = 0;
  const openAns = answers.opened_line;
  if (openAns) {
    const openChoice = openAns.choice;
    const openProb = openAns.probabilities?.[openChoice] ?? openAns.confidence ?? 0;
    if (openChoice === 'ambiguous' || openProb < 0.75) {
      return { breached: 'abstain' };
    }
    const parsedIdx = parseInt(openChoice, 10);
    if (!isNaN(parsedIdx) && parsedIdx >= 0 && parsedIdx < lines.length) {
      openedIdx = parsedIdx;
    }
  }

  const openedTime = parseTimestamp(lines[openedIdx]) || parseTimestamp(lines[0]);
  if (!openedTime) return { breached: 'abstain' };

  const policy = parsePolicy(input?.policy_text || '');
  const target = policy.targets[prioChoice];
  if (!target) return { breached: 'abstain' };

  if (respChoice === 'no_agent_reply') {
    let latestTime = openedTime;
    for (const line of lines) {
      const ts = parseTimestamp(line);
      if (ts && ts > latestTime) latestTime = ts;
    }
    const elapsed = computeElapsedMinutes(openedTime, latestTime, policy, target.aroundTheClock);
    if (elapsed > target.minutes) {
      return { breached: 'yes' };
    }
    return { breached: 'abstain' };
  }

  const replyIdx = parseInt(respChoice, 10);
  if (isNaN(replyIdx) || replyIdx < 0 || replyIdx >= lines.length) {
    return { breached: 'abstain' };
  }

  const replyTime = parseTimestamp(lines[replyIdx]);
  if (!replyTime || replyTime < openedTime) {
    return { breached: 'abstain' };
  }

  const elapsedMinutes = computeElapsedMinutes(openedTime, replyTime, policy, target.aroundTheClock);
  if (elapsedMinutes < 0) return { breached: 'abstain' };

  return { breached: elapsedMinutes > target.minutes ? 'yes' : 'no' };
}
