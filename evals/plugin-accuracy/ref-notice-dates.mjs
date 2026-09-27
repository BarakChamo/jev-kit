// Reference design for `notice` that uses only what the task promised (contract text, email, received
// date): Jev *reads* the effective date and terms as choices; code does every piece of arithmetic.
import { readFileSync, writeFileSync } from 'node:fs';
import { evaluate } from '../../../plugin/skills/jev-eval/scripts/jev-run.mjs';

const cases = JSON.parse(readFileSync(new URL('./notice.cases.json', import.meta.url), 'utf8'));
const opts = (xs) => Object.fromEntries(xs.map((x) => [String(x), null]));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const questions = {
  auto_renews: { type: 'noul', instructions: 'Does `contract_text` say the agreement renews automatically for a further term unless a party gives notice?' },
  email_allowed: { type: 'noul', instructions: 'Does `contract_text` allow a notice of non-renewal to be given by email?' },
  clear_notice: { type: 'noul', instructions: 'Does `email_text` state that the sender will not renew, or wants to cancel, the agreement?' },
  effective_year: { type: 'choice', instructions: 'In which year does `contract_text` say the agreement begins (its Effective Date)?', criteria: opts([2021, 2022, 2023, 2024, 2025, 2026]) },
  effective_month: { type: 'choice', instructions: 'In which month does `contract_text` say the agreement begins (its Effective Date)?', criteria: opts(MONTHS) },
  effective_day: { type: 'choice', instructions: 'On which day of the month does `contract_text` say the agreement begins (its Effective Date)?', criteria: opts(Array.from({ length: 31 }, (_, i) => i + 1)) },
  term_months: { type: 'choice', instructions: 'How many months long is each term (the initial term and each renewal term) in `contract_text`?', criteria: opts([1, 3, 6, 12, 24, 36]) },
  notice_days: {
    type: 'choice',
    instructions: 'How much advance notice before the end of a term does `contract_text` require to prevent renewal? Months count as 30 days each.',
    criteria: { '30': '30 days or one month', '45': '45 days', '60': '60 days or two months', '90': '90 days or three months', '120': '120 days or four months', none: 'no notice period stated' },
  },
};
const DAY = 86400000;
const addMonths = (t, m) => { const d = new Date(t); d.setUTCMonth(d.getUTCMonth() + m); return d.getTime(); };
const p = (a) => a.probabilities[a.choice] ?? 0;

const rows = [];
for (const c of cases) {
  const state = { contract_text: c.input.contract_text, email_text: c.input.email_text, received_date: c.input.received_date };
  const { answers: a } = await evaluate(state, questions);
  let outcome;
  const sure = [a.effective_year, a.effective_month, a.effective_day, a.term_months, a.notice_days].every((x) => p(x) >= 0.8);
  if (a.auto_renews.noul < 0.3) outcome = 'not_applicable';
  else if (a.auto_renews.noul < 0.7 || a.email_allowed.noul > 0.3 && a.email_allowed.noul < 0.7 || a.clear_notice.noul > 0.3 && a.clear_notice.noul < 0.7) outcome = 'abstain';
  else if (a.email_allowed.noul <= 0.3 || a.clear_notice.noul <= 0.3) outcome = 'not_avoided';
  else if (!sure || a.notice_days.choice === 'none') outcome = 'abstain';
  else {
    const start = Date.UTC(Number(a.effective_year.choice), MONTHS.indexOf(a.effective_month.choice), Number(a.effective_day.choice));
    const received = Date.parse(c.input.received_date);
    let end = addMonths(start, Number(a.term_months.choice));
    while (end < received) end = addMonths(end, Number(a.term_months.choice)); // the term the email falls in
    const lead = Math.round((end - received) / DAY);
    outcome = lead >= Number(a.notice_days.choice) ? 'avoided' : 'not_avoided';
  }
  const read = { year: a.effective_year.choice, month: a.effective_month.choice, day: a.effective_day.choice, term: a.term_months.choice, notice: a.notice_days.choice };
  rows.push({ id: c.id, gold: c.gold.outcome, outcome, read, facts: c.facts });
}
const right = rows.filter((r) => r.outcome === r.gold).length, abst = rows.filter((r) => r.outcome === 'abstain').length;
console.log(JSON.stringify({ map: 'reference: read dates as choices, compute in code', n: rows.length, right, wrong: rows.length - right - abst, abstain: abst }));
writeFileSync(new URL('./out/notice.reference.json', import.meta.url), JSON.stringify(rows, null, 2));
