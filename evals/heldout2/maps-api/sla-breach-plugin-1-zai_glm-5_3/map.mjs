// map.mjs — first-response SLA breach check on Jev (TypeSafe System One).
// Design per the jev-questions skill: Jev only reads facts exactly (rule 9);
// all calendar arithmetic and the deadline comparison happen in code (rules 8, 9, 12);
// every answer is gated on the probability of the label acted on (rule 13),
// with abstain options where a read can fail (rule 14).

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const PRIORITIES = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };
const AMOUNTS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 48];
const GATE = 0.8; // fit on ~30 labelled cases before trusting (rule 13)

const nums = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
const numOpts = (xs) => Object.fromEntries(xs.map((x) => [String(x), null]));

const UNIT_CRITERIA = {
  clock_hours: 'hours counted around the clock: every hour of every day counts, including nights, weekends and holidays',
  business_hours: 'hours counted only during the business hours stated in `policy_text`',
  business_days: 'whole days counted as business days only; nights, weekends and excluded holidays do not count',
  other_unit: 'the target is stated in some other way',
};

// One small present-tense read per fact, each scoped to a named field (rules 1, 2, 6).
function timestampQuestions(prefix, field, what) {
  const q = (unit, opts) => ({
    type: 'choice',
    instructions: `In which ${unit} (UTC, 24-hour clock) does \`${field}\` show ${what}? Read the numeric date and clock time, not any weekday word.`,
    criteria: { ...numOpts(opts), not_stated: `\`${field}\` does not state this` },
  });
  return {
    [`${prefix}_year`]: q('year', nums(2024, 2029)),
    [`${prefix}_month`]: {
      type: 'choice',
      instructions: `In which month (UTC) does \`${field}\` show ${what}?`,
      criteria: { ...Object.fromEntries(MONTHS.map((m) => [m, null])), not_stated: `\`${field}\` does not state this` },
    },
    [`${prefix}_day`]: q('day of the month', nums(1, 31)),
    [`${prefix}_hour`]: q('hour', nums(0, 23)),
    [`${prefix}_minute`]: q('minute', nums(0, 59)),
  };
}

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    ticket_log: input.ticket_log,
    conventions: 'All timestamps in `ticket_log` are UTC, in 24-hour time. The first response is the earliest reply in `ticket_log` written by a support agent of the desk; messages from the customer and automatic acknowledgements are not first responses. The priority that applies is the one the ticket had when it was opened, even if the log shows a later change. Business hours, business days and excluded holidays are exactly those stated in `policy_text`.',
  };
}

export function questions(_input) {
  const qs = {
    priority_at_open: {
      type: 'choice',
      instructions: 'Which priority does `ticket_log` say the ticket had when it was opened? A later change of priority does not count.',
      criteria: {
        urgent: 'the log says the ticket was opened as Urgent',
        high: 'the log says the ticket was opened as High',
        normal: 'the log says the ticket was opened as Normal',
        low: 'the log says the ticket was opened as Low',
        not_stated: 'the log does not state the priority the ticket had when it was opened',
      },
    },
    has_agent_reply: {
      type: 'noul',
      instructions: 'Does `ticket_log` record at least one reply from a support agent of the desk? Replies from the customer, and automatic acknowledgements or bot messages, do not count.',
      criteria: {
        true: 'at least one reply in `ticket_log` comes from a support agent',
        false: 'no reply in `ticket_log` comes from a support agent',
      },
    },
    holidays_iso: {
      type: 'noul',
      instructions: 'Does `policy_text` state every public holiday it excludes as an explicit date in year-month-day form, such as 2026-01-01? Answer true when `policy_text` lists no excluded holidays at all.',
      criteria: {
        true: 'every excluded holiday, if any, is written as an explicit year-month-day date',
        false: 'some excluded holiday is described another way, for example by name without a date',
      },
    },
    biz_start_hour: {
      type: 'choice',
      instructions: 'At which hour (UTC, 24-hour clock) does `policy_text` say business hours begin on a business day?',
      criteria: { ...numOpts(nums(0, 23)), not_stated: '`policy_text` does not state this' },
    },
    biz_end_hour: {
      type: 'choice',
      instructions: 'At which hour (UTC, 24-hour clock) does `policy_text` say business hours end on a business day?',
      criteria: { ...numOpts(nums(0, 23)), not_stated: '`policy_text` does not state this' },
    },
    business_days: {
      type: 'choice',
      instructions: 'On which days of the week does `policy_text` say business hours apply?',
      criteria: {
        monday_to_friday: 'business hours apply Monday through Friday',
        monday_to_saturday: 'business hours apply Monday through Saturday',
        all_days: 'business hours apply on every day of the week',
        other: 'business hours apply on a different set of days',
      },
    },
    ...timestampQuestions('open', 'ticket_log', 'the moment the ticket was opened by the customer'),
    ...timestampQuestions('reply', 'ticket_log', 'the first reply from a support agent'),
    ...timestampQuestions('last', 'ticket_log', 'the last event recorded, whatever kind of event it is'),
  };
  for (const [p, label] of Object.entries(PRIORITIES)) {
    qs[`${p}_target_amount`] = {
      type: 'choice',
      instructions: `What number does \`policy_text\` state as the first-response target for ${label}-priority tickets? If the target is expressed in days, give the number of days.`,
      criteria: { ...numOpts(AMOUNTS), none_of_these: 'the policy states a number not listed here, or states no target for this priority' },
    };
    qs[`${p}_target_unit`] = {
      type: 'choice',
      instructions: `In which unit does \`policy_text\` state the first-response target for ${label}-priority tickets?`,
      criteria: UNIT_CRITERIA,
    };
  }
  return qs;
}

