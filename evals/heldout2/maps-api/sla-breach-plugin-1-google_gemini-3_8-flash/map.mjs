function getLines(ticketLog) {
  return (ticketLog || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function extractDate(line) {
  if (!line) return null;

  const ampmMatch = line.match(/\b(am|pm)\b/i);
  const isPM = ampmMatch && ampmMatch[1].toLowerCase() === 'pm';
  const isAM = ampmMatch && ampmMatch[1].toLowerCase() === 'am';

  // ISO: YYYY-MM-DD or YYYY/MM/DD with HH:MM(:SS)?
  const iso = line.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})[T ]+(\d{1,2}):(\d{2})(?::(\d{2}))?/i);
  if (iso) {
    let hour = parseInt(iso[4], 10);
    if (isPM && hour < 12) hour += 12;
    if (isAM && hour === 12) hour = 0;
    return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3], hour, +iso[5], +(iso[6] || 0)));
  }

  // Month name formats (e.g. 06 Mar 2026 or March 6, 2026)
  const monthMap = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const m1 = line.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/i);
  if (m1) {
    const mon = monthMap[m1[2].slice(0, 3).toLowerCase()];
    if (mon !== undefined) {
      let hour = parseInt(m1[4], 10);
      if (isPM && hour < 12) hour += 12;
      if (isAM && hour === 12) hour = 0;
      return new Date(Date.UTC(+m1[3], mon, +m1[1], hour, +m1[5], +(m1[6] || 0)));
    }
  }

  const m2 = line.match(/\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/i);
  if (m2) {
    const mon = monthMap[m2[1].slice(0, 3).toLowerCase()];
    if (mon !== undefined) {
      let hour = parseInt(m2[4], 10);
      if (isPM && hour < 12) hour += 12;
      if (isAM && hour === 12) hour = 0;
      return new Date(Date.UTC(+m2[3], mon, +m2[2], hour, +m2[5], +(m2[6] || 0)));
    }
  }

  return null;
}

