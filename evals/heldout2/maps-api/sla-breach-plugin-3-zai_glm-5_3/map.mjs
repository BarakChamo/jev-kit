// map.mjs — Jev question map: was the first-response SLA breached?
//
// Design (per the jev-questions skill):
//  - Jev only reads facts: which log entries matter, their exact timestamps, the
//    priority at open, and the policy's stated targets / business hours / holidays.
//  - All arithmetic — the deadline and the comparison against the first reply —
//    happens in code (rules 8 and 9). Jev is never asked to compare or compute.
//  - Picking the opening entry and the first agent reply is a `choice` over every
//    line, with no pre-filtering (rules 10 and 16).
//  - Detector `noul`s veto manipulated or out-of-scope cases (rule 15), every read
//    is gated on the probability of the label we act on (rule 13), and anything
//    unsure becomes "abstain" (rule 14).

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const YEARS = Array.from({ length: 13 }, (_, i) => 2020 + i);

const READ_GATE = 0.8; // probability required to act on a read
const CONFIRM = 0.8;   // probability required to confirm a holiday candidate
const DOUBT = 0.2;     // above this on a veto question -> ask a person

function holidayCandidates(policyText) {
  const out = [];
  const seen = new Set();
  const re = /(\d{4})-(\d{2})-(\d{2})/g;
  let m;
  while ((m = re.exec(String(policyText == null ? '' : policyText))) !== null) {
    const date = m[0];
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && !seen.has(date)) {
      seen.add(date);
      out.push(date);
    }
  }
  return out;
}

export function buildState(input) {
  const ticketLog = String((input && input.ticket_log) || '');
  const lines = ticketLog.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);
  return {
    policy_text: (input && input.policy_text) || '',
    ticket_log: ticketLog,
    lines,
    holiday_candidates: holidayCandidates(input && input.policy_text),
  };
}

