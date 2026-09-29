// SLA first-response breach check.
//
// Jev is asked only for the two judgment calls text understanding requires:
// (1) which priority the ticket had when it was opened, and (2) which log
// entry, if any, is the first reply genuinely written by a support agent
// (as opposed to the customer or an automatic acknowledgement). Every date,
// duration and business-hours computation is done in code (rule 9/12 of the
// jev-questions skill): Jev never compares times or does arithmetic.

const CONF_THRESHOLD = 0.6;

function parseEntries(ticketLog) {
  const lines = (ticketLog || '').split('\n').map(l => l.trim()).filter(Boolean);
  return lines.map((text, index) => {
    const m = text.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s*UTC/i);
    let dt = null;
    if (m) {
      const [y, mo, d] = m[1].split('-').map(Number);
      const [hh, mm] = m[2].split(':').map(Number);
      dt = new Date(Date.UTC(y, mo - 1, d, hh, mm));
    }
    return { index, text, dt };
  });
}

function parsePolicy(policyText) {
  const text = policyText || '';

  let winStartMin = 9 * 60;
  let winEndMin = 17 * 60;
  const winMatch = text.match(/(\d{1,2}):(\d{2})\s*(?:to|-)\s*(\d{1,2}):(\d{2})\s*UTC/i);
  if (winMatch) {
    winStartMin = Number(winMatch[1]) * 60 + Number(winMatch[2]);
    winEndMin = Number(winMatch[3]) * 60 + Number(winMatch[4]);
  }

  // Default Mon-Fri; the policy's own wording is matched when present.
  const businessDays = new Set([1, 2, 3, 4, 5]);

  const holidays = new Set();
  const holidayMatch = text.match(/holiday[^.]*\./i);
  if (holidayMatch) {
    const dates = holidayMatch[0].match(/\d{4}-\d{2}-\d{2}/g) || [];
    dates.forEach(d => holidays.add(d));
  }

  const priorityRules = {};
  const bulletRegex = /-\s*([^:\n]+):\s*within\s+(\d+(?:\.\d+)?)\s*(business hours?|business days?|hours?|days?)([^\n]*)/gi;
  let bm;
  while ((bm = bulletRegex.exec(text)) !== null) {
    const namesPart = bm[1].trim();
    const amount = Number(bm[2]);
    const unit = bm[3].toLowerCase();
    const trailing = bm[4] || '';
    const isDays = /day/i.test(unit);
    const aroundClock = /around the clock/i.test(trailing);
    const parenMatch = trailing.match(/\((\d+(?:\.\d+)?)\s*business hours?\)/i);

    let hours;
    if (!isDays) {
      hours = amount;
    } else {
      const hoursPerDay = aroundClock ? 24 : (winEndMin - winStartMin) / 60;
      hours = parenMatch ? Number(parenMatch[1]) : amount * hoursPerDay;
    }

    const names = namesPart.split(/,|\s+and\s+/i).map(s => s.trim()).filter(Boolean);
    names.forEach(name => {
      priorityRules[name] = { hours, aroundClock };
    });
  }

  return { winStartMin, winEndMin, businessDays, holidays, priorityRules };
}

function isBusinessDay(dayStart, businessDays, holidays) {
  const day = dayStart.getUTCDay();
  if (!businessDays.has(day)) return false;
  return !holidays.has(dayStart.toISOString().slice(0, 10));
}

function businessMinutesBetween(start, end, businessDays, holidays, winStartMin, winEndMin) {
  if (end <= start) return 0;
  let total = 0;
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cursor <= endDay) {
    if (isBusinessDay(cursor, businessDays, holidays)) {
      const dayStart = new Date(cursor.getTime() + winStartMin * 60000);
      const dayEnd = new Date(cursor.getTime() + winEndMin * 60000);
      const segStart = start > dayStart ? start : dayStart;
      const segEnd = end < dayEnd ? end : dayEnd;
      if (segEnd > segStart) total += (segEnd - segStart) / 60000;
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60000);
  }
  return total;
}

