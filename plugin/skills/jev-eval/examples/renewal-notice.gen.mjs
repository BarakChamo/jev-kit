// Generates renewal-notice.json: did a cancellation email avoid a contract's automatic renewal?
// Gold is computed by rule from the generated facts, with calendar arithmetic:
//   - a term ends on the same day of the month, N months after the start (the month's last day when it
//     has no such date: a term from January 31 ends February 28);
//   - notice "at least 3 months" before an end date means on or before the same day 3 months earlier;
//     notice in days or weeks counts days;
//   - `avoided` iff the contract auto-renews, allows email, the email clearly refuses renewal, and it
//     arrived on or before the deadline for the term it arrived in. `not_applicable` without auto-renewal.
// Cases 001–030 are the study's cases; 031–042 add month-end dates, short terms, and notice in months
// or weeks where counting 30 days per month gives the wrong answer.
//   node renewal-notice.gen.mjs
import { writeFileSync } from 'node:fs';

const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const long = (t) => new Date(t).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const words = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 6: 'six', 8: 'eight', 30: 'thirty', 45: 'forty-five', 60: 'sixty', 90: 'ninety', 120: 'one hundred twenty' };

/** Calendar months from a date, clamped to the target month's last day. The map uses the same rule. */
export function addMonths(t, m) {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const month = d.getUTCMonth() + m;
  const last = new Date(Date.UTC(y, month + 1, 0)).getUTCDate();
  return Date.UTC(y, month, Math.min(d.getUTCDate(), last));
}

function contract({ start, termMonths, notice, autoRenew, methodEmailOk }) {
  const initialEnd = addMonths(start, termMonths);
  const period = `${words[notice.n] ?? notice.n} (${notice.n}) ${notice.unit}`;
  const renewal = termMonths % 12 === 0 ? `${termMonths === 12 ? 'one year' : `${termMonths / 12} years`}` : `${termMonths} months`;
  const renew = autoRenew
    ? `Upon expiration of the Initial Term, this Agreement shall automatically renew for successive ${termMonths}-month periods (each a "Renewal Term") unless either party gives the other written notice of non-renewal at least ${period} prior to the end of the then-current term.`
    : `This Agreement shall expire at the end of the Initial Term unless the parties agree in writing to extend it.`;
  const method = methodEmailOk
    ? `Notices under this Agreement may be given by email to the addresses in Schedule 1, including legal@vendor.example.`
    : `Notices of non-renewal are effective only if sent by certified mail, return receipt requested, to the address in Schedule 1. Email notice is not sufficient.`;
  return `MASTER SUBSCRIPTION AGREEMENT\n\n1. Services. Vendor will provide the subscription services described in each Order Form.\n\n2. Fees. Customer will pay the fees in each Order Form within thirty days of invoice.\n\n9. Term and Renewal. This Agreement begins on ${long(start)} (the "Effective Date") and continues for an initial term of ${termMonths} months, ending on ${long(initialEnd)} (the "Initial Term"). Each Renewal Term ends on the same day of the month ${renewal} after the term before it, or on the last day of that month if it has no such day. ${renew}\n\n12. Confidentiality. Each party will protect the other's Confidential Information with reasonable care for three years after disclosure.\n\n14. Notices. ${method}\n\n15. Governing Law. This Agreement is governed by the laws of the State of Delaware.`;
}

const emails = {
  clear: 'Hello, please treat this as our formal notice that we will not renew the agreement when the current term ends. Thank you, Robin (Customer Ops)',
  vague: 'Hi, we are reviewing our vendors next year and may not continue. Can you send over pricing for the renewal so we can compare? Thanks, Robin',
};

/** The last day notice can arrive for a term ending at `end`. */
export function deadline(end, { n, unit }) {
  if (unit === 'months') return addMonths(end, -n);
  return end - n * (unit === 'weeks' ? 7 : 1) * DAY;
}

const cases = [];
function add({ start, termMonths = 12, termsElapsed = 0, notice = { n: 60, unit: 'days' }, autoRenew = true, methodEmailOk = true, leadDays, email = 'clear', note }) {
  const s = Date.parse(start);
  const termEnd = addMonths(s, termMonths * (termsElapsed + 1));
  const received = termEnd - leadDays * DAY;
  const onTime = received <= deadline(termEnd, notice);
  const outcome = !autoRenew ? 'not_applicable' : methodEmailOk && email === 'clear' && onTime ? 'avoided' : 'not_avoided';
  cases.push({
    id: `notice-${String(cases.length + 1).padStart(3, '0')}`,
    input: { contract_text: contract({ start: s, termMonths, notice, autoRenew, methodEmailOk }), email_text: emails[email], email_from: 'robin@customer.example', received_date: iso(received) },
    gold: { outcome },
    facts: { term_end: iso(termEnd), deadline: iso(deadline(termEnd, notice)), notice: `${notice.n} ${notice.unit}`, lead_days: leadDays, auto_renews: autoRenew, email_allowed: methodEmailOk, intent_clear: email === 'clear' },
    ...(note ? { notes: note } : {}),
  });
}
const d = (n) => ({ n, unit: 'days' });
const mo = (n) => ({ n, unit: 'months' });

