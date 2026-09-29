// map.mjs — first-response SLA breach check, built on Jev (TypeSafe System One).
//
// Division of labour (jev-questions skill):
//  - Jev reads *stated facts only*: which log entry opened the ticket, which entry is
//    the first support-agent reply, the exact year/month/day/hour/minute of each,
//    the priority at opening, and the policy's target numbers/units/clocks,
//    business hours, business days and holidays.
//  - Code does all arithmetic: business-hours clocks, deadlines, the breach comparison.
//  - Every read is gated on the probability of the label acted on; anything unsure,
//    missing or contradictory becomes "abstain" (a person decides), never a guess.
//  - Gates are placeholders at 0.8; fit them per question with jev-audit before trusting.
//
// Policy clauses covered, each with a field: targets per priority (target_value/unit/clock_<p>),
// business hours (bh_start_hour/bh_end_hour), business days (bh_days), holidays
// (holiday_<date> + mentions_holidays detector), priority-at-opening rule (priority_at_open
// wording), only-agent-replies rule (first_response_line criteria). Any claim of a paused,
// extended or waived clock is unmodelled -> detector question -> abstain.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const YEARS = Array.from({ length: 21 }, (_, i) => 2018 + i);
const GATE = 0.8;      // act-gate on choice labels (fit with jev-audit)
const NOUL_GATE = 0.5; // gate on noul probabilities
const MS_DAY = 86400000;

const opts = (xs) => Object.fromEntries(xs.map(String).map((s) => [s, null]));
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// Candidate priority names: bullet lines of the policy plus the common set.
// Lines like "Normal and Low:" are grouped targets, not priority names; the standard
// names cover them and the target questions explicitly allow grouped lines.
function candidatePriorities(policyText) {
  const seen = new Set();
  const out = [];
  const add = (n) => {
    n = n.trim();
    const k = n.toLowerCase();
    if (!k || seen.has(k) || out.length >= 12) return;
    if (/\b(and|or|&)\b/i.test(n)) return; // grouped line, not a single priority
    seen.add(k);
    out.push(n);
  };
  for (const m of policyText.matchAll(/(?:^|\n)\s*(?:[-*•·]|\d+[.)])\s*([A-Za-z][A-Za-z0-9 /_-]{0,28}?)\s*:/g)) add(m[1]);
  for (const n of ['Urgent', 'High', 'Normal', 'Low', 'Medium', 'Critical', 'P1', 'P2', 'P3', 'P4']) add(n);
  return out;
}

