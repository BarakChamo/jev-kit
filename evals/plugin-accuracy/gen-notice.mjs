// Labelled cases for the `notice` task. Gold is computed by rule from the generated facts, so the
// labels are definitional: `not_applicable` when the contract does not auto-renew; otherwise
// `avoided` iff the notice is a clear cancellation, sent by a permitted method, and arrived at least
// the required period before the current term ends; else `not_avoided`. Method and intent are held valid on
// most cases so the case turns on timing, which is where the law-13 trap lives.
import { writeFileSync } from 'node:fs';

const DAY = 86400000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const long = (d) => new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const words = { 30: 'thirty (30)', 45: 'forty-five (45)', 60: 'sixty (60)', 90: 'ninety (90)', 120: 'one hundred twenty (120)' };

function contract({ start, termMonths, noticeDays, noticeAs = 'days', autoRenew = true, methodEmailOk = true }) {
  const initialEnd = addMonths(start, termMonths);
  const notice =
    noticeAs === 'months' ? `${['', 'one', 'two', 'three', 'four'][noticeDays / 30]} (${noticeDays / 30}) months` : `${words[noticeDays] ?? noticeDays} days`;
  const renew = autoRenew
    ? `Upon expiration of the Initial Term, this Agreement shall automatically renew for successive ${termMonths}-month periods (each a "Renewal Term") unless either party gives the other written notice of non-renewal at least ${notice} prior to the end of the then-current term.`
    : `This Agreement shall expire at the end of the Initial Term unless the parties agree in writing to extend it.`;
  const method = methodEmailOk
    ? `Notices under this Agreement may be given by email to the addresses in Schedule 1, including legal@vendor.example.`
    : `Notices of non-renewal are effective only if sent by certified mail, return receipt requested, to the address in Schedule 1. Email notice is not sufficient.`;
  return `MASTER SUBSCRIPTION AGREEMENT\n\n1. Services. Vendor will provide the subscription services described in each Order Form.\n\n2. Fees. Customer will pay the fees in each Order Form within thirty days of invoice.\n\n9. Term and Renewal. This Agreement begins on ${long(start)} (the "Effective Date") and continues for an initial term of ${termMonths} months, ending on ${long(initialEnd)} (the "Initial Term"). Each Renewal Term ends on the same calendar date ${termMonths === 12 ? 'one year' : `${termMonths / 12} years`} after the term before it. ${renew}\n\n12. Confidentiality. Each party will protect the other's Confidential Information with reasonable care for three years after disclosure.\n\n14. Notices. ${method}\n\n15. Governing Law. This Agreement is governed by the laws of the State of Delaware.`;
}

const addMonths = (d, m) => {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + m);
  return x.getTime();
};

const emails = {
  clear: 'Hello, please treat this as our formal notice that we will not renew the agreement when the current term ends. Thank you, Robin (Customer Ops)',
  vague: 'Hi, we are reviewing our vendors next year and may not continue. Can you send over pricing for the renewal so we can compare? Thanks, Robin',
};

const cases = [];
let n = 0;
function add({ start, termMonths = 12, termsElapsed = 0, noticeDays = 60, noticeAs, autoRenew = true, methodEmailOk = true, leadDays, email = 'clear', note }) {
  const termEnd = addMonths(Date.parse(start), termMonths * (termsElapsed + 1));
  const received = termEnd - leadDays * DAY;
  const outcome = !autoRenew ? 'not_applicable' : methodEmailOk && email === 'clear' && leadDays >= noticeDays ? 'avoided' : 'not_avoided';
  const facts = { term_end: iso(termEnd), required_notice_days: noticeDays, actual_lead_days: leadDays, auto_renews: autoRenew, email_allowed: methodEmailOk, intent_clear: email === 'clear' };
  cases.push({
    id: `notice-${String(++n).padStart(3, '0')}`,
    // canonical inputs: an adapter maps these into each map's own state shape
    input: { contract_text: contract({ start: Date.parse(start), termMonths, noticeDays, noticeAs, autoRenew, methodEmailOk }), email_text: emails[email], email_from: 'robin@customer.example', received_date: iso(received), current_term_end_date: iso(termEnd) },
    gold: { outcome },
    facts,
    notes: note,
  });
}

