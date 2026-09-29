// A question map written to the standard interface (jev-questions, "The interface a map exposes"),
// so `jev-run suite.json --map this-file` can grade it end to end with no adapter.
//
// Decision: did a cancellation email avoid a contract's automatic renewal? Jev *reads* the contract:
// yes/no facts, the effective date as three choices, the term, and the notice period as a number and
// a unit. Code does every piece of date arithmetic, in calendar months, because asking Jev "was it on
// time?" was right 64–75% of the time, and reading the dates was 30/30. Every choice has an "other"
// option, so a value outside the list abstains instead of being forced onto the nearest option.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const OTHER = { other: 'none of the listed values, or not stated' };
const opts = (xs) => ({ ...Object.fromEntries(xs.map((x) => [String(x), null])), ...OTHER });
const DAY = 86400000;

/** Calendar months, clamped to the month's last day: January 31 + 1 month is February 28. */
const addMonths = (t, m) => {
  const d = new Date(t);
  const month = d.getUTCMonth() + m;
  const last = new Date(Date.UTC(d.getUTCFullYear(), month + 1, 0)).getUTCDate();
  return Date.UTC(d.getUTCFullYear(), month, Math.min(d.getUTCDate(), last));
};

/** The state: exactly what the decision needs, each field named so every question can point at it. */
export function buildState(input) {
  return { contract_text: input.contract_text, email_text: input.email_text, received_date: input.received_date };
}

export function questions(input) {
  // Years come from the input, not a fixed list: the ten years up to the email's.
  const year = new Date(input.received_date).getUTCFullYear();
  return {
    auto_renews: { type: 'noul', instructions: 'Does `contract_text` say the agreement renews automatically for a further term unless a party gives notice?' },
    email_allowed: { type: 'noul', instructions: 'Does `contract_text` allow a notice of non-renewal to be given by email?' },
    clear_notice: { type: 'noul', instructions: 'Does `email_text` state that the sender will not renew, or wants to cancel, the agreement?' },
    effective_year: { type: 'choice', instructions: 'In which year does `contract_text` say the agreement begins (its Effective Date)?', criteria: opts(Array.from({ length: 10 }, (_, i) => year - 9 + i)) },
    effective_month: { type: 'choice', instructions: 'In which month does `contract_text` say the agreement begins (its Effective Date)?', criteria: opts(MONTHS) },
    effective_day: { type: 'choice', instructions: 'On which day of the month does `contract_text` say the agreement begins (its Effective Date)?', criteria: opts(Array.from({ length: 31 }, (_, i) => i + 1)) },
    term_months: { type: 'choice', instructions: 'How many months long is each term (the initial term and each renewal term) in `contract_text`?', criteria: opts([1, 2, 3, 4, 6, 12, 18, 24, 36, 48, 60]) },
    notice_count: {
      type: 'choice',
      instructions: 'What number does `contract_text` give for the advance notice needed before the end of a term to prevent renewal? Give the number as written, whatever its unit.',
      criteria: { ...opts([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 15, 20, 21, 28, 30, 45, 60, 75, 90, 120, 180]), none: 'no notice period stated' },
    },
    notice_unit: { type: 'choice', instructions: 'In what unit does `contract_text` state that notice period?', criteria: { days: null, weeks: null, months: null, ...OTHER } },
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
  // The 0.8 floor on every read is a starting point: fit it with `jev-audit --holdout` on your cases.
  const read = [a.effective_year, a.effective_month, a.effective_day, a.term_months, a.notice_count, a.notice_unit];
  if (read.some((x) => p(x) < 0.8 || x.choice === 'other') || a.notice_count.choice === 'none') return { outcome: 'abstain' };

  const start = Date.UTC(Number(a.effective_year.choice), MONTHS.indexOf(a.effective_month.choice), Number(a.effective_day.choice));
  if (new Date(start).getUTCDate() !== Number(a.effective_day.choice)) return { outcome: 'abstain' }; // e.g. a read of February 30
  const received = Date.parse(input.received_date);
  const term = Number(a.term_months.choice);
  // The term the email arrived in: each end is counted from the start (start + k terms), never from the
  // previous end, so a month-end start does not drift (Jan 31 -> Feb 28 -> Mar 31, not Mar 28).
  let k = 1;
  while (addMonths(start, term * k) < received) k += 1;
  const end = addMonths(start, term * k);
  const n = Number(a.notice_count.choice);
  const unit = a.notice_unit.choice;
  const deadline = unit === 'months' ? addMonths(end, -n) : end - n * (unit === 'weeks' ? 7 : 1) * DAY;
  return { outcome: received <= deadline ? 'avoided' : 'not_avoided' };
}