function parsePolicy(policyText) {
  let bhStart = 9;
  let bhEnd = 17;
  const bhMatch = policyText.match(/(\d{1,2}):(\d{2})\s*(?:to|-)\s*(\d{1,2}):(\d{2})\s*UTC/i);
  if (bhMatch) {
    bhStart = parseInt(bhMatch[1], 10) + parseInt(bhMatch[2], 10) / 60;
    bhEnd = parseInt(bhMatch[3], 10) + parseInt(bhMatch[4], 10) / 60;
  }
  const bhPerDay = bhEnd - bhStart;

  const holidayMatches = policyText.match(/\b\d{4}[-/]\d{2}[-/]\d{2}\b/g) || [];
  const holidays = new Set(holidayMatches.map((h) => h.replace(/\//g, '-')));

  const targets = {
    urgent: { hours: 1, calendar: true },
    high: { hours: 4, calendar: false },
    normal: { hours: 16, calendar: false },
    low: { hours: 16, calendar: false },
  };

  const lines = policyText.split(/\r?\n/);
  for (const line of lines) {
    const l = line.toLowerCase();
    for (const p of ['urgent', 'high', 'normal', 'low']) {
      if (l.includes(p)) {
        const isCalendar = /around the clock|all days|calendar|24\/7/.test(l);
        const mHours = l.match(/within\s+(\d+)\s*(?:business\s+)?hours?/);
        const mDays = l.match(/within\s+(\d+)\s*(?:business\s+)?days?/);
        if (mHours) {
          targets[p] = { hours: parseInt(mHours[1], 10), calendar: isCalendar };
        } else if (mDays) {
          targets[p] = { hours: parseInt(mDays[1], 10) * bhPerDay, calendar: isCalendar };
        }
      }
    }
  }

  return { bhStart, bhEnd, holidays, targets };
}

function computeBusinessHours(start, end, bhStart, bhEnd, holidays) {
  if (end <= start) return 0;

  let totalMs = 0;
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endLimit = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));

  while (cur <= endLimit) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, '0');
    const d = String(cur.getUTCDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;
    const dayOfWeek = cur.getUTCDay();

    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isHoliday = holidays.has(dateStr);

    if (!isWeekend && !isHoliday) {
      const bhStartMs = Date.UTC(y, cur.getUTCMonth(), cur.getUTCDate(), Math.floor(bhStart), (bhStart % 1) * 60);
      const bhEndMs = Date.UTC(y, cur.getUTCMonth(), cur.getUTCDate(), Math.floor(bhEnd), (bhEnd % 1) * 60);

      const wStart = Math.max(start.getTime(), bhStartMs);
      const wEnd = Math.min(end.getTime(), bhEndMs);

      if (wEnd > wStart) {
        totalMs += (wEnd - wStart);
      }
    }

    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  return totalMs / (1000 * 60 * 60);
}

export function buildState(input) {
  const lines = getLines(input?.ticket_log);
  return {
    policy_text: input?.policy_text || '',
    ticket_log: input?.ticket_log || '',
    ticket_lines: lines,
  };
}

export function questions(input) {
  const lines = getLines(input?.ticket_log).slice(0, 250);
  const lineCriteria = Object.fromEntries(
    lines.map((text, idx) => [String(idx), text.slice(0, 150)])
  );

  return {
    priority: {
      type: 'choice',
      instructions: 'What priority was assigned to the ticket in `ticket_log` at the time it was opened? Under `policy_text`, the initial priority at opening applies even if changed later.',
      criteria: {
        urgent: 'Urgent / Critical / P1',
        high: 'High / P2',
        normal: 'Normal / Medium / P3',
        low: 'Low / Minor / P4',
        unknown: 'No priority specified at opening, or priority is ambiguous',
      },
    },
    opened_line: {
      type: 'choice',
      instructions: 'Which line of `ticket_lines` records when the ticket was opened or created?',
      criteria: {
        ...lineCriteria,
        none: 'No ticket opening event appears in `ticket_lines`',
      },
    },
    first_response_line: {
      type: 'choice',
      instructions: 'Which line of `ticket_lines` contains the first reply sent by a human support agent to the customer? Exclude automatic acknowledgements, bot messages, customer replies, internal notes, and ticket creation lines.',
      criteria: {
        ...lineCriteria,
        none: 'No reply from a human support agent appears in `ticket_lines`',
      },
    },
  };
}

export function decide(answers, input) {
  if (!answers || !input) return { breached: 'abstain' };

  const lines = getLines(input.ticket_log);
  if (lines.length === 0) return { breached: 'abstain' };

  // 1. Resolve ticket priority at opening with gating
  const prioAns = answers.priority;
  const prioChoice = prioAns?.choice;
  const prioProb = prioAns?.probabilities?.[prioChoice] ?? prioAns?.confidence ?? 0;

  let priority = prioChoice;
  if (!priority || priority === 'unknown' || prioProb < 0.7) {
    const match = input.ticket_log.match(/ticket opened[^\n]*priority\s*(urgent|high|normal|low)/i);
    if (match) {
      priority = match[1].toLowerCase();
    } else {
      return { breached: 'abstain' };
    }
  }

  // 2. Resolve opening timestamp
  const openAns = answers.opened_line;
  const openChoice = openAns?.choice;
  const openProb = openAns?.probabilities?.[openChoice] ?? openAns?.confidence ?? 0;

  let openIdx = parseInt(openChoice, 10);
  if (isNaN(openIdx) || openProb < 0.7 || openIdx >= lines.length) {
    const foundIdx = lines.findIndex((l) => /ticket opened|created|submitted/i.test(l));
    openIdx = foundIdx !== -1 ? foundIdx : 0;
  }

  const startDate = extractDate(lines[openIdx]);
  if (!startDate) return { breached: 'abstain' };

  // 3. Resolve SLA configuration from policy
  const policy = parsePolicy(input.policy_text || '');
  const target = policy.targets[priority.toLowerCase()];
  if (!target) return { breached: 'abstain' };

  // 4. Resolve first response timestamp
  const respAns = answers.first_response_line;
  const respChoice = respAns?.choice;
  const respProb = respAns?.probabilities?.[respChoice] ?? respAns?.confidence ?? 0;

  if (!respChoice || respProb < 0.7) return { breached: 'abstain' };

  if (respChoice === 'none') {
    // No agent reply found: check if the latest logged timestamp already exceeded SLA target
    const dates = lines.map(extractDate).filter(Boolean);
    const latestDate = dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : startDate;

    const elapsed = target.calendar
      ? (latestDate.getTime() - startDate.getTime()) / (1000 * 60 * 60)
      : computeBusinessHours(startDate, latestDate, policy.bhStart, policy.bhEnd, policy.holidays);

    if (elapsed > target.hours) {
      return { breached: 'yes' };
    }
    return { breached: 'abstain' };
  }

  const respIdx = parseInt(respChoice, 10);
  if (isNaN(respIdx) || respIdx >= lines.length) return { breached: 'abstain' };

  const respDate = extractDate(lines[respIdx]);
  if (!respDate || respDate < startDate) return { breached: 'abstain' };

  // 5. Compute elapsed time under SLA rules and compare
  const elapsed = target.calendar
    ? (respDate.getTime() - startDate.getTime()) / (1000 * 60 * 60)
    : computeBusinessHours(startDate, respDate, policy.bhStart, policy.bhEnd, policy.holidays);

  return { breached: elapsed <= target.hours + 1e-6 ? 'no' : 'yes' };
}
