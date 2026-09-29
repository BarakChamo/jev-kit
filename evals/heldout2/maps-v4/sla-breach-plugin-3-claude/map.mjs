// map.mjs — first-response SLA breach check on Jev (TypeSafe System One)

const CONFIDENCE_GATE = 0.75;

function parseEntries(log) {
  const lines = String(log).split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const tsRe = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s*UTC/;
  const entries = [];
  for (const line of lines) {
    const m = line.match(tsRe);
    if (!m) continue;
    const [full, dateStr, hh, mm, ss] = m;
    const date = new Date(`${dateStr}T${hh}:${mm}:${ss || '00'}Z`);
    let rest = line.slice(full.length);
    rest = rest.replace(/^\s*\([^)]*\)\s*/, '');
    rest = rest.replace(/^\s*:\s*/, '');
    entries.push({ date, text: rest });
  }
  return entries;
}

function parsePolicy(text) {
  const bh = text.match(/(\d{1,2}):(\d{2})\s*to\s*(\d{1,2}):(\d{2})\s*UTC/i);
  if (!bh) return null;
  const businessStart = Number(bh[1]) + Number(bh[2]) / 60;
  const businessEnd = Number(bh[3]) + Number(bh[4]) / 60;
  const dayHours = businessEnd - businessStart;

  const holidays = new Set([...text.matchAll(/\d{4}-\d{2}-\d{2}/g)].map((m) => m[0]));

  const tiers = [];
  const lineRe = /-\s*([A-Za-z ,]+?):\s*within\s+([\d.]+)\s*(business\s+)?(hour|hours|day|days)\b([^\n]*)/gi;
  let m;
  while ((m = lineRe.exec(text)) !== null) {
    const names = m[1]
      .split(/\s*,\s*|\s+and\s+|\s+or\s+/i)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const num = parseFloat(m[2]);
    const isBusinessUnit = !!m[3];
    const unit = m[4].toLowerCase();
    const rest = m[5] || '';
    const aroundClock = /around the clock|all days,\s*all hours/i.test(rest);
    const explicitParen = rest.match(/\(([\d.]+)\s*business hours\)/i);

    let targetHours;
    if (explicitParen) {
      targetHours = parseFloat(explicitParen[1]);
    } else if (unit.startsWith('hour')) {
      targetHours = num;
    } else {
      targetHours = num * (isBusinessUnit ? dayHours : 24);
    }

    tiers.push({ names, targetHours, businessBound: !aroundClock });
  }

  return { businessStart, businessEnd, businessDays: [1, 2, 3, 4, 5], holidays, dayHours, tiers };
}

function businessHoursElapsed(openDate, replyDate, policy) {
  if (replyDate <= openDate) return 0;
  let total = 0;
  let cursor = new Date(Date.UTC(openDate.getUTCFullYear(), openDate.getUTCMonth(), openDate.getUTCDate()));
  const endDay = new Date(Date.UTC(replyDate.getUTCFullYear(), replyDate.getUTCMonth(), replyDate.getUTCDate()));
  while (cursor <= endDay) {
    const dateStr = cursor.toISOString().slice(0, 10);
    if (policy.businessDays.includes(cursor.getUTCDay()) && !policy.holidays.has(dateStr)) {
      const dayStart = new Date(cursor.getTime() + policy.businessStart * 3600000);
      const dayEnd = new Date(cursor.getTime() + policy.businessEnd * 3600000);
      const segStart = new Date(Math.max(dayStart.getTime(), openDate.getTime()));
      const segEnd = new Date(Math.min(dayEnd.getTime(), replyDate.getTime()));
      if (segEnd > segStart) total += (segEnd - segStart) / 3600000;
    }
    cursor = new Date(cursor.getTime() + 24 * 3600000);
  }
  return total;
}

export function buildState(input) {
  const entries = parseEntries(input.ticket_log);
  return {
    policy_text: input.policy_text,
    ticket_log: input.ticket_log,
    entries: entries.map((e, i) => ({ index: i, timestamp: e.date.toISOString(), text: e.text })),
  };
}

export function questions(input) {
  const entries = parseEntries(input.ticket_log);
  const criteria = {};
  entries.forEach((e, i) => {
    criteria[String(i)] = `Entry ${i}, timestamp ${e.date.toISOString()}: "${e.text}"`;
  });
  criteria.none = 'No entry in `entries` is a genuine first response from a support agent to the customer.';

  return {
    first_agent_response: {
      type: 'choice',
      instructions:
        'Look at the `entries` list in the state (each has an index, a timestamp and text from the ticket log). ' +
        'Which entry is the first message sent BY a support agent TO the customer? It only counts if it is an actual ' +
        'reply from a support agent. It does NOT count if the entry is: the ticket being opened, a message from the ' +
        'customer, an automatic/system acknowledgement, an internal note, or a priority/status change with no message ' +
        'to the customer. If no entry in `entries` qualifies, answer "none".',
      criteria,
    },
  };
}

export function decide(answers, input) {
  const policy = parsePolicy(input.policy_text);
  const entries = parseEntries(input.ticket_log);
  if (!policy || policy.tiers.length === 0 || entries.length === 0) return { breached: 'abstain' };

  const openedIdx = entries.findIndex((e) => /\bopened\b/i.test(e.text));
  const opened = entries[openedIdx >= 0 ? openedIdx : 0];

  const priorityMatch = opened.text.match(/priority[:\s]+([A-Za-z]+)/i);
  if (!priorityMatch) return { breached: 'abstain' };
  const priorityName = priorityMatch[1].toLowerCase();
  const tier = policy.tiers.find((t) => t.names.includes(priorityName));
  if (!tier || !isFinite(tier.targetHours)) return { breached: 'abstain' };

  const ans = answers.first_agent_response;
  if (!ans || typeof ans.confidence !== 'number' || ans.confidence < CONFIDENCE_GATE) {
    return { breached: 'abstain' };
  }

  const elapsedTo = (date) =>
    tier.businessBound ? businessHoursElapsed(opened.date, date, policy) : (date - opened.date) / 3600000;

  if (ans.choice === 'none') {
    const lastEntry = entries[entries.length - 1];
    return { breached: elapsedTo(lastEntry.date) > tier.targetHours ? 'yes' : 'abstain' };
  }

  const reply = entries[Number(ans.choice)];
  if (!reply) return { breached: 'abstain' };

  return { breached: elapsedTo(reply.date) > tier.targetHours + 1e-9 ? 'yes' : 'no' };
}
