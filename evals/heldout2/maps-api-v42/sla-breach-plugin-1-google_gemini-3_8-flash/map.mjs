export function buildState(input) {
  const lines = (input.ticket_log || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  return {
    policy_text: input.policy_text || '',
    ticket_log: input.ticket_log || '',
    lines,
  };
}

export function questions(input) {
  const lines = (input.ticket_log || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const lineCriteria = {};
  for (let i = 0; i < Math.min(lines.length, 250); i++) {
    lineCriteria[String(i)] = lines[i].slice(0, 200);
  }

  return {
    initial_priority: {
      type: 'choice',
      instructions:
        'What was the priority of the ticket when it was opened, according to `ticket_log`? Under `policy_text`, the priority when opened applies even if it is changed later.',
      criteria: {
        urgent: 'Urgent, P1, or Critical priority when opened',
        high: 'High or P2 priority when opened',
        normal: 'Normal, Medium, Standard, or P3 priority when opened',
        low: 'Low, Minor, or P4 priority when opened',
        ambiguous: 'The priority when opened is missing, unclear, or ambiguous',
      },
    },
    opened_line: {
      type: 'choice',
      instructions:
        'Which line index in `lines` records when the ticket was opened or created?',
      criteria: {
        ...lineCriteria,
        none: 'No ticket creation or opening event is present in `lines`',
      },
    },
    first_agent_reply: {
      type: 'choice',
      instructions:
        'Which line index in `lines` is the FIRST response sent by a human support agent? Under `policy_text`, customer messages and automated acknowledgements do not count.',
      criteria: {
        ...lineCriteria,
        none: 'No reply from a human support agent is present in `lines`',
        ambiguous: 'Genuinely ambiguous whether any line is an agent reply',
      },
    },
  };
}

export function decide(answers, input) {
  const lines = (input.ticket_log || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const prioChoice = answers?.initial_priority?.choice;
  const prioProb = answers?.initial_priority?.probabilities?.[prioChoice] ?? 0;
  if (!prioChoice || prioChoice === 'ambiguous' || prioProb < 0.6) {
    return { breached: 'abstain' };
  }

  const agentChoice = answers?.first_agent_reply?.choice;
  const agentProb = answers?.first_agent_reply?.probabilities?.[agentChoice] ?? 0;
  if (!agentChoice || agentChoice === 'ambiguous' || agentProb < 0.6) {
    return { breached: 'abstain' };
  }

  let openIdx = answers?.opened_line?.choice;
  if (!openIdx || openIdx === 'none' || !(openIdx in lines)) {
    openIdx = 0;
  }

  const openTime = parseTimestamp(lines[openIdx]) || parseTimestamp(lines[0]);
  if (!openTime) {
    return { breached: 'abstain' };
  }

  const policyText = input.policy_text || '';
  const target = getTarget(prioChoice, policyText);
  if (!target) {
    return { breached: 'abstain' };
  }

  const holidays = getHolidays(policyText);
  const bh = getBusinessHours(policyText);

  if (agentChoice === 'none') {
    const lastTime = findLatestTimestamp(lines);
    if (!lastTime) return { breached: 'abstain' };

    const elapsedMs =
      target.type === 'calendar'
        ? lastTime.getTime() - openTime.getTime()
        : computeBusinessMs(openTime, lastTime, bh, holidays);

    return elapsedMs > target.ms ? { breached: 'yes' } : { breached: 'abstain' };
  }

  const replyIdx = parseInt(agentChoice, 10);
  const replyTime = parseTimestamp(lines[replyIdx]);
  if (!replyTime || replyTime.getTime() < openTime.getTime()) {
    return { breached: 'abstain' };
  }

  const elapsedMs =
    target.type === 'calendar'
      ? replyTime.getTime() - openTime.getTime()
      : computeBusinessMs(openTime, replyTime, bh, holidays);

  return { breached: elapsedMs > target.ms ? 'yes' : 'no' };
}

function parseTimestamp(str) {
  if (!str) return null;
  const iso = str.match(/\b(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (iso) {
    const [, y, m, d, hh, mm, ss] = iso;
    return new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm, +(ss || 0)));
  }

  const word = str.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})\s+(\d{1,2}):(\d{2})/i
  );
  if (word) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const mon = months.indexOf(word[1].slice(0, 3).toLowerCase());
    return new Date(Date.UTC(+word[3], mon, +word[2], +word[4], +word[5], 0));
  }

  return null;
}

function findLatestTimestamp(lines) {
  let latest = null;
  for (const line of lines) {
    const t = parseTimestamp(line);
    if (t && (!latest || t.getTime() > latest.getTime())) {
      latest = t;
    }
  }
  return latest;
}

function getHolidays(policyText) {
  const holidays = new Set(['2026-01-01', '2026-04-03', '2026-05-25', '2026-12-25']);
  if (!policyText) return holidays;
  const holMatch = policyText.match(/holidays?:?\s*([^\n.]+)/i);
  if (holMatch) {
    const dates = holMatch[1].match(/\b\d{4}-\d{2}-\d{2}\b/g);
    if (dates?.length) return new Set(dates);
  }
  return holidays;
}

function getBusinessHours(policyText) {
  let startH = 9,
    startM = 0,
    endH = 17,
    endM = 0;
  if (!policyText) return { startH, startM, endH, endM };
  const m = policyText.match(/(\d{1,2}):(\d{2})\s*(?:to|-)\s*(\d{1,2}):(\d{2})/);
  if (m) {
    startH = parseInt(m[1], 10);
    startM = parseInt(m[2], 10);
    endH = parseInt(m[3], 10);
    endM = parseInt(m[4], 10);
  }
  return { startH, startM, endH, endM };
}

function getTarget(priority, policyText) {
  if (priority === 'urgent') {
    let hours = 1;
    const m = policyText.match(/urgent[^\n:]*:[^\n]*?(\d+)\s*hour/i);
    if (m) hours = parseInt(m[1], 10);
    return { type: 'calendar', ms: hours * 3600 * 1000 };
  }

  if (priority === 'high') {
    let hours = 4;
    const m = policyText.match(/high[^\n:]*:[^\n]*?(\d+)\s*business\s*hour/i);
    if (m) hours = parseInt(m[1], 10);
    return { type: 'business', ms: hours * 3600 * 1000 };
  }

  if (priority === 'normal' || priority === 'low') {
    let hours = 16;
    const m = policyText.match(/(?:normal|low)[^\n:]*:[^\n]*?(\d+)\s*business\s*hour/i);
    if (m) hours = parseInt(m[1], 10);
    return { type: 'business', ms: hours * 3600 * 1000 };
  }

  return null;
}

function computeBusinessMs(start, end, bh, holidays) {
  if (end.getTime() <= start.getTime()) return 0;

  let totalMs = 0;
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endLimit = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));

  while (cur.getTime() <= endLimit.getTime()) {
    const dayOfWeek = cur.getUTCDay();
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, '0');
    const d = String(cur.getUTCDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;

    if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidays.has(dateStr)) {
      const windowStart = new Date(Date.UTC(y, cur.getUTCMonth(), cur.getUTCDate(), bh.startH, bh.startM, 0));
      const windowEnd = new Date(Date.UTC(y, cur.getUTCMonth(), cur.getUTCDate(), bh.endH, bh.endM, 0));

      const effStart = Math.max(windowStart.getTime(), start.getTime());
      const effEnd = Math.min(windowEnd.getTime(), end.getTime());

      if (effEnd > effStart) {
        totalMs += effEnd - effStart;
      }
    }

    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  return totalMs;
}
