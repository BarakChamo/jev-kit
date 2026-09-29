// map.mjs — decides whether a ticket's first-response SLA was breached.
//
// Jev reads facts only; code does every date computation and the final
// comparison. Any read below the confidence gate sends the case to a person.

const PRIORITIES = ['Urgent', 'High', 'Normal', 'Low'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const AMOUNTS = [1, 2, 3, 4, 5, 6, 8, 12, 15, 16, 24, 30, 45, 48, 72];

const GATE = 0.8;          // act on a choice label only at or above its probability
const NOUL_MARGIN = 0.2;   // a noul within this of 0 or 1 counts as decisive
const MAX_SPAN_DAYS = 62;  // longer logs go to a person
const DAY_MS = 86400000;

const ABSTAIN = { breached: 'abstain' };
const TS_RE = /(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})/;

function linesOf(log) {
  return String(log ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
}

function timestampOf(line) {
  const m = TS_RE.exec(line);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return Number.isNaN(t) ? null : t;
}

export function buildState(input) {
  return {
    policy_text: input?.policy_text ?? '',
    ticket_log: input?.ticket_log ?? '',
    log_lines: linesOf(input?.ticket_log).map((l, i) => `${i}: ${l}`).join('\n'),
    conventions:
      'Read `policy_text` exactly as written. A first response is a reply from a human ' +
      'support agent; customer messages and automatic acknowledgements are not first ' +
      'responses. The priority that applies is the one the ticket had when it was opened. ' +
      'All timestamps in the log are UTC.',
  };
}

export function questions(input) {
  const lines = linesOf(input?.ticket_log);
  const lineOptions = Object.fromEntries(lines.map((text, i) => [String(i), text]));
  const q = {};

  q.opened_line = {
    type: 'choice',
    instructions: 'Which line of `log_lines` records the ticket being opened by the customer? Answer with the line number.',
    criteria: { ...lineOptions, none: 'no line records the ticket being opened' },
  };
  q.open_priority = {
    type: 'choice',
    instructions: 'What priority does `ticket_log` say the ticket had when it was opened? If the priority was changed later, give the priority at opening, not the later one.',
    criteria: {
      Urgent: 'priority Urgent',
      High: 'priority High',
      Normal: 'priority Normal',
      Low: 'priority Low',
      unspecified: 'the log does not state the priority the ticket had when opened',
    },
  };
  q.first_agent_reply_line = {
    type: 'choice',
    instructions: 'Which line of `log_lines` is the first reply from a human support agent? Customer messages and automatic acknowledgements do not count. Choose the earliest qualifying line.',
    criteria: { ...lineOptions, none: 'no line is a reply from a human support agent' },
  };

  for (const p of PRIORITIES) {
    q[`target_amount_${p}`] = {
      type: 'choice',
      instructions: `What number is the first-response target for ${p} tickets in \`policy_text\`? Give just the number as written: for "within 2 business days" it is 2, for "within 30 minutes" it is 30.`,
      criteria: {
        ...Object.fromEntries(AMOUNTS.map((n) => [String(n), `the stated number is ${n}`])),
        other: 'the target is a different number, or no target is stated for this priority',
      },
    };
    q[`target_unit_${p}`] = {
      type: 'choice',
      instructions: `In what unit does \`policy_text\` state the first-response target for ${p} tickets? "Business" units count only business hours; plain units count all time, around the clock.`,
      criteria: {
        minutes: 'minutes, counting all time',
        hours: 'hours, counting all time',
        business_hours: 'hours, counting only business hours',
        days: 'calendar days, counting all time',
        business_days: 'business days, counting only business hours',
      },
    };
  }

  const hourOptions = Object.fromEntries(Array.from({ length: 24 }, (_, h) => [String(h), `the hour is ${h}`]));
  const minuteOptions = {
    '0': 'the minute is 00', '15': 'the minute is 15', '30': 'the minute is 30', '45': 'the minute is 45',
    other: 'a different minute',
  };
  q.bh_start_hour = { type: 'choice', instructions: 'At what hour of the day (UTC, 24-hour) do business hours begin under `policy_text`? For 09:00, the hour is 9.', criteria: hourOptions };
  q.bh_start_minute = { type: 'choice', instructions: 'At what minute past the hour do business hours begin under `policy_text`? For 09:00, the minute is 00.', criteria: minuteOptions };
  q.bh_end_hour = { type: 'choice', instructions: 'At what hour of the day (UTC, 24-hour) do business hours end under `policy_text`? For 17:00, the hour is 17.', criteria: hourOptions };
  q.bh_end_minute = { type: 'choice', instructions: 'At what minute past the hour do business hours end under `policy_text`? For 17:00, the minute is 00.', criteria: minuteOptions };

  for (const day of WEEKDAYS.slice(1).concat('Sunday')) {
    q[`business_day_${day}`] = {
      type: 'noul',
      instructions: `Is ${day} a business day under \`policy_text\`?`,
      criteria: { true: `${day} is a business day`, false: `${day} is not a business day` },
    };
  }

  // One holiday question per date the log spans; code never extracts the list itself.
  const stamps = lines.map(timestampOf).filter((t) => t !== null);
  if (stamps.length > 0) {
    const first = Math.floor(Math.min(...stamps) / DAY_MS);
    const last = Math.floor(Math.max(...stamps) / DAY_MS);
    if (last - first <= MAX_SPAN_DAYS) {
      for (let d = first; d <= last; d++) {
        const iso = new Date(d * DAY_MS).toISOString().slice(0, 10);
        q[`holiday_${iso}`] = {
          type: 'noul',
          instructions: `Is ${iso} listed as a public holiday in \`policy_text\`?`,
          criteria: { true: `${iso} is listed as a public holiday`, false: `${iso} is not listed as a public holiday` },
        };
      }
    }
  }

  return q;
}

export function decide(answers, input) {
  const stamps = linesOf(input?.ticket_log).map(timestampOf);

  // The label of a choice answer, only at or above the gate; otherwise null.
  const label = (id) => {
    const a = answers?.[id];
    if (!a || typeof a.choice !== 'string') return null;
    return (a.probabilities?.[a.choice] ?? 0) >= GATE ? a.choice : null;
  };
  // A noul as a boolean; null when missing or unsure.
  const flag = (id) => {
    const n = answers?.[id]?.noul;
    if (typeof n !== 'number') return null;
    if (n >= 1 - NOUL_MARGIN) return true;
    if (n <= NOUL_MARGIN) return false;
    return null;
  };

  // When the ticket was opened (timestamp read from the explicit log text in code).
  const openedLine = label('opened_line');
  if (openedLine === null || openedLine === 'none') return ABSTAIN;
  const openedAt = stamps[Number(openedLine)];
  if (openedAt == null) return ABSTAIN;

  // Priority at opening, and the policy target for that priority.
  const priority = label('open_priority');
  if (priority === null || priority === 'unspecified' || !PRIORITIES.includes(priority)) return ABSTAIN;
  const amountLabel = label(`target_amount_${priority}`);
  const unit = label(`target_unit_${priority}`);
  if (amountLabel === null || amountLabel === 'other' || unit === null) return ABSTAIN;
  const amount = Number(amountLabel);

  // Business hours and business days.
  const sh = label('bh_start_hour'), sm = label('bh_start_minute');
  const eh = label('bh_end_hour'), em = label('bh_end_minute');
  if (sh === null || sm === null || eh === null || em === null) return ABSTAIN;
  if (sm === 'other' || em === 'other') return ABSTAIN;
  const dayStartMin = Number(sh) * 60 + Number(sm);
  const dayEndMin = Number(eh) * 60 + Number(em);
  if (!(dayEndMin > dayStartMin)) return ABSTAIN;

  const isBusinessDay = [];
  for (let i = 0; i < 7; i++) {
    const b = flag(`business_day_${WEEKDAYS[i]}`);
    if (b === null) return ABSTAIN;
    isBusinessDay[i] = b;
  }

  // When the first agent reply happened, if it did.
  const replyLine = label('first_agent_reply_line');
  if (replyLine === null) return ABSTAIN;
  const replied = replyLine !== 'none';
  let endAt;
  if (replied) {
    endAt = stamps[Number(replyLine)];
    if (endAt == null) return ABSTAIN;
  } else {
    const known = stamps.filter((t) => t !== null);
    if (known.length === 0) return ABSTAIN;
    endAt = Math.max(...known); // latest log activity stands in for "now"
  }
  if (endAt < openedAt) return ABSTAIN;

  // Holidays across the span.
  const firstDay = Math.floor(openedAt / DAY_MS);
  const lastDay = Math.floor(endAt / DAY_MS);
  if (lastDay - firstDay > MAX_SPAN_DAYS) return ABSTAIN;
  const holidays = new Set();
  for (let d = firstDay; d <= lastDay; d++) {
    const iso = new Date(d * DAY_MS).toISOString().slice(0, 10);
    const h = flag(`holiday_${iso}`);
    if (h === null) return ABSTAIN;
    if (h) holidays.add(d);
  }

  // Elapsed time: wall minutes, and minutes inside business windows.
  const wallMinutes = (endAt - openedAt) / 60000;
  let businessMinutes = 0;
  for (let d = firstDay; d <= lastDay; d++) {
    if (!isBusinessDay[new Date(d * DAY_MS).getUTCDay()] || holidays.has(d)) continue;
    const lo = Math.max(openedAt, d * DAY_MS + dayStartMin * 60000);
    const hi = Math.min(endAt, d * DAY_MS + dayEndMin * 60000);
    if (hi > lo) businessMinutes += (hi - lo) / 60000;
  }

  // The target, in the matching kind of minutes.
  let targetMinutes, useBusiness;
  switch (unit) {
    case 'minutes': targetMinutes = amount; useBusiness = false; break;
    case 'hours': targetMinutes = amount * 60; useBusiness = false; break;
    case 'days': targetMinutes = amount * 1440; useBusiness = false; break;
    case 'business_hours': targetMinutes = amount * 60; useBusiness = true; break;
    case 'business_days': targetMinutes = amount * (dayEndMin - dayStartMin); useBusiness = true; break;
    default: return ABSTAIN;
  }
  const elapsed = useBusiness ? businessMinutes : wallMinutes;

  if (!replied) {
    // No first response yet: breach only if the target had already elapsed by
    // the latest log activity; otherwise a person must judge.
    return { breached: elapsed > targetMinutes ? 'yes' : 'abstain' };
  }
  return { breached: elapsed > targetMinutes ? 'yes' : 'no' };
}