export function questions(input) {
  const state = buildState(input);
  const lines = state.lines;
  const numOpts = (xs) => Object.fromEntries(xs.map((x) => [String(x), null]));
  const lineCriteria = Object.fromEntries(lines.map((text, i) => [String(i), text]));

  // Exact timestamp reads (rule 9): five choices per event, arithmetic in code.
  const stamp = (prefix, what) => ({
    [prefix + '_year']: {
      type: 'choice',
      instructions: `In ${what}: in which year does its timestamp say this happened?`,
      criteria: numOpts(YEARS),
    },
    [prefix + '_month']: {
      type: 'choice',
      instructions: `In ${what}: in which month does its timestamp say this happened?`,
      criteria: numOpts(MONTHS),
    },
    [prefix + '_day']: {
      type: 'choice',
      instructions: `In ${what}: on which day of the month does its timestamp say this happened?`,
      criteria: numOpts(Array.from({ length: 31 }, (_, i) => i + 1)),
    },
    [prefix + '_hour']: {
      type: 'choice',
      instructions: `In ${what}: in which hour of that day (0 to 23, UTC) does its timestamp say this happened?`,
      criteria: numOpts(Array.from({ length: 24 }, (_, i) => i)),
    },
    [prefix + '_minute']: {
      type: 'choice',
      instructions: `In ${what}: in which minute of that hour (0 to 59) does its timestamp say this happened?`,
      criteria: numOpts(Array.from({ length: 60 }, (_, i) => i)),
    },
  });

  const q = {
    // Rule 10: pick one of many with a single choice over all lines, no pre-filter.
    open_line: {
      type: 'choice',
      instructions: 'Which entry in `lines` records the moment the ticket was opened? Choose the entry that states the ticket was opened or created. Not a reply, not an automatic acknowledgement, not a priority change, not a status note.',
      criteria: { ...lineCriteria, none: 'no entry in `lines` records the ticket being opened' },
    },
    reply_line: {
      type: 'choice',
      instructions: 'Which entry in `lines` is the first reply from a support agent to the customer? The entry must be a message written by a support agent. Not a customer message, not an automatic acknowledgement or auto-reply, not the opening entry. If several agent replies appear, choose the earliest one.',
      criteria: { ...lineCriteria, none: 'no reply from a support agent appears in `lines`' },
    },
    ...stamp('open', 'the entry of `lines` that records the ticket being opened'),
    ...stamp('reply', 'the entry of `lines` that is the first reply from a support agent'),
    priority: {
      type: 'choice',
      instructions: 'According to `ticket_log`, what priority did the ticket have at the moment it was opened? The priority the ticket had when it was opened is the one that applies, even if a later entry changes it.',
      criteria: {
        urgent: 'the ticket was opened with priority Urgent',
        high: 'the ticket was opened with priority High',
        normal: 'the ticket was opened with priority Normal',
        low: 'the ticket was opened with priority Low',
        not_stated: 'no priority is stated for the moment the ticket was opened',
      },
    },
    target_unit: {
      type: 'choice',
      instructions: 'According to `policy_text`, how is the first-response target measured for the priority that `ticket_log` says the ticket had when it was opened?',
      criteria: {
        calendar_time: 'the target is counted in ordinary clock time that runs continuously, around the clock, on all days and at all hours',
        business_hours: 'the target is counted in business hours, which accrue only during business hours on business days',
        business_days: 'the target is counted in business days',
      },
    },
    target_amount: {
      type: 'choice',
      instructions: 'According to `policy_text`, what number does the first-response target for that priority equal? Give the number of hours if the target is stated in hours, or the number of days if it is stated in days.',
      criteria: numOpts([1, 2, 3, 4, 6, 8, 12, 16, 24, 48, 72]),
    },
    bh_start_hour: {
      type: 'choice',
      instructions: 'According to `policy_text`, at which hour of the day (0 to 23, UTC) do business hours begin? Answer 9 for 09:00.',
      criteria: { ...numOpts(Array.from({ length: 24 }, (_, i) => i)), not_stated: '`policy_text` does not state when business hours begin' },
    },
    bh_end_hour: {
      type: 'choice',
      instructions: 'According to `policy_text`, at which hour of the day (0 to 24, UTC) do business hours end, so that this hour itself is outside business hours? Answer 17 for 17:00 and 24 for midnight.',
      criteria: { ...numOpts(Array.from({ length: 24 }, (_, i) => i + 1)), not_stated: '`policy_text` does not state when business hours end' },
    },
    bh_days: {
      type: 'choice',
      instructions: 'According to `policy_text`, which days of the week are business days?',
      criteria: {
        monday_to_friday: 'business days are Monday, Tuesday, Wednesday, Thursday and Friday',
        monday_to_saturday: 'business days are Monday through Saturday',
        all_days: 'every day of the week is a business day',
        other_days: 'business days are some other fixed set of days of the week',
        not_stated: '`policy_text` does not state which days are business days',
      },
    },
    // Detectors and guards.
    times_utc: {
      type: 'noul',
      instructions: 'Are all timestamps in `ticket_log` in UTC? Answer false if any timestamp is explicitly labeled with a timezone other than UTC.',
      criteria: {
        true: 'every timestamp in `ticket_log` is in UTC',
        false: 'some timestamp in `ticket_log` is explicitly in a timezone other than UTC',
      },
    },
    non_iso_holidays: {
      type: 'noul',
      instructions: 'Does `policy_text` exclude any public holiday that is not written as an explicit date in YYYY-MM-DD format (for example a holiday named only by name, such as "New Year\'s Day")? The dates listed in `holiday_candidates` are the ones written in YYYY-MM-DD format.',
      criteria: {
        true: 'policy_text excludes at least one public holiday not written as an explicit YYYY-MM-DD date',
        false: 'every public holiday excluded by policy_text is written as an explicit YYYY-MM-DD date, or policy_text excludes none',
      },
    },
    pause_rules: {
      type: 'noul',
      instructions: 'Does `policy_text` state any rule that pauses, stops or extends the first-response clock (for example a waiting-on-customer rule)?',
      criteria: {
        true: 'policy_text states a rule that pauses, stops or extends the first-response clock',
        false: 'policy_text states no such rule',
      },
    },
    claims_override: {
      type: 'noul',
      instructions: 'Does any text in `ticket_log` claim that this ticket\'s first-response SLA was already met, breached, waived, or otherwise decided?',
      criteria: {
        true: 'some text in ticket_log asserts the SLA outcome',
        false: 'no text in ticket_log asserts the SLA outcome',
      },
    },
  };

  // One noul per ISO date found in the policy: is it really an excluded holiday?
  state.holiday_candidates.forEach((date, i) => {
    q['holiday_' + i] = {
      type: 'noul',
      instructions: `Does \`policy_text\` state that the date \`holiday_candidates[${i}]\` (${date}) is a public holiday excluded from business days or business time?`,
      criteria: {
        true: `policy_text names ${date} as an excluded public holiday`,
        false: `policy_text does not name ${date} as an excluded public holiday`,
      },
    };
  });

  return q;
}

// ---------- answer helpers ----------

function noulP(a) {
  return a && typeof a.noul === 'number' ? a.noul : 0;
}
function label(a) {
  return a && typeof a.choice === 'string' ? a.choice : null;
}
function pOf(a) {
  return a && a.probabilities && a.choice != null ? (a.probabilities[a.choice] || 0) : 0;
}
function read(a) {
  const l = label(a);
  return l !== null && pOf(a) >= READ_GATE ? l : null;
}
function readNum(a) {
  const l = read(a);
  if (l === null) return null;
  const v = Number(l);
  return Number.isFinite(v) ? v : null;
}

