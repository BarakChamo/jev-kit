// SLA first-response breach check.
//
// Design: dates, numbers and business-hours arithmetic are read/parsed and computed in code
// (regex on state text). Jev is used only for the genuinely judgment-laden extractions:
// which log entry is the ticket-open event, which priority applied at open, which log entry
// (if any) is the first genuine support-agent reply (excluding customer messages and
// automatic/system acknowledgements), and the policy's stated numbers/units, which Jev reads
// as bounded choices rather than free numbers.

const PRIORITIES = ['Urgent', 'High', 'Normal', 'Low'];
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const WEEKDAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

const CHOICE_GATE = 0.6;
const NOUL_GATE = 0.5;
const EPS = 1e-6;

function splitEntries(ticketLog) {
  return String(ticketLog || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function numberOptions(n) {
  const opts = {};
  for (let i = 1; i <= n; i++) opts[String(i)] = `the stated number is exactly ${i}`;
  return opts;
}

function hourOptions() {
  const opts = {};
  for (let i = 0; i < 24; i++) opts[String(i)] = `the stated hour is ${String(i).padStart(2, '0')}:00`;
  return opts;
}

// Extract the first YYYY-MM-DD HH:MM occurring in a string, as a UTC Date.
function extractTimestamp(text) {
  const m = String(text || '').match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
}

// Extract ISO holiday dates from policy text, preferring the text after the word "holiday".
function extractHolidays(policyText) {
  const text = String(policyText || '');
  const idx = text.toLowerCase().indexOf('holiday');
  const scope = idx >= 0 ? text.slice(idx) : text;
  const dates = scope.match(/\d{4}-\d{2}-\d{2}/g) || [];
  return new Set(dates);
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

// Business hours elapsed between two UTC Dates, given the daily window [startHour, endHour),
// a set of business weekday keys ('mon'..'sun'), and a set of holiday date strings.
function businessHoursElapsed(start, end, startHour, endHour, businessDays, holidays) {
  if (end <= start) return 0;
  let total = 0;
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const dayMs = 24 * 3600 * 1000;
  while (cursor.getTime() <= end.getTime()) {
    const wd = WEEKDAYS[(cursor.getUTCDay() + 6) % 7]; // getUTCDay: 0=Sun -> map to mon..sun
    const isBusinessDay = businessDays.has(wd) && !holidays.has(dateKey(cursor));
    if (isBusinessDay) {
      const winStart = new Date(cursor.getTime() + startHour * 3600 * 1000);
      const winEnd = new Date(cursor.getTime() + endHour * 3600 * 1000);
      const overlapStart = start > winStart ? start : winStart;
      const overlapEnd = end < winEnd ? end : winEnd;
      if (overlapEnd > overlapStart) total += (overlapEnd - overlapStart) / 3600000;
    }
    cursor.setTime(cursor.getTime() + dayMs);
  }
  return total;
}

export function buildState(input) {
  const entries = splitEntries(input.ticket_log).map((text, index) => ({ index, text }));
  return {
    policy_text: input.policy_text,
    ticket_log: input.ticket_log,
    entries,
  };
}

export function questions(input) {
  const entries = splitEntries(input.ticket_log);
  const lineOptions = {};
  entries.forEach((_, i) => {
    lineOptions[String(i)] = `entry ${i} in \`entries\` is the one described`;
  });
  const lineOptionsWithNone = { ...lineOptions, none: 'no entry in `entries` qualifies' };

  const q = {
    opened_line: {
      type: 'choice',
      instructions: 'Look at `entries` (the ticket log, split into numbered entries). Which entry index is the one recording that the ticket was opened/created?',
      criteria: lineOptions,
    },
    priority_at_open: {
      type: 'choice',
      instructions: 'Read `entries`. At the moment the ticket was opened (its first, creation entry), what priority was it assigned? Ignore any priority change made in a later entry.',
      criteria: {
        Urgent: 'the ticket was opened with Urgent priority',
        High: 'the ticket was opened with High priority',
        Normal: 'the ticket was opened with Normal priority',
        Low: 'the ticket was opened with Low priority',
      },
    },
    first_response_line: {
      type: 'choice',
      instructions: 'Read `policy_text` and `entries`. Per the policy, only a reply from a support agent to the customer counts as a first response; customer messages and automatic/system acknowledgements do not. Which entry index in `entries` is the FIRST one that is such a genuine support-agent reply? If no entry qualifies, answer "none".',
      criteria: lineOptionsWithNone,
    },
    business_start_hour: {
      type: 'choice',
      instructions: 'Read `policy_text`. What UTC hour (0-23) does the business-hours window start at?',
      criteria: hourOptions(),
    },
    business_end_hour: {
      type: 'choice',
      instructions: 'Read `policy_text`. What UTC hour (0-23) does the business-hours window end at?',
      criteria: hourOptions(),
    },
  };

  for (const wd of WEEKDAYS) {
    q[`business_day_${wd}`] = {
      type: 'noul',
      instructions: `Read \`policy_text\`. Does its business-hours definition include ${WEEKDAY_NAMES[wd]} as a business day?`,
      criteria: { true: `${WEEKDAY_NAMES[wd]} is a business day`, false: `${WEEKDAY_NAMES[wd]} is not a business day` },
    };
  }

  for (const p of PRIORITIES) {
    q[`target_amount_${p}`] = {
      type: 'choice',
      instructions: `Read \`policy_text\`. What is the numeric value of the first-response time target that applies to ${p} priority tickets, exactly as stated (ignore the unit)?`,
      criteria: numberOptions(100),
    };
    q[`target_unit_${p}`] = {
      type: 'choice',
      instructions: `Read \`policy_text\`. The first-response time target for ${p} priority tickets is stated in which unit: plain/calendar hours that apply around the clock including nights, weekends and holidays ("hour"); hours within the business-hours window on business days only ("business_hour"); or a number of full business days, each equal to the business-hours window's length ("business_day")?`,
      criteria: {
        hour: 'stated as calendar/clock hours, around the clock',
        business_hour: 'stated as a number of business hours',
        business_day: 'stated as a number of business days',
      },
    };
  }

  return q;
}

export function decide(answers, input) {
  const entries = splitEntries(input.ticket_log);

  const opened = answers.opened_line;
  const prio = answers.priority_at_open;
  const resp = answers.first_response_line;
  if (!opened || !prio || !resp) return { breached: 'abstain' };
  if (opened.confidence < CHOICE_GATE || prio.confidence < CHOICE_GATE || resp.confidence < CHOICE_GATE) {
    return { breached: 'abstain' };
  }
  if (resp.choice === 'none') return { breached: 'abstain' };

  const openedIdx = parseInt(opened.choice, 10);
  const respIdx = parseInt(resp.choice, 10);
  if (!(openedIdx >= 0 && openedIdx < entries.length)) return { breached: 'abstain' };
  if (!(respIdx >= 0 && respIdx < entries.length)) return { breached: 'abstain' };

  const openTime = extractTimestamp(entries[openedIdx]);
  const respTime = extractTimestamp(entries[respIdx]);
  if (!openTime || !respTime || respTime <= openTime) return { breached: 'abstain' };

  const priority = prio.choice;
  const amtAns = answers[`target_amount_${priority}`];
  const unitAns = answers[`target_unit_${priority}`];
  if (!amtAns || !unitAns || amtAns.confidence < CHOICE_GATE || unitAns.confidence < CHOICE_GATE) {
    return { breached: 'abstain' };
  }
  const amount = parseInt(amtAns.choice, 10);
  const unit = unitAns.choice;

  const startAns = answers.business_start_hour;
  const endAns = answers.business_end_hour;
  if (!startAns || !endAns || startAns.confidence < CHOICE_GATE || endAns.confidence < CHOICE_GATE) {
    return { breached: 'abstain' };
  }
  const startHour = parseInt(startAns.choice, 10);
  const endHour = parseInt(endAns.choice, 10);
  if (!(startHour < endHour)) return { breached: 'abstain' };

  const businessDays = new Set();
  for (const wd of WEEKDAYS) {
    const a = answers[`business_day_${wd}`];
    if (!a) return { breached: 'abstain' };
    if (a.noul >= NOUL_GATE) businessDays.add(wd);
  }

  const holidays = extractHolidays(input.policy_text);

  let elapsedHours;
  let targetHours;
  if (unit === 'hour') {
    elapsedHours = (respTime - openTime) / 3600000;
    targetHours = amount;
  } else {
    elapsedHours = businessHoursElapsed(openTime, respTime, startHour, endHour, businessDays, holidays);
    targetHours = unit === 'business_day' ? amount * (endHour - startHour) : amount;
  }

  return { breached: elapsedHours > targetHours + EPS ? 'yes' : 'no' };
}
