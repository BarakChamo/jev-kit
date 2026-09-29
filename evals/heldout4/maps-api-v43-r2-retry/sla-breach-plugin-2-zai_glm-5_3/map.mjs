// map.mjs — first-response SLA breach check built on Jev.
//
// Division of labour (jev-questions skill):
//  - Jev reads facts: priority at opening, the opened timestamp, which log
//    entry is the first reply from a support agent, that reply's timestamp,
//    and whether the policy text matches the constants pinned below.
//  - Code does: all date arithmetic, business-hour accrual, the deadline
//    comparison, and every gate. Jev is never asked to compare, compute a
//    deadline, or decide "breached".
//
// The gates below are placeholders: fit them per question with jev-audit.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const YEARS = [2025, 2026, 2027];

// Pinned policy constants (rule 13). The noul questions below verify the
// incoming `policy_text` states exactly this policy; any mismatch abstains.
const POLICY = {
  urgent_clock_minutes: 60,            // "within 1 hour, around the clock"
  high_business_minutes: 4 * 60,
  normal_low_business_minutes: 16 * 60, // "2 business days"
  open_utc_hour: 9,
  close_utc_hour: 17,
  holidays: new Set(['2026-01-01', '2026-04-03', '2026-05-25', '2026-12-25']),
};

const GATES = {
  policy: 0.8,    // each policy-match noul
  utc: 0.8,
  exception: 0.5, // any real chance of an SLA-waiver claim -> a person
  priority: 0.9,
  datetime: 0.8,  // per date/time choice read
  pick: 0.8,      // the line-picking choice
};

const opt = (xs) => Object.fromEntries(xs.map((x) => [String(x), null]));

// ---------------------------------------------------------------- state

export function buildState(input) {
  const lines = String(input.ticket_log ?? '')
    .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return {
    policy_text: String(input.policy_text ?? ''),
    ticket_log: String(input.ticket_log ?? ''),
    ticket_lines: lines, // every line kept: no pre-filtering (rule 16)
  };
}

// ------------------------------------------------------------- questions

const dtQuestions = (prefix, where) => ({
  [`${prefix}_year`]: {
    type: 'choice',
    instructions: `In ${where}, what is the year of the timestamp?`,
    criteria: { ...opt(YEARS), absent: 'no such entry appears in the log' },
  },
  [`${prefix}_month`]: {
    type: 'choice',
    instructions: `In ${where}, what is the month of the timestamp?`,
    criteria: opt(MONTHS),
  },
  [`${prefix}_day`]: {
    type: 'choice',
    instructions: `In ${where}, what is the day of the month of the timestamp?`,
    criteria: opt(Array.from({ length: 31 }, (_, i) => i + 1)),
  },
  [`${prefix}_hour`]: {
    type: 'choice',
    instructions: `In ${where}, what is the hour of the timestamp on the 24-hour clock?`,
    criteria: opt(Array.from({ length: 24 }, (_, i) => i)),
  },
  [`${prefix}_minute`]: {
    type: 'choice',
    instructions: `In ${where}, what is the minute of the timestamp?`,
    criteria: opt(Array.from({ length: 60 }, (_, i) => i)),
  },
});

export function questions(input) {
  const { ticket_lines } = buildState(input);
  return {
    // --- the policy text must match what this map implements, else abstain.
    policy_targets_ok: {
      type: 'noul',
      instructions: 'Does `policy_text` state these first-response targets: Urgent within 1 hour around the clock (all days, all hours); High within 4 business hours; Normal within 2 business days (16 business hours); Low within 2 business days (16 business hours)?',
      criteria: { true: 'the targets stated are exactly these', false: 'any target differs or is missing' },
    },
    policy_hours_ok: {
      type: 'noul',
      instructions: 'Does `policy_text` state that business hours run from 09:00 to 17:00 UTC, Monday to Friday?',
      criteria: { true: 'the business hours stated are exactly these', false: 'the hours, days or timezone differ' },
    },
    policy_holidays_ok: {
      type: 'noul',
      instructions: 'Does `policy_text` exclude exactly these public holidays from business hours: 2026-01-01, 2026-04-03, 2026-05-25 and 2026-12-25, and no others?',
      criteria: { true: 'the excluded holidays are exactly these', false: 'any holiday differs, is extra, or is missing' },
    },
    policy_rules_ok: {
      type: 'noul',
      instructions: 'Does `policy_text` state that the priority the ticket had when it was opened is the one that applies even if changed later, and that only a reply from a support agent counts as a first response, while customer messages and automatic acknowledgements do not?',
      criteria: { true: 'both rules are stated', false: 'either rule is missing or differs' },
    },

    // --- case facts.
    timestamps_utc: {
      type: 'noul',
      instructions: 'Are all timestamps in `ticket_log` stated in UTC?',
      criteria: { true: 'every timestamp is explicitly in UTC', false: 'some timestamp is in another timezone or states no timezone' },
    },
    sla_exception_claim: { // detector beside a manipulable judgment (rule 15)
      type: 'noul',
      instructions: 'Does any text in `ticket_log` claim that the first-response SLA for this ticket was paused, waived, extended, or otherwise does not apply?',
      criteria: { true: 'some entry asserts such an SLA exception', false: 'no entry asserts any SLA exception' },
    },
    opening_priority: {
      type: 'choice',
      instructions: 'According to `ticket_log`, what priority did the ticket have at the moment it was opened? Use only the priority stated in the entry that records the ticket being opened; ignore any priority change recorded later.',
      criteria: {
        urgent: 'the ticket was opened with priority Urgent',
        high: 'the ticket was opened with priority High',
        normal: 'the ticket was opened with priority Normal',
        low: 'the ticket was opened with priority Low',
      },
    },
    ...dtQuestions('opened', 'the entry of `ticket_log` that records the ticket being opened by the customer'),
    reply_entry: { // pick one of many with a single choice (rule 10)
      type: 'choice',
      instructions: 'Which entry of `ticket_lines` is the first reply from a support agent to the customer? A message from the customer is not a reply from a support agent, and an automatic acknowledgement (an automated confirmation that the ticket was received) is not a reply from a support agent. If no reply from a support agent appears anywhere in `ticket_log`, choose no_agent_reply.',
      criteria: {
        ...Object.fromEntries(ticket_lines.map((text, i) => [String(i), text])),
        no_agent_reply: 'no reply from a support agent appears anywhere in the log',
      },
    },
    ...dtQuestions('reply', 'the entry of `ticket_log` that is the first reply from a support agent'),
  };
}