// clear margins either way
add({ start: '2025-01-15', noticeDays: 60, leadDays: 95, note: 'well before' });
add({ start: '2025-03-01', noticeDays: 60, leadDays: 20, note: 'well after' });
add({ start: '2025-02-10', noticeDays: 30, leadDays: 70 });
add({ start: '2025-06-01', noticeDays: 30, leadDays: 10 });
add({ start: '2025-04-20', noticeDays: 90, leadDays: 150 });
add({ start: '2025-05-05', noticeDays: 90, leadDays: 40 });
add({ start: '2025-07-01', noticeDays: 120, leadDays: 200 });
add({ start: '2025-08-12', noticeDays: 120, leadDays: 60 });
// near the boundary: the hard half, where a bucketed comparison and a direct question part ways
add({ start: '2025-01-31', noticeDays: 60, leadDays: 64, note: 'four days early' });
add({ start: '2025-02-28', noticeDays: 60, leadDays: 56, note: 'four days late' });
add({ start: '2025-09-15', noticeDays: 30, leadDays: 34 });
add({ start: '2025-10-01', noticeDays: 30, leadDays: 26 });
add({ start: '2025-03-15', noticeDays: 90, leadDays: 95 });
add({ start: '2025-11-20', noticeDays: 90, leadDays: 85 });
add({ start: '2025-06-30', noticeDays: 45, leadDays: 49 });
add({ start: '2025-12-01', noticeDays: 45, leadDays: 41 });
add({ start: '2025-04-01', noticeDays: 60, leadDays: 57, note: 'three days late' });
// notice stated in months
add({ start: '2025-01-10', noticeDays: 90, noticeAs: 'months', leadDays: 100, note: '3 months' });
add({ start: '2025-05-18', noticeDays: 90, noticeAs: 'months', leadDays: 75, note: '3 months, late' });
add({ start: '2025-07-22', noticeDays: 60, noticeAs: 'months', leadDays: 66, note: '2 months' });
// a later renewal term: the term end must be computed past the initial term
add({ start: '2023-02-01', termsElapsed: 2, noticeDays: 60, leadDays: 80, note: 'third term' });
add({ start: '2023-09-01', termsElapsed: 2, noticeDays: 60, leadDays: 30, note: 'third term, late' });
add({ start: '2024-03-10', termMonths: 24, noticeDays: 90, leadDays: 110, note: '24-month term' });
add({ start: '2024-06-05', termMonths: 24, noticeDays: 90, leadDays: 70, note: '24-month term, late' });
// not about timing
add({ start: '2025-02-01', autoRenew: false, noticeDays: 60, leadDays: 10, note: 'no auto-renewal: nothing to avoid' });
add({ start: '2025-08-01', autoRenew: false, noticeDays: 60, leadDays: 90 });
add({ start: '2025-03-20', methodEmailOk: false, noticeDays: 60, leadDays: 120, note: 'on time but email not a valid method' });
add({ start: '2025-10-10', methodEmailOk: false, noticeDays: 30, leadDays: 50 });
add({ start: '2025-05-25', email: 'vague', noticeDays: 60, leadDays: 100, note: 'not a notice' });
add({ start: '2025-09-09', email: 'vague', noticeDays: 30, leadDays: 45 });

writeFileSync(new URL('./notice.cases.json', import.meta.url), JSON.stringify(cases, null, 2) + '\n');
const count = (o) => cases.filter((c) => c.gold.outcome === o).length;
console.log(`${cases.length} cases: ${count('avoided')} avoided, ${count('not_avoided')} not avoided, ${count('not_applicable')} not applicable`);