export function buildState(input) {
  const entries = parseEntries(input.ticket_log);
  return {
    policy_text: input.policy_text,
    ticket_log: input.ticket_log,
    entries: entries.map(e => ({ index: e.index, text: e.text })),
  };
}

export function questions(input) {
  const entries = parseEntries(input.ticket_log);
  const policy = parsePolicy(input.policy_text);
  const priorityNames = Object.keys(policy.priorityRules);

  const priorityCriteria = {};
  priorityNames.forEach(name => {
    priorityCriteria[name] = `The ticket_log entry that opens the ticket states its priority as "${name}".`;
  });
  priorityCriteria.unclear = 'ticket_log does not clearly state what priority the ticket had when it was opened.';

  const entryCriteria = {};
  entries.forEach(e => {
    entryCriteria[String(e.index)] = `entries[${e.index}]: "${e.text}"`;
  });
  entryCriteria.none = 'No entry in entries is a message from a support agent to the customer; every entry is either from the customer or an automatic/system acknowledgement.';
  entryCriteria.unclear = 'It is genuinely ambiguous which entry, if any, is the first support-agent reply.';

  return {
    priority_at_open: {
      type: 'choice',
      instructions: 'Reading `ticket_log`, what priority was the ticket assigned at the moment it was FIRST opened (its initial priority, ignoring any later change of priority)?',
      criteria: priorityCriteria,
    },
    first_agent_reply: {
      type: 'choice',
      instructions: 'Reading `entries` (each numbered entry\'s text is taken from `ticket_log`), which entry is the FIRST message personally written and sent by a human support agent to the customer? Do NOT count messages from the customer, and do NOT count automatic or system-generated acknowledgements even if they look like a reply and were not personally written by an agent. Choose "none" if no entry qualifies, or "unclear" if that is genuinely ambiguous.',
      criteria: entryCriteria,
    },
  };
}

export function decide(answers, input) {
  const entries = parseEntries(input.ticket_log);
  const policy = parsePolicy(input.policy_text);

  const priorityAns = answers && answers.priority_at_open;
  const replyAns = answers && answers.first_agent_reply;
  if (!priorityAns || !replyAns) return { breached: 'abstain' };

  if (priorityAns.choice === 'unclear' || priorityAns.confidence < CONF_THRESHOLD) {
    return { breached: 'abstain' };
  }
  const rule = policy.priorityRules[priorityAns.choice];
  if (!rule) return { breached: 'abstain' };

  const openEntry = entries.find(e => /\bopened\b/i.test(e.text) && e.dt) || entries.find(e => e.dt);
  if (!openEntry) return { breached: 'abstain' };
  const openDate = openEntry.dt;

  if (replyAns.choice === 'unclear' || replyAns.confidence < CONF_THRESHOLD) {
    return { breached: 'abstain' };
  }

  if (replyAns.choice === 'none') {
    const lastDated = [...entries].reverse().find(e => e.dt);
    if (!lastDated) return { breached: 'abstain' };
    const elapsedHours = rule.aroundClock
      ? (lastDated.dt - openDate) / 3600000
      : businessMinutesBetween(openDate, lastDated.dt, policy.businessDays, policy.holidays, policy.winStartMin, policy.winEndMin) / 60;
    return { breached: elapsedHours > rule.hours ? 'yes' : 'abstain' };
  }

  const idx = Number(replyAns.choice);
  const replyEntry = entries[idx];
  if (!replyEntry || !replyEntry.dt || replyEntry.dt <= openDate) return { breached: 'abstain' };
  const replyDate = replyEntry.dt;

  const elapsedHours = rule.aroundClock
    ? (replyDate - openDate) / 3600000
    : businessMinutesBetween(openDate, replyDate, policy.businessDays, policy.holidays, policy.winStartMin, policy.winEndMin) / 60;

  return { breached: elapsedHours > rule.hours ? 'yes' : 'no' };
}