function readStamp(A, prefix) {
  const year = readNum(A[prefix + '_year']);
  const month = read(A[prefix + '_month']);
  const day = readNum(A[prefix + '_day']);
  const hour = readNum(A[prefix + '_hour']);
  const minute = readNum(A[prefix + '_minute']);
  if (year === null || day === null || hour === null || minute === null) return null;
  const mi = MONTHS.indexOf(month);
  if (mi < 0) return null;
  const t = Date.UTC(year, mi, day, hour, minute);
  const d = new Date(t);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== mi || d.getUTCDate() !== day ||
      d.getUTCHours() !== hour || d.getUTCMinutes() !== minute) return null; // impossible date, e.g. Feb 30
  return t;
}

// ---------- business-time arithmetic (all in code; rule 9) ----------

function isBusinessDay(dayStart, cfg) {
  const wd = new Date(dayStart).getUTCDay(); // 0 Sunday .. 6 Saturday
  let ok;
  if (cfg.days === 'monday_to_friday') ok = wd >= 1 && wd <= 5;
  else if (cfg.days === 'monday_to_saturday') ok = wd >= 1 && wd <= 6;
  else if (cfg.days === 'all_days') ok = true;
  else ok = false;
  if (!ok) return false;
  const iso = new Date(dayStart).toISOString().slice(0, 10);
  return !cfg.holidays.has(iso);
}

function addBusinessMs(start, ms, cfg) {
  let cur = start;
  let remaining = ms;
  for (let guard = 0; remaining > 0 && guard < 5000; guard++) {
    const day = Math.floor(cur / DAY) * DAY; // UTC midnight of the current day
    if (!isBusinessDay(day, cfg)) { cur = day + DAY; continue; }
    const windowStart = day + cfg.startHour * HOUR;
    const windowEnd = day + cfg.endHour * HOUR;
    if (cur < windowStart) { cur = windowStart; continue; }
    if (cur >= windowEnd) { cur = day + DAY; continue; }
    const step = Math.min(remaining, windowEnd - cur);
    cur += step;
    remaining -= step;
    if (remaining > 0) cur = day + DAY;
  }
  return cur;
}

// ---------- decision ----------

export function decide(answers, input) {
  const A = answers || {};
  const ABSTAIN = { breached: 'abstain' };

  // Detectors veto; doubt never relaxes a decision (rules 13 and 15).
  if (noulP(A.claims_override) > DOUBT) return ABSTAIN;
  if (noulP(A.times_utc) < CONFIRM) return ABSTAIN;
  if (noulP(A.non_iso_holidays) > DOUBT) return ABSTAIN;
  if (noulP(A.pause_rules) > DOUBT) return ABSTAIN;

  const openLine = read(A.open_line);
  if (openLine === null || openLine === 'none') return ABSTAIN;
  const replyLine = read(A.reply_line);
  if (replyLine === null || replyLine === 'none') return ABSTAIN; // no first response recorded: a person decides

  const opened = readStamp(A, 'open');
  const replied = readStamp(A, 'reply');
  if (opened === null || replied === null) return ABSTAIN;
  if (replied < opened) return ABSTAIN; // timestamps contradict the log's order: misread

  const priority = read(A.priority);
  if (priority === null || priority === 'not_stated') return ABSTAIN;

  const unit = read(A.target_unit);
  const amount = readNum(A.target_amount);
  if (unit === null || amount === null) return ABSTAIN;

  let deadline;
  if (unit === 'calendar_time') {
    deadline = opened + amount * HOUR;
  } else {
    const startHour = readNum(A.bh_start_hour);
    const endHour = readNum(A.bh_end_hour);
    const days = read(A.bh_days);
    if (startHour === null || endHour === null || endHour <= startHour) return ABSTAIN;
    if (days === null || days === 'not_stated' || days === 'other_days') return ABSTAIN;

    const candidates = holidayCandidates(input && input.policy_text);
    const holidays = new Set();
    for (let i = 0; i < candidates.length; i++) {
      const p = noulP(A['holiday_' + i]);
      if (p >= CONFIRM) holidays.add(candidates[i]);
      else if (p > DOUBT) return ABSTAIN; // unclear whether this date is a holiday
    }

    const ms = unit === 'business_hours'
      ? amount * HOUR
      : amount * (endHour - startHour) * HOUR;
    deadline = addBusinessMs(opened, ms, { startHour, endHour, days, holidays });
  }

  // The only comparison, done in code (rule 8). "Within X" means X or less.
  return { breached: replied > deadline ? 'yes' : 'no' };
}