// Candidate holiday dates: ISO dates stated in the policy; each is confirmed by a noul.
function extractDates(policyText) {
  const out = [];
  const seen = new Set();
  for (const m of policyText.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    const s = `${m[1]}-${m[2]}-${m[3]}`;
    if (!seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out;
}

export function buildState(input) {
  const log = String(input?.ticket_log ?? '');
  const lines = log.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return {
    policy_text: String(input?.policy_text ?? ''),
    ticket_log: log,
    ticket_log_lines: lines,
  };
}

export function questions(input) {
  const { policy_text, ticket_log_lines: lines } = buildState(input);
  const priorities = candidatePriorities(policy_text);
  const dates = extractDates(policy_text);
  const q = {};

  const lineCriteria = Object.fromEntries(lines.map((t, i) => [String(i), t]));
  lineCriteria.none = 'No entry of the log does this';

  q.opened_line = {
    type: 'choice',
    instructions: 'Which entry in `ticket_log_lines` records this ticket being opened or created, together with the priority it had at that moment? Not a reply, not a status change, and not a later priority change.',
    criteria: lineCriteria,
  };
  q.first_response_line = {
    type: 'choice',
    instructions: 'Which entry in `ticket_log_lines` is the first response to the customer from a support agent? Choose the earliest entry in which a human support agent replies to the customer. Entries written by the customer, automatic acknowledgements or confirmations, internal notes, and status or priority changes do not count. If no entry is a reply from a support agent, choose none.',
    criteria: lineCriteria,
  };

  // Exact timestamp reads, one small question per part per line (no date arithmetic in Jev).
  lines.forEach((_, i) => {
    q[`t_year_${i}`] = { type: 'choice', instructions: `In which year is the event in \`ticket_log_lines[${i}]\` timestamped (UTC)? If that entry has no timestamp, choose no_timestamp.`, criteria: opts([...YEARS, 'no_timestamp']) };
    q[`t_month_${i}`] = { type: 'choice', instructions: `In which month is the event in \`ticket_log_lines[${i}]\` timestamped (UTC)? If that entry has no timestamp, choose no_timestamp.`, criteria: opts([...MONTHS, 'no_timestamp']) };
    q[`t_day_${i}`] = { type: 'choice', instructions: `On which day of the month is the event in \`ticket_log_lines[${i}]\` timestamped (UTC)? If that entry has no timestamp, choose no_timestamp.`, criteria: opts([...Array.from({ length: 31 }, (_, k) => k + 1), 'no_timestamp']) };
    q[`t_hour_${i}`] = { type: 'choice', instructions: `In which hour of the day (0-23, UTC) is the event in \`ticket_log_lines[${i}]\` timestamped? 15:30 UTC is hour 15. If that entry has no timestamp, choose no_timestamp.`, criteria: opts([...Array.from({ length: 24 }, (_, k) => k), 'no_timestamp']) };
    q[`t_minute_${i}`] = { type: 'choice', instructions: `In which minute of the hour (0-59, UTC) is the event in \`ticket_log_lines[${i}]\` timestamped? 15:30 UTC is minute 30. If that entry has no timestamp, choose no_timestamp.`, criteria: opts([...Array.from({ length: 60 }, (_, k) => k), 'no_timestamp']) });
  });

  const prioCriteria = Object.fromEntries(priorities.map((p) => [p, `Priority named "${p}"`]));
  prioCriteria.not_stated = 'The log does not state the priority the ticket had when it was opened';
  q.priority_at_open = {
    type: 'choice',
    instructions: 'What priority did the ticket have at the moment it was opened, according to `ticket_log`? Ignore any later priority change: the priority at opening is the one that applies.',
    criteria: prioCriteria,
  };

  // The policy's target for each candidate priority, read as stated number + unit + clock.
  for (const p of priorities) {
    const s = slugify(p);
    q[`target_value_${s}`] = {
      type: 'choice',
      instructions: `According to \`policy_text\`, what number does the first-response target for tickets of priority "${p}" state? "within 4 business hours" states 4; "within 2 business days" states 2; "within 1 hour" states 1. If the target is stated two ways, such as "2 business days (16 business hours)", prefer the figure in days. If \`policy_text\` groups "${p}" with other priorities in one line, use that line. If \`policy_text\` defines no first-response target for "${p}", choose not_defined.`,
      criteria: opts(['15', '30', '1', '2', '3', '4', '6', '8', '12', '16', '24', '48', 'other', 'not_defined']),
    };
    q[`target_unit_${s}`] = {
      type: 'choice',
      instructions: `Which unit does \`policy_text\` attach to that first-response target number for priority "${p}"? Phrases like "around the clock" or "business hours are 09:00 to 17:00" are not the unit: "within 1 hour, around the clock" has unit hours, and "within 4 business hours" has unit business_hours. If \`policy_text\` defines no first-response target for "${p}", choose not_defined.`,
      criteria: {
        minutes: 'the number counts minutes',
        hours: 'the number counts hours (hours of any kind)',
        days: 'the number counts days of 24 hours',
        business_hours: 'the number counts business hours only',
        business_days: 'the number counts business days',
        other: 'some other unit',
        not_defined: `no first-response target for "${p}"`,
      },
    };
    q[`target_clock_${s}`] = {
      type: 'choice',
      instructions: `For a ticket of priority "${p}", does \`policy_text\` count the first-response target only during business hours, or during all hours around the clock (all days, all hours)? If \`policy_text\` does not say which hours count for this priority, choose not_stated.`,
      criteria: {
        business_hours_only: 'only business hours count toward the target',
        all_hours_all_days: 'all hours on all days count',
        not_stated: `the policy does not say which hours count for "${p}"`,
      },
    };
  }

  q.bh_start_hour = { type: 'choice', instructions: 'At which hour of the day (UTC) does the business day start, according to `policy_text`? "09:00 to 17:00" starts at 9. If `policy_text` defines no business hours, choose not_stated.', criteria: opts([...Array.from({ length: 24 }, (_, k) => k), 'not_stated']) };
  q.bh_end_hour = { type: 'choice', instructions: 'At which hour of the day (UTC) does the business day end, according to `policy_text`? "09:00 to 17:00" ends at 17. If `policy_text` defines no business hours, choose not_stated.', criteria: opts([...Array.from({ length: 24 }, (_, k) => k), 'not_stated']) };
  q.bh_days = { type: 'choice', instructions: 'Which days of the week are business days, according to `policy_text`? Public holidays are handled separately; answer for the days of the week only. If `policy_text` does not say, choose not_stated.', criteria: { monday_to_friday: 'Monday to Friday', monday_to_saturday: 'Monday to Saturday', all_seven_days: 'every day of the week', not_stated: 'the policy does not say which days are business days' } };
  q.default_clock = { type: 'choice', instructions: 'When `policy_text` states a first-response target in plain hours or days, without saying which hours count, does that target run during business hours only, or during all hours around the clock? If every target in `policy_text` says which hours count, or there is no such plain target, choose not_stated.', criteria: { business_hours_only: 'plain-hour targets run during business hours only', all_hours_all_days: 'plain-hour targets run around the clock', not_stated: 'no plain target, or the policy does not say' } };

  for (const d of dates) {
    q[`holiday_${d}`] = { type: 'noul', instructions: `Does \`policy_text\` exclude ${d} as a public holiday, so that it does not count as a business day?`, criteria: { true: `${d} is listed as an excluded public holiday`, false: `${d} is not listed as an excluded public holiday` } };
  }
  q.mentions_holidays = { type: 'noul', instructions: 'Does `policy_text` name any public holidays that are excluded from business days or business hours?', criteria: { true: 'the policy excludes at least one named public holiday', false: 'the policy excludes no public holidays' } };

  // Detector beside the judgment (rule 15): a claim of a paused/extended/waived clock is
  // unmodelled policy; Jev detects it better than it resists it, so let the detector veto.
  q.sla_pause_claim = { type: 'noul', instructions: 'Does any entry in `ticket_log_lines` claim that the first-response SLA clock for this ticket was paused, extended, reset, or waived? Ordinary replies, status changes, and priority changes do not count.', criteria: { true: 'some entry claims the SLA clock was paused, extended, reset, or waived', false: 'no entry claims that' } };

  return q;
}

function readPart(answers, i, suffix, parse) {
  const a = answers[`t_${suffix}_${i}`];
  if (!a || a.type !== 'choice' || a.choice === 'no_timestamp') return null;
  if ((a.probabilities?.[a.choice] ?? 0) < GATE) return null;
  const v = parse(a.choice);
  return Number.isFinite(v) ? v : null;
}

function readTimestamp(answers, i) {
  const y = readPart(answers, i, 'year', Number);
  const mo = readPart(answers, i, 'month', (c) => { const k = MONTHS.indexOf(c); return k >= 0 ? k : NaN; });
  const d = readPart(answers, i, 'day', Number);
  const h = readPart(answers, i, 'hour', Number);
  const mi = readPart(answers, i, 'minute', Number);
  if (y === null || mo === null || d === null || h === null || mi === null) return null;
  const dt = new Date(Date.UTC(y, mo, d, h, mi));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo || dt.getUTCDate() !== d) return null; // e.g. 31 February
  return dt;
}

