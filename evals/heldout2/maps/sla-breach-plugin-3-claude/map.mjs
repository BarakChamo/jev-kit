// SLA first-response breach check, built on Jev.
//
// Design: Jev answers small, present-tense, scoped facts (which log entry is
// the open event / first qualifying agent reply, the priority at open, the
// business-hours window and business-day set, and the target magnitude/unit
// per priority). All comparison and business-hour arithmetic happens here in
// code (rules 8 & 9). Every gate that isn't decisively answered -> abstain.

const CONF_MIN = 0.65;
const DECISIVE = 0.2; // noul: true if p >= 1-DECISIVE, false if p <= DECISIVE
const MAX_ENTRIES = 254; // choice options cap is 255; leave room for "none"
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const PRIORITIES = ['urgent', 'high', 'normal', 'low'];

function parseEntries(ticketLog) {
  const lines = String(ticketLog || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const re = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})\s*UTC/;
  const entries = [];
  for (const line of lines) {
    const m = line.match(re);
    if (m) {
      entries.push({ text: line, dateISO: m[1], hour: Number(m[2]), minute: Number(m[3]) });
    } else if (entries.length) {
      entries[entries.length - 1].text += ' ' + line;
    }
  }
  return entries;
}

function extractHolidays(policyText) {
  const dateRe = /\d{4}-\d{2}-\d{2}/g;
  const sentences = String(policyText || '').split(/(?<=[.\n])/);
  const holidays = new Set();
  for (const s of sentences) {
    if (/holiday/i.test(s)) {
      for (const d of s.match(dateRe) || []) holidays.add(d);
    }
  }
  return [...holidays];
}

function deriveFacts(input) {
  const entries = parseEntries(input.ticket_log);
  const holidays = extractHolidays(input.policy_text);
  return { entries, holidays };
}

function entryDate(entry) {
  const [y, m, d] = entry.dateISO.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, entry.hour, entry.minute));
}

// startMinute/endMinute are minutes-of-day (0-1439) so the window never needs fractional hours.
function computeBusinessHours(start, end, bizDays, startMinute, endMinute, holidays) {
  let totalMs = 0;
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cursor <= endDay) {
    const y = cursor.getUTCFullYear(), m = cursor.getUTCMonth(), d = cursor.getUTCDate();
    const dow = cursor.getUTCDay();
    const iso = `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (bizDays.has(dow) && !holidays.has(iso)) {
      const dayBase = Date.UTC(y, m, d, 0, 0);
      const dayStart = dayBase + startMinute * 60000;
      const dayEnd = dayBase + endMinute * 60000;
      const overlapStart = Math.max(dayStart, start.getTime());
      const overlapEnd = Math.min(dayEnd, end.getTime());
      if (overlapEnd > overlapStart) totalMs += overlapEnd - overlapStart;
    }
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return totalMs / 3600000;
}

function range(a, b) {
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

export function buildState(input) {
  const { entries, holidays } = deriveFacts(input);
  return {
    policy_text: input.policy_text,
    ticket_log: input.ticket_log,
    entries: entries.map((e, i) => ({ index: i, text: e.text })),
    holidays_found_in_policy_text: holidays,
  };
}

export function questions(input) {
  const { entries } = deriveFacts(input);
  const capped = entries.slice(0, MAX_ENTRIES);

  const entryCriteria = {};
  capped.forEach((e, i) => {
    entryCriteria[`entry_${i}`] = e.text;
  });

  const q = {
    first_entry_is_open: {
      type: 'noul',
      instructions:
        "In `entries` (the parsed lines of `ticket_log`, in order), does entry 0 (the first entry) describe the ticket being opened/created?",
      criteria: { true: 'entry 0 is the ticket-opening event', false: 'entry 0 is something else, or the ticket was opened by a different entry' },
    },
    priority_at_open: {
      type: 'choice',
      instructions:
        "According to `ticket_log`, what priority did the ticket have at the moment it was opened (its initial priority), regardless of any later changes?",
      criteria: {
        urgent: 'the ticket was opened with priority Urgent',
        high: 'the ticket was opened with priority High',
        normal: 'the ticket was opened with priority Normal',
        low: 'the ticket was opened with priority Low',
      },
    },
    priority_locked_at_open: {
      type: 'noul',
      instructions:
        "Does `policy_text` say the SLA target is determined by the priority the ticket had when it was opened, even if the priority is changed afterward?",
      criteria: {
        true: 'policy_text locks the applicable target to the priority at open',
        false: 'policy_text says a later priority change would change the applicable target, or policy_text does not say',
      },
    },
    first_response_entry: {
      type: 'choice',
      instructions:
        "Which entry in `entries` is the FIRST reply from a support agent, after the ticket was opened? Only a reply from a support agent counts as a first response; customer messages and automatic/system acknowledgements do not count, per `policy_text` and `ticket_log`. Choose \"none\" if no entry is a qualifying support-agent reply.",
      criteria: { ...entryCriteria, none: 'no entry in entries is a qualifying support-agent reply' },
    },
    biz_hours_timezone: {
      type: 'choice',
      instructions: "What timezone does `policy_text` state its business hours in?",
      criteria: {
        utc: 'policy_text states business hours in UTC, or does not mention any other timezone',
        other: 'policy_text explicitly states business hours in a timezone other than UTC',
      },
    },
    biz_start_hour: {
      type: 'choice',
      instructions: "What hour (UTC, 0-23) does `policy_text` state business hours BEGIN at?",
      criteria: Object.fromEntries(range(0, 23).map((h) => [String(h), `business hours begin at ${String(h).padStart(2, '0')}:00`])),
    },
    biz_start_minute: {
      type: 'choice',
      instructions: "What minute (0-59) does `policy_text` state business hours BEGIN at (0 if only an hour is given)?",
      criteria: Object.fromEntries(range(0, 59).map((m) => [String(m), `business hours begin at minute ${m}`])),
    },
    biz_end_hour: {
      type: 'choice',
      instructions: "What hour (UTC, 0-23) does `policy_text` state business hours END at?",
      criteria: Object.fromEntries(range(0, 23).map((h) => [String(h), `business hours end at ${String(h).padStart(2, '0')}:00`])),
    },
    biz_end_minute: {
      type: 'choice',
      instructions: "What minute (0-59) does `policy_text` state business hours END at (0 if only an hour is given)?",
      criteria: Object.fromEntries(range(0, 59).map((m) => [String(m), `business hours end at minute ${m}`])),
    },
  };

  for (const day of WEEKDAYS) {
    q[`biz_day_${day}`] = {
      type: 'noul',
      instructions: `Does \`policy_text\` include ${day.charAt(0).toUpperCase() + day.slice(1)} as a business day (business hours apply that weekday)?`,
      criteria: { true: `${day} is a business day under policy_text`, false: `${day} is not a business day under policy_text` },
    };
  }

  for (const p of PRIORITIES) {
    q[`target_unit_${p}`] = {
      type: 'choice',
      instructions: `What unit does \`policy_text\` use for the first-response target time for priority ${p}?`,
      criteria: {
        hours: 'a number of clock hours, around the clock, not restricted to business hours',
        business_hours: 'a number of business hours',
        business_days: 'a number of business days',
        other: 'a different or unclear unit, or policy_text does not state a target for this priority',
      },
    };
    q[`target_magnitude_${p}`] = {
      type: 'choice',
      instructions: `What is the numeric magnitude of the first-response target time for priority ${p} in \`policy_text\` (the number attached to its unit, e.g. the 4 in "within 4 business hours")?`,
      criteria: {
        ...Object.fromEntries(range(1, 100).map((n) => [String(n), `the target number is ${n}`])),
        other: 'not a whole number from 1 to 100, or policy_text does not state a target for this priority',
      },
    };
  }

  return q;
}

