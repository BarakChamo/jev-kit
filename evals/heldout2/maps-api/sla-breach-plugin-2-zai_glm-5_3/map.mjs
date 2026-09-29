// SLA first-response breach check, built on Jev.
// Shape: Jev only READS facts (timestamps, priority, policy terms, stated numbers);
// all arithmetic and the elapsed-vs-target comparison happen in code (rules 8, 9).

const GATE = 0.8; // minimum probability of a label we act on (rule 13)

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const YEARS = [2024, 2025, 2026, 2027, 2028, 2029];
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const HOURS24 = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const BH_MINUTES = [0, 15, 30, 45, 'not_stated'];
const TARGET_HOURS = [0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 48, 72, 'not_stated'];
const PRIORITIES = ['urgent', 'high', 'normal', 'low'];
const WORKDAYS = {
  monday_to_friday: new Set([1, 2, 3, 4, 5]),
  monday_to_saturday: new Set([1, 2, 3, 4, 5, 6]),
  all_seven_days: new Set([0, 1, 2, 3, 4, 5, 6]),
};

const c = (xs) => Object.fromEntries(xs.map((x) => [String(x), String(x)]));
const monthCriteria = Object.fromEntries(MONTHS.map((m) => [m, m]));

// Extract explicit YYYY-MM-DD holiday dates from the policy (code settles it; Jev verifies).
function extractHolidays(policyText) {
  const out = new Set();
  for (const line of String(policyText || '').split(/\n+/)) {
    if (!/holiday/i.test(line)) continue;
    for (const m of line.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) out.add(`${m[1]}-${m[2]}-${m[3]}`);
  }
  return [...out];
}

export function buildState(input) {
  const holidays = extractHolidays(input.policy_text);
  return {
    policy_text: input.policy_text,
    ticket_log: input.ticket_log,
    holidays_extracted: holidays,
    holidays_note: holidays.length
      ? 'Holiday dates extracted in code from the holiday sentence of policy_text.'
      : 'No explicit YYYY-MM-DD holiday dates found in policy_text.',
  };
}

function timestampQuestions(prefix, what) {
  const q = (suffix, instructions, criteria) => [
    `${prefix}_${suffix}`,
    { type: 'choice', instructions, criteria },
  ];
  return Object.fromEntries([
    q('year', `In \`ticket_log\`, in which year does the log say ${what}?`, c(YEARS)),
    q('month', `In \`ticket_log\`, in which month does the log say ${what}?`, monthCriteria),
    q('day', `In \`ticket_log\`, on which day of the month does the log say ${what}?`, c(DAYS)),
    q('hour', `In \`ticket_log\`, at which hour (UTC) does the log say ${what}?`, c(HOURS24.concat('not_stated'))),
    q('minute', `In \`ticket_log\`, at which minute of that hour does the log say ${what}?`, c(MINUTES)),
  ]);
}

export function questions(input) {
  const qs = {
    // What priority did the ticket have when it was opened?
    priority_at_open: {
      type: 'choice',
      instructions: 'Which priority does `ticket_log` state for the ticket at the moment it was opened? A priority changed later does not count.',
      criteria: {
        urgent: 'the log says the ticket was opened with priority Urgent',
        high: 'the log says the ticket was opened with priority High',
        normal: 'the log says the ticket was opened with priority Normal',
        low: 'the log says the ticket was opened with priority Low',
        unknown: 'the log does not clearly state the priority at the moment the ticket was opened',
      },
    },
    // Is there a real first response at all?
    has_agent_reply: {
      type: 'noul',
      instructions: 'Does `ticket_log` contain at least one reply from a support agent? Only a reply written by a support agent counts. Customer messages and automatic acknowledgements (auto-confirmations, bot receipts) do not count.',
      criteria: { true: 'at least one support-agent reply appears in the log', false: 'no support-agent reply appears in the log' },
    },
    // Detector beside a manipulable judgment (rule 15).
    claims_sla_excused: {
      type: 'noul',
      instructions: 'Does any text in the state claim that the first-response SLA for this ticket was already met, paused, extended, waived, or approved by someone? A plain timestamped record of events does not count; only an explicit claim does.',
      criteria: { true: 'some text makes such a claim', false: 'no such claim appears' },
    },
    ...timestampQuestions('opened', 'the ticket was opened'),
    ...timestampQuestions('reply', 'the earliest reply from a support agent was sent (a reply written by a support agent; not a customer message and not an automatic acknowledgement)'),
  };

  // First-response target per priority, read exactly from `policy_text`.
  for (const p of PRIORITIES) {
    qs[`target_${p}_hours`] = {
      type: 'choice',
      instructions: `How many hours does \`policy_text\` give as the first-response target for tickets of priority ${p[0].toUpperCase()}${p.slice(1)}? Read the stated number exactly. If the target is stated only in business days, give the equivalent using 8 business hours per business day.`,
      criteria: c(TARGET_HOURS),
    };
    qs[`target_${p}_clock`] = {
      type: 'choice',
      instructions: `Does the first-response target for priority ${p[0].toUpperCase()}${p.slice(1)} in \`policy_text\` count business hours or all hours around the clock?`,
      criteria: {
        business_hours: 'the target counts business hours as the policy defines them',
        all_hours_clock: 'the target counts all hours around the clock (all days, all hours)',
        not_stated: 'the policy does not clearly say',
      },
    };
  }

  // Business-hours window, read exactly (only used when the target counts business hours).
  qs.bh_start_hour = { type: 'choice', instructions: 'At which hour of the day (UTC) do business hours begin on a business day, as defined in `policy_text`?', criteria: c(HOURS24.concat('not_stated')) };
  qs.bh_start_minute = { type: 'choice', instructions: 'At which minute of that hour do business hours begin, as defined in `policy_text`?', criteria: c(BH_MINUTES) };
  qs.bh_end_hour = { type: 'choice', instructions: 'At which hour of the day (UTC) do business hours end on a business day, as defined in `policy_text`?', criteria: c(HOURS24.concat('not_stated')) };
  qs.bh_end_minute = { type: 'choice', instructions: 'At which minute of that hour do business hours end, as defined in `policy_text`?', criteria: c(BH_MINUTES) };
  qs.business_days = {
    type: 'choice',
    instructions: 'Which days of the week are business days according to `policy_text`?',
    criteria: {
      monday_to_friday: 'Monday through Friday only',
      monday_to_saturday: 'Monday through Saturday',
      all_seven_days: 'every day of the week',
      other_or_unclear: 'some other set of days, or the policy does not clearly say',
    },
  };
  // Verify the code-extracted holiday list against the policy.
  qs.holidays_match = {
    type: 'noul',
    instructions: 'Do the dates in `holidays_extracted` match exactly the public holidays that `policy_text` says are excluded from business hours — every excluded holiday date is listed and no extra date appears? If the policy excludes no public holidays, the answer is true when `holidays_extracted` is empty.',
    criteria: { true: 'the extracted list matches the policy exactly', false: 'the extracted list is missing a holiday or contains a date the policy does not exclude' },
  };
  return qs;
}