// Walk the business-hours calendar from `fromMs`, consuming `targetMs` of business time.
function businessDeadline(fromMs, targetMs, bh) {
  const dowOk = (t) => {
    const dow = new Date(t).getUTCDay();
    return bh.days === 'all_seven_days' ? true : bh.days === 'monday_to_saturday' ? dow >= 1 && dow <= 6 : dow >= 1 && dow <= 5;
  };
  const isHoliday = (t) => bh.holidays.has(new Date(t).toISOString().slice(0, 10));
  let cur = fromMs, remaining = targetMs, guard = 0;
  while (remaining > 0) {
    if (++guard > 3000) return null;
    const d = new Date(cur);
    const ds = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), bh.start, 0, 0);
    const de = ds + bh.lengthMs;
    if (!dowOk(cur) || isHoliday(cur)) { cur = ds + MS_DAY; continue; }
    const s = Math.max(cur, ds);
    if (s >= de) { cur = ds + MS_DAY; continue; }
    const avail = de - s;
    if (avail >= remaining) return s + remaining;
    remaining -= avail;
    cur = ds + MS_DAY;
  }
  return cur;
}

export function decide(answers, input) {
  const { policy_text, ticket_log_lines: lines } = buildState(input);
  const dates = extractDates(policy_text);
  const abstain = { breached: 'abstain' };

  const choice = (id) => {
    const a = answers[id];
    if (!a || a.type !== 'choice') return null;
    return { c: a.choice, p: a.probabilities?.[a.choice] ?? 0 };
  };
  const noul = (id) => (typeof answers[id]?.noul === 'number' ? answers[id].noul : null);

  // Unmodelled claim in the log -> a person decides.
  if ((noul('sla_pause_claim') ?? 0) > NOUL_GATE) return abstain;

  const opened = choice('opened_line');
  const fr = choice('first_response_line');
  if (!opened || !fr || opened.c === 'none' || fr.c === 'none' || opened.p < GATE || fr.p < GATE) return abstain;
  const oi = Number(opened.c), ri = Number(fr.c);
  if (!Number.isInteger(oi) || !Number.isInteger(ri) || oi === ri || oi >= lines.length || ri >= lines.length) return abstain;

  const openTime = readTimestamp(answers, oi);
  const replyTime = readTimestamp(answers, ri);
  if (!openTime || !replyTime || replyTime.getTime() < openTime.getTime()) return abstain;

  const pr = choice('priority_at_open');
  if (!pr || pr.c === 'not_stated' || pr.p < GATE) return abstain;
  const s = slugify(pr.c);

  const tv = choice(`target_value_${s}`);
  const tu = choice(`target_unit_${s}`);
  const tc = choice(`target_clock_${s}`);
  if (!tv || !tu || !tc || tv.p < GATE || tu.p < GATE) return abstain;
  if (tv.c === 'not_defined' || tv.c === 'other' || tu.c === 'not_defined' || tu.c === 'other') return abstain;
  const value = Number(tv.c);
  if (!Number.isFinite(value) || value <= 0) return abstain;

  // Which clock applies: the priority's own statement, else its unit, else the policy default.
  const unitBusiness = tu.c === 'business_hours' || tu.c === 'business_days';
  let businessClock = null;
  if (tc.p >= GATE && tc.c !== 'not_stated') businessClock = tc.c === 'business_hours_only';
  else if (unitBusiness) businessClock = true;
  else {
    const dc = choice('default_clock');
    if (dc && dc.c !== 'not_stated' && dc.p >= GATE) businessClock = dc.c === 'business_hours_only';
  }
  if (businessClock === null || (unitBusiness && !businessClock)) return abstain; // undecided or contradictory

  let bh = null;
  if (businessClock) {
    const bhs = choice('bh_start_hour'), bhe = choice('bh_end_hour'), bhd = choice('bh_days');
    if (!bhs || !bhe || !bhd || bhs.c === 'not_stated' || bhe.c === 'not_stated' || bhd.c === 'not_stated') return abstain;
    if (bhs.p < GATE || bhe.p < GATE || bhd.p < GATE) return abstain;
    const start = Number(bhs.c), end = Number(bhe.c);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end || end > 24) return abstain;
    const holidays = new Set(dates.filter((d) => (noul(`holiday_${d}`) ?? 0) > NOUL_GATE));
    // Holidays exist but were not read as dates -> missing premise -> a person.
    if ((noul('mentions_holidays') ?? 0) > NOUL_GATE && holidays.size === 0) return abstain;
    bh = { start, end, lengthMs: (end - start) * 3600000, days: bhd.c, holidays };
  }

  let targetMs;
  switch (tu.c) {
    case 'minutes': targetMs = value * 60000; break;
    case 'hours': targetMs = value * 3600000; break;
    case 'days': targetMs = value * 86400000; break;
    case 'business_hours': targetMs = value * 3600000; break;          // one business hour = one hour of business time
    case 'business_days': targetMs = value * bh.lengthMs; break;        // a business day is end-start hours
    default: return abstain;
  }

  const deadline = businessClock
    ? businessDeadline(openTime.getTime(), targetMs, bh)
    : openTime.getTime() + targetMs;
  if (deadline === null) return abstain;

  return { breached: replyTime.getTime() > deadline ? 'yes' : 'no' };
}