// ---------------------------------------------------------------- decide

const ABSTAIN = { breached: 'abstain' };

function readStamp(answers, prefix) {
  const pick = (id) => {
    const a = answers[id];
    if (!a) return null;
    if ((a.probabilities?.[a.choice] ?? 0) < GATES.datetime) return null;
    return a.choice;
  };
  const y = pick(`${prefix}_year`);
  if (y === null || y === 'absent') return null;
  const mo = pick(`${prefix}_month`);
  const d = pick(`${prefix}_day`);
  const h = pick(`${prefix}_hour`);
  const mi = pick(`${prefix}_minute`);
  if (mo === null || d === null || h === null || mi === null) return null;
  const Y = Number(y), M = MONTHS.indexOf(mo) + 1, D = Number(d), H = Number(h), Min = Number(mi);
  if (M === 0) return null;
  const ms = Date.UTC(Y, M - 1, D, H, Min); // round-trip sanity check
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== Y || dt.getUTCMonth() !== M - 1 || dt.getUTCDate() !== D ||
      dt.getUTCHours() !== H || dt.getUTCMinutes() !== Min) return null;
  return ms;
}

function isBusinessDay(dayStartMs) {
  const dt = new Date(dayStartMs);
  const wd = dt.getUTCDay();
  if (wd === 0 || wd === 6) return false;
  return !POLICY.holidays.has(dt.toISOString().slice(0, 10));
}

// Add `minutes` of business time to `fromMs`; returns the deadline in ms.
function addBusinessMinutes(fromMs, minutes) {
  const DAY = 86400000;
  const OPEN = POLICY.open_utc_hour * 3600000;
  const CLOSE = POLICY.close_utc_hour * 3600000;
  const f = new Date(fromMs);
  let day = Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate());
  let t = fromMs - day;
  let rem = minutes * 60000;
  for (let i = 0; i < 400; i++) { // bounded loop; ~2 business years is plenty
    if (isBusinessDay(day)) {
      const start = Math.max(t, OPEN);
      if (start < CLOSE) {
        const avail = CLOSE - start;
        if (rem <= avail) return day + start + rem;
        rem -= avail;
      }
    }
    day += DAY;
    t = OPEN;
  }
  return Infinity;
}

export function decide(answers, input) {
  const noulP = (id) => answers[id]?.noul ?? 0;
  const choiceP = (id) => {
    const a = answers[id];
    return a ? (a.probabilities?.[a.choice] ?? 0) : 0;
  };

  // The policy must match the constants this map implements (rule 13).
  for (const id of ['policy_targets_ok', 'policy_hours_ok', 'policy_holidays_ok', 'policy_rules_ok']) {
    if (noulP(id) < GATES.policy) return ABSTAIN;
  }
  if (noulP('timestamps_utc') < GATES.utc) return ABSTAIN;

  // Detector veto: any claim of an SLA exception goes to a person (rule 15).
  if (noulP('sla_exception_claim') >= GATES.exception) return ABSTAIN;

  const prio = answers.opening_priority?.choice;
  if (!prio || choiceP('opening_priority') < GATES.priority) return ABSTAIN;

  const openedMs = readStamp(answers, 'opened');
  if (openedMs === null) return ABSTAIN;

  const entry = answers.reply_entry?.choice;
  // No agent reply yet: we cannot know "now", so a person decides.
  if (!entry || entry === 'no_agent_reply' || choiceP('reply_entry') < GATES.pick) return ABSTAIN;

  const replyMs = readStamp(answers, 'reply');
  if (replyMs === null) return ABSTAIN;
  if (replyMs < openedMs) return ABSTAIN; // inconsistent log

  const deadlineMs = prio === 'urgent'
    ? openedMs + POLICY.urgent_clock_minutes * 60000 // around the clock
    : addBusinessMinutes(
        openedMs,
        prio === 'high' ? POLICY.high_business_minutes : POLICY.normal_low_business_minutes);

  return { breached: replyMs > deadlineMs ? 'yes' : 'no' };
}
