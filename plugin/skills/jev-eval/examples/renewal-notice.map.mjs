// A question map written to the standard interface (jev-questions, "The interface a map exposes"),
// so `jev-run suite.json --map this-file` can grade it end to end with no adapter.
//
// Decision: did a cancellation email avoid a contract's automatic renewal? Jev *reads* the contract:
// yes/no facts, and the effective date as three choices. Code does every piece of date arithmetic,
// because asking Jev "was it on time?" was right 64–75% of the time, and reading the dates was 30/30.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const opts = (xs) => Object.fromEntries(xs.map((x) => [String(x), null]));
const DAY = 86400000;
const addMonths = (t, m) => {
  const d = new Date(t);
  d.setUTCMonth(d.getUTCMonth() + m);
  return d.getTime();
};

/** The state: exactly what the decision needs, each field named so every question can point at it. */
export function buildState(input) {
  return { contract_text: input.contract_text, email_text: input.email_text, received_date: input.received_date };
}

export function questions() {
  return {
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
      criteria: { 30: '30 days or one month', 45: '45 days', 60: '60 days or two months', 90: '90 days or three months', 120: '120 days or four months', none: 'no notice period stated' },
    },
  };
}

const p = (a) => a.probabilities[a.choice] ?? 0;
const yes = (a) => a.noul >= 0.7;
const no = (a) => a.noul <= 0.3;

/** answers -> the decision; "abstain" sends the case to a person. Low confidence never relaxes it. */
export function decide(a, input) {
  if (no(a.auto_renews)) return { outcome: 'not_applicable' };
  if (!yes(a.auto_renews)) return { outcome: 'abstain' };
  if (no(a.email_allowed) || no(a.clear_notice)) return { outcome: 'not_avoided' };
  if (!yes(a.email_allowed) || !yes(a.clear_notice)) return { outcome: 'abstain' };
  const read = [a.effective_year, a.effective_month, a.effective_day, a.term_months, a.notice_days];
  if (read.some((x) => p(x) < 0.8) || a.notice_days.choice === 'none') return { outcome: 'abstain' };

  const start = Date.UTC(Number(a.effective_year.choice), MONTHS.indexOf(a.effective_month.choice), Number(a.effective_day.choice));
  const received = Date.parse(input.received_date);
  const term = Number(a.term_months.choice);
  let end = addMonths(start, term);
  while (end < received) end = addMonths(end, term); // the term the email arrived in
  const lead = Math.round((end - received) / DAY);
  return { outcome: lead >= Number(a.notice_days.choice) ? 'avoided' : 'not_avoided' };
}