// 001–008: clear margins either way
add({ start: '2025-01-15', notice: d(60), leadDays: 95, note: 'well before' });
add({ start: '2025-03-01', notice: d(60), leadDays: 20, note: 'well after' });
add({ start: '2025-02-10', notice: d(30), leadDays: 70 });
add({ start: '2025-06-01', notice: d(30), leadDays: 10 });
add({ start: '2025-04-20', notice: d(90), leadDays: 150 });
add({ start: '2025-05-05', notice: d(90), leadDays: 40 });
add({ start: '2025-07-01', notice: d(120), leadDays: 200 });
add({ start: '2025-08-12', notice: d(120), leadDays: 60 });
// 009–017: near the boundary
add({ start: '2025-01-31', notice: d(60), leadDays: 64, note: 'four days early' });
add({ start: '2025-02-28', notice: d(60), leadDays: 56, note: 'four days late' });
add({ start: '2025-09-15', notice: d(30), leadDays: 34 });
add({ start: '2025-10-01', notice: d(30), leadDays: 26 });
add({ start: '2025-03-15', notice: d(90), leadDays: 95 });
add({ start: '2025-11-20', notice: d(90), leadDays: 85 });
add({ start: '2025-06-30', notice: d(45), leadDays: 49 });
add({ start: '2025-12-01', notice: d(45), leadDays: 41 });
add({ start: '2025-04-01', notice: d(60), leadDays: 57, note: 'three days late' });
// 018–020: notice stated in months
add({ start: '2025-01-10', notice: mo(3), leadDays: 100, note: '3 months' });
add({ start: '2025-05-18', notice: mo(3), leadDays: 75, note: '3 months, late' });
add({ start: '2025-07-22', notice: mo(2), leadDays: 66, note: '2 months' });
// 021–024: a later renewal term, and 24-month terms
add({ start: '2023-02-01', termsElapsed: 2, notice: d(60), leadDays: 80, note: 'third term' });
add({ start: '2023-09-01', termsElapsed: 2, notice: d(60), leadDays: 30, note: 'third term, late' });
add({ start: '2024-03-10', termMonths: 24, notice: d(90), leadDays: 110, note: '24-month term' });
add({ start: '2024-06-05', termMonths: 24, notice: d(90), leadDays: 70, note: '24-month term, late' });
// 025–030: not about timing
add({ start: '2025-02-01', autoRenew: false, leadDays: 10, note: 'no auto-renewal: nothing to avoid' });
add({ start: '2025-08-01', autoRenew: false, leadDays: 90 });
add({ start: '2025-03-20', methodEmailOk: false, leadDays: 120, note: 'on time but email not a valid method' });
add({ start: '2025-10-10', methodEmailOk: false, notice: d(30), leadDays: 50 });
add({ start: '2025-05-25', email: 'vague', leadDays: 100, note: 'not a notice' });
add({ start: '2025-09-09', email: 'vague', notice: d(30), leadDays: 45 });
// 031–036: notice in months where 30 days a month gives the wrong answer
add({ start: '2025-01-10', notice: mo(3), leadDays: 91, note: '91 days ahead but after the calendar deadline (3 months before Jan 10 is Oct 10): late' });
add({ start: '2025-03-31', notice: mo(1), leadDays: 30, note: 'term ends Mar 31; one month before is Feb 28; 30 days before is Mar 1: late' });
add({ start: '2025-05-31', notice: mo(3), leadDays: 92, note: 'term ends May 31; deadline Feb 28 (92 days): exactly on time' });
add({ start: '2025-08-31', notice: mo(6), leadDays: 181, note: 'term ends Aug 31; deadline Feb 28 is 184 days before: late' });
add({ start: '2025-07-15', notice: mo(2), leadDays: 62, note: 'deadline May 15 is 61 days before: on time' });
add({ start: '2025-10-15', notice: { n: 8, unit: 'weeks' }, leadDays: 55, note: '8 weeks is 56 days: late by one day' });
// 037–042: short terms and month-end starts, where a term end must be computed, not remembered
add({ start: '2025-01-31', termMonths: 1, termsElapsed: 1, notice: d(10), leadDays: 12, note: 'Jan 31 start, monthly: ends Feb 28, then Mar 31' });
add({ start: '2025-01-31', termMonths: 1, termsElapsed: 0, notice: d(10), leadDays: 8, note: 'first term ends Feb 28: late' });
add({ start: '2025-08-31', termMonths: 6, termsElapsed: 1, notice: d(30), leadDays: 40, note: 'Aug 31 start, 6-month terms: Feb 28, then Aug 31' });
add({ start: '2025-11-30', termMonths: 3, termsElapsed: 2, notice: mo(1), leadDays: 25, note: 'quarterly from Nov 30: Feb 28, May 30, Aug 30; late' });
add({ start: '2025-04-30', termMonths: 6, notice: mo(2), leadDays: 70, note: 'ends Oct 30; deadline Aug 30' });
add({ start: '2025-02-15', termMonths: 3, termsElapsed: 3, notice: d(30), leadDays: 45, note: 'fourth quarterly term' });

const count = (o) => cases.filter((c) => c.gold.outcome === o).length;
const suite = {
  name: 'renewal-notice',
  description: `Did a cancellation email avoid a contract's automatic renewal? ${cases.length} cases, gold computed by calendar rule from the generated facts (renewal-notice.gen.mjs). Boundary cases sit a few days either side of the deadline; 031–042 need month-end and calendar-month arithmetic. Grade a map with: jev-run renewal-notice.json --map renewal-notice.map.mjs`,
  cases,
};
if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(new URL('./renewal-notice.json', import.meta.url), JSON.stringify(suite, null, 2) + '\n');
  console.log(`${cases.length} cases: ${count('avoided')} avoided, ${count('not_avoided')} not avoided, ${count('not_applicable')} not applicable`);
  for (const c of cases.slice(30)) console.log(c.id, c.facts.term_end, c.facts.deadline, c.input.received_date, c.gold.outcome);
}