function choiceOk(ans) {
  return !!ans && typeof ans.confidence === 'number' && ans.confidence >= CONF_MIN;
}

function noulDecision(ans) {
  if (!ans || typeof ans.noul !== 'number') return null;
  if (ans.noul >= 1 - DECISIVE) return true;
  if (ans.noul <= DECISIVE) return false;
  return null;
}

export function decide(answers, input) {
  const abstain = { breached: 'abstain' };
  const { entries, holidays } = deriveFacts(input);

  if (entries.length === 0 || entries.length > MAX_ENTRIES) return abstain;

  if (noulDecision(answers.first_entry_is_open) !== true) return abstain;
  if (noulDecision(answers.priority_locked_at_open) !== true) return abstain;

  const prioAns = answers.priority_at_open;
  if (!choiceOk(prioAns) || !PRIORITIES.includes(prioAns.choice)) return abstain;
  const priority = prioAns.choice;

  const respAns = answers.first_response_entry;
  if (!choiceOk(respAns)) return abstain;

  const openEntry = entries[0];
  let responseEntry;
  if (respAns.choice === 'none') {
    responseEntry = entries[entries.length - 1]; // no reply yet: evaluate as of the last known log event
  } else {
    const m = /^entry_(\d+)$/.exec(respAns.choice);
    if (!m) return abstain;
    const idx = Number(m[1]);
    if (idx < 0 || idx >= entries.length) return abstain;
    responseEntry = entries[idx];
  }

  const openDate = entryDate(openEntry);
  const responseDate = entryDate(responseEntry);
  if (!(responseDate.getTime() >= openDate.getTime())) return abstain;

  const unitAns = answers[`target_unit_${priority}`];
  const magAns = answers[`target_magnitude_${priority}`];
  if (!choiceOk(unitAns) || unitAns.choice === 'other') return abstain;
  if (!choiceOk(magAns) || magAns.choice === 'other') return abstain;
  const magnitude = Number(magAns.choice);

  if (unitAns.choice === 'hours') {
    const elapsedHours = (responseDate.getTime() - openDate.getTime()) / 3600000;
    return { breached: elapsedHours > magnitude ? 'yes' : 'no' };
  }

  // business_hours / business_days: need the business-hours window, days and holidays.
  const tzAns = answers.biz_hours_timezone;
  if (!choiceOk(tzAns) || tzAns.choice !== 'utc') return abstain;

  const startHourAns = answers.biz_start_hour;
  const startMinAns = answers.biz_start_minute;
  const endHourAns = answers.biz_end_hour;
  const endMinAns = answers.biz_end_minute;
  if (!choiceOk(startHourAns) || !choiceOk(startMinAns) || !choiceOk(endHourAns) || !choiceOk(endMinAns)) return abstain;
  const startMinute = Number(startHourAns.choice) * 60 + Number(startMinAns.choice);
  const endMinute = Number(endHourAns.choice) * 60 + Number(endMinAns.choice);
  if (!(endMinute > startMinute)) return abstain;

  const bizDays = new Set();
  for (const day of WEEKDAYS) {
    const decision = noulDecision(answers[`biz_day_${day}`]);
    if (decision === null) return abstain;
    if (decision) bizDays.add(WEEKDAYS.indexOf(day));
  }
  if (bizDays.size === 0) return abstain;

  const holidaySet = new Set(holidays);
  const hoursPerDay = (endMinute - startMinute) / 60;
  const targetHours = unitAns.choice === 'business_days' ? magnitude * hoursPerDay : magnitude;

  const elapsedBizHours = computeBusinessHours(openDate, responseDate, bizDays, startMinute, endMinute, holidaySet);
  return { breached: elapsedBizHours > targetHours ? 'yes' : 'no' };
}