function businessMsBetween(from, to, startMin, endMin, workdays, holidays) {
  const DAY = 86400000;
  let total = 0;
  let day = Math.floor(from / DAY) * DAY;
  while (day <= to) {
    const d = new Date(day);
    const iso = d.toISOString().slice(0, 10);
    if (workdays.has(d.getUTCDay()) && !holidays.has(iso)) {
      const s = day + startMin * 60000;
      const e = day + endMin * 60000;
      const lo = Math.max(from, s);
      const hi = Math.min(to, e);
      if (hi > lo) total += hi - lo;
    }
    day += DAY;
  }
  return total;
}

export function decide(answers, input) {
  const A = answers || {};
  const abstain = { breached: 'abstain' };

  const pick = (id) => {
    const a = A[id];
    if (!a || a.type !== 'choice' || typeof a.choice !== 'string') return null;
    const p = (a.probabilities || {})[a.choice] ?? 0;
    return p >= GATE ? a.choice : null;
  };
  const num = (id) => {
    const v = pick(id);
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const noul = (id) => (A[id] && typeof A[id].noul === 'number' ? A[id].noul : null);

  // No (or unsure) support-agent reply: without a "now" timestamp a person must decide.
  const hasReply = noul('has_agent_reply');
  if (hasReply === null || hasReply < GATE) return abstain;
  // Manipulation detector: an in-log claim that the SLA was met/waived goes to a person.
  const excused = noul('claims_sla_excused');
  if (excused !== null && excused > 0.5) return abstain;

  const priority = pick('priority_at_open');
  if (!priority || priority === 'unknown') return abstain;

  const readTs = (prefix) => {
    const y = num(`${prefix}_year`);
    const mo = pick(`${prefix}_month`);
    const d = num(`${prefix}_day`);
    const h = num(`${prefix}_hour`);
    const mi = num(`${prefix}_minute`);
    const moIdx = mo === null ? -1 : MONTHS.indexOf(mo);
    if (y === null || moIdx < 0 || d === null || h === null || mi === null) return null;
    const t = Date.UTC(y, moIdx, d, h, mi);
    return Number.isFinite(t) ? t : null;
  };
  const openedT = readTs('opened');
  const replyT = readTs('reply');
  if (openedT === null || replyT === null || replyT < openedT) return abstain;

  const targetHours = num(`target_${priority}_hours`);
  const clock = pick(`target_${priority}_clock`);
  if (targetHours === null || !clock || clock === 'not_stated') return abstain;

  let elapsedMs;
  if (clock === 'all_hours_clock') {
    elapsedMs = replyT - openedT;
  } else if (clock === 'business_hours') {
    const sh = num('bh_start_hour'), sm = num('bh_start_minute');
    const eh = num('bh_end_hour'), em = num('bh_end_minute');
    const daysOpt = pick('business_days');
    const hm = noul('holidays_match');
    if (sh === null || sm === null || eh === null || em === null) return abstain;
    if (!daysOpt || daysOpt === 'other_or_unclear' || !WORKDAYS[daysOpt]) return abstain;
    if (hm === null || hm < GATE) return abstain; // unverified holiday extraction
    if (eh * 60 + em <= sh * 60 + sm) return abstain; // impossible window -> a person decides
    const holidays = new Set(extractHolidays(input.policy_text));
    elapsedMs = businessMsBetween(openedT, replyT, sh * 60 + sm, eh * 60 + em, WORKDAYS[daysOpt], holidays);
  } else {
    return abstain;
  }

  // The comparison lives here, never in a question (rule 8). "Within X" is inclusive.
  const breached = elapsedMs / 3600000 > targetHours + 1e-9;
  return { breached: breached ? 'yes' : 'no' };
}