// ---- code side: gates, calendar arithmetic, the comparison (rules 8, 9, 12, 13) ----

const abstain = () => ({ breached: 'abstain' });

function pick(answers, id) {
  const a = answers[id];
  if (!a || a.type !== 'choice') return null;
  const c = a.choice;
  const p = (a.probabilities && a.probabilities[c]) ?? 0;
  return p >= GATE ? c : null;
}

function nou(answers, id) {
  const a = answers[id];
  if (!a || a.type !== 'noul') return null;
  return a.noul >= GATE ? true : a.noul <= 1 - GATE ? false : null;
}

function readTimestamp(answers, prefix) {
  const parts = ['year', 'month', 'day', 'hour', 'minute'].map((k) => pick(answers, `${prefix}_${k}`));
  if (parts.some((v) => v === null || v === 'not_stated')) return null;
  const [y, mo, d, h, mi] = parts;
  const monthIndex = MONTHS.indexOf(mo);
  if (monthIndex < 0) return null;
  return Date.UTC(Number(y), monthIndex, Number(d), Number(h), Number(mi));
}

function parseHolidays(text) {
  const out = new Set();
  for (const m of text.matchAll(/(\d{4})-(\d{1,2})-(\d{1,2})/g)) {
    out.add(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
  }
  return out;
}

const dayKey = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

function isBusinessDay(ms, cfg) {
  const dow = new Date(ms).getUTCDay();
  if (cfg.holidays.has(dayKey(ms))) return false;
  if (cfg.bizDays === 'monday_to_friday') return dow >= 1 && dow <= 5;
  if (cfg.bizDays === 'monday_to_saturday') return dow >= 1 && dow <= 6;
  if (cfg.bizDays === 'all_days') return true;
  return false;
}

function addBusinessMinutes(startMs, minutes, cfg) {
  let rem = minutes;
  let t = startMs;
  for (let i = 0; i < 4000; i++) {
    const d = new Date(t);
    const y = d.getUTCFullYear(), mo = d.getUTCMonth(), da = d.getUTCDate();
    const dayStart = Date.UTC(y, mo, da, cfg.startHour, 0);
    const dayEnd = Date.UTC(y, mo, da, cfg.endHour, 0);
    if (!isBusinessDay(dayStart, cfg)) { t = Date.UTC(y, mo, da + 1, 0, 0); continue; }
    const from = Math.max(t, dayStart);
    if (from >= dayEnd) { t = Date.UTC(y, mo, da + 1, 0, 0); continue; }
    const avail = (dayEnd - from) / 60000;
    if (rem <= avail) return from + rem * 60000;
    rem -= avail;
    t = Date.UTC(y, mo, da + 1, 0, 0);
  }
  return null;
}

export function decide(answers, input) {
  if (nou(answers, 'holidays_iso') !== true) return abstain(); // holidays must be machine-readable dates

  const priority = pick(answers, 'priority_at_open');
  if (!priority || priority === 'not_stated' || !(priority in PRIORITIES)) return abstain();

  const amount = pick(answers, `${priority}_target_amount`);
  const unit = pick(answers, `${priority}_target_unit`);
  if (!amount || !unit || amount === 'none_of_these' || unit === 'other_unit') return abstain();

  const openMs = readTimestamp(answers, 'open');
  if (openMs === null) return abstain();

  const startHs = pick(answers, 'biz_start_hour');
  const endHs = pick(answers, 'biz_end_hour');
  const bizDays = pick(answers, 'business_days');
  if (!startHs || !endHs || startHs === 'not_stated' || endHs === 'not_stated' || !bizDays || bizDays === 'other') return abstain();
  const startH = Number(startHs), endH = Number(endHs);
  if (Number.isNaN(startH) || Number.isNaN(endH) || startH >= endH) return abstain();

  const cfg = { startHour: startH, endHour: endH, bizDays, holidays: parseHolidays(input.policy_text) };

  // Target in minutes: business_days convert at the policy's hours per business day.
  const perDayHours = endH - startH;
  const targetMinutes = Number(amount) * 60 * (unit === 'business_days' ? perDayHours : 1);

  const deadline = unit === 'clock_hours'
    ? openMs + targetMinutes * 60000
    : addBusinessMinutes(openMs, targetMinutes, cfg);
  if (deadline === null) return abstain();

  const hasReply = nou(answers, 'has_agent_reply');
  if (hasReply === null) return abstain();

  if (hasReply) {
    const replyMs = readTimestamp(answers, 'reply');
    if (replyMs === null) return abstain();
    return { breached: replyMs > deadline ? 'yes' : 'no' };
  }

  // No first response recorded: breached only if the log already shows time past the deadline.
  const lastMs = readTimestamp(answers, 'last');
  if (lastMs === null) return abstain();
  return lastMs > deadline ? { breached: 'yes' } : abstain();
}
