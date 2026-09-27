// Decision logic for: "did this cancellation give enough notice to avoid auto-renewal?"
// Consumes the answers to questions.json's `questions` map. All date arithmetic and the
// deadline comparison happen here, in code — Jev only reads facts out of the contract prose.

type Noul = { noul: number }; // probability the "true" criterion holds
type Choice = { choice: string; confidence: number; probabilities: Record<string, number> };

interface Answers {
  has_auto_renewal: Noul;
  effective_year: Choice;
  effective_month: Choice;
  effective_day: Choice;
  initial_term_length: Choice;
  renewal_term_length: Choice;
  notice_period: Choice;
  allows_email_notice: Noul;
  email_states_cancellation: Noul;
}

export type Decision =
  | "notice_sufficient" // enough notice, by an allowed method, renewal averted
  | "notice_too_late" // notice given, but after the contractual deadline
  | "method_not_allowed" // notice given in time, but not via a method the contract permits
  | "no_auto_renewal" // contract doesn't auto-renew; notice requirement is moot
  | "needs_review"; // low-confidence read on a fact the decision depends on

export interface DecisionResult {
  decision: Decision;
  reasons: string[];
  termEndDate?: string; // ISO date of the term boundary the notice needed to beat
  deadline?: string; // ISO date = termEndDate - notice period
}

const MONTHS_BY_TERM: Record<string, number | "same_as_initial" | "none" | null> = {
  "1_month": 1,
  "3_months": 3,
  "6_months": 6,
  "12_months": 12,
  "24_months": 24,
  "36_months": 36,
  "60_months": 60,
  same_as_initial_term: "same_as_initial",
  no_automatic_renewal: "none",
  other_or_unclear: null,
};

const NOTICE_DAYS: Record<string, number | null> = {
  no_notice_required: 0,
  "15_days": 15,
  "30_days": 30,
  "45_days": 45,
  "60_days": 60,
  "90_days": 90,
  other_or_unclear: null,
};

// Gate on the probability of the label, not the `confidence` scalar (rule 8).
const NOUL_TRUE = 0.8;
const NOUL_FALSE = 0.2;
const CHOICE_MIN_PROB = 0.6;

function noulIsTrue(a: Noul) { return a.noul >= NOUL_TRUE; }
function noulIsFalse(a: Noul) { return a.noul <= NOUL_FALSE; }
function noulUnsure(a: Noul) { return !noulIsTrue(a) && !noulIsFalse(a); }

function choiceConfident(a: Choice): boolean {
  return (a.probabilities[a.choice] ?? 0) >= CHOICE_MIN_PROB;
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function decide(answers: Answers, receivedDate: string): DecisionResult {
  const reasons: string[] = [];

  if (noulIsFalse(answers.has_auto_renewal)) {
    return { decision: "no_auto_renewal", reasons: ["contract has no automatic renewal clause"] };
  }
  if (noulUnsure(answers.has_auto_renewal)) {
    reasons.push(`unclear whether contract auto-renews (p=${answers.has_auto_renewal.noul.toFixed(2)})`);
  }

  if (
    answers.effective_year.choice === "unclear" ||
    answers.effective_month.choice === "unclear" ||
    answers.effective_day.choice === "unclear" ||
    !choiceConfident(answers.effective_year) ||
    !choiceConfident(answers.effective_month) ||
    !choiceConfident(answers.effective_day)
  ) {
    reasons.push("effective date could not be read confidently from the contract");
    return { decision: "needs_review", reasons };
  }

  const initialTerm = MONTHS_BY_TERM[answers.initial_term_length.choice];
  if (initialTerm === null || initialTerm === undefined || typeof initialTerm !== "number" || !choiceConfident(answers.initial_term_length)) {
    reasons.push("initial term length could not be read confidently from the contract");
    return { decision: "needs_review", reasons };
  }

  let renewalTerm = MONTHS_BY_TERM[answers.renewal_term_length.choice];
  if (renewalTerm === "same_as_initial") renewalTerm = initialTerm;
  if (renewalTerm === "none") {
    return { decision: "no_auto_renewal", reasons: ["contract does not provide for automatic renewal"] };
  }
  if (renewalTerm === null || renewalTerm === undefined || typeof renewalTerm !== "number" || !choiceConfident(answers.renewal_term_length)) {
    reasons.push("renewal term length could not be read confidently from the contract");
    return { decision: "needs_review", reasons };
  }

  const noticeDays = NOTICE_DAYS[answers.notice_period.choice];
  if (noticeDays === null || noticeDays === undefined || !choiceConfident(answers.notice_period)) {
    reasons.push("notice period could not be read confidently from the contract");
    return { decision: "needs_review", reasons };
  }

  if (noulUnsure(answers.email_states_cancellation) || noulIsFalse(answers.email_states_cancellation)) {
    reasons.push("email does not clearly state an intent to cancel or not renew");
    return { decision: "needs_review", reasons };
  }

  const effective = new Date(Date.UTC(
    Number(answers.effective_year.choice),
    Number(answers.effective_month.choice) - 1,
    Number(answers.effective_day.choice),
  ));
  const received = new Date(`${receivedDate}T00:00:00Z`);

  // Walk term boundaries: one Initial Term, then repeating Renewal Terms, until we
  // find the first boundary on/after the received date — that's the renewal notice
  // needs to beat.
  let termEnd = addMonths(effective, initialTerm);
  while (termEnd < received) {
    termEnd = addMonths(termEnd, renewalTerm);
  }
  const deadline = new Date(termEnd);
  deadline.setUTCDate(deadline.getUTCDate() - noticeDays);

  const result: DecisionResult = {
    decision: "notice_sufficient",
    reasons,
    termEndDate: isoDate(termEnd),
    deadline: isoDate(deadline),
  };

  if (received > deadline) {
    result.decision = "notice_too_late";
    result.reasons.push(`received ${receivedDate} is after the ${isoDate(deadline)} deadline for the term ending ${isoDate(termEnd)}`);
    return result;
  }

  if (noulIsFalse(answers.allows_email_notice)) {
    result.decision = "method_not_allowed";
    result.reasons.push("contract's notice provision does not permit email");
    return result;
  }
  if (noulUnsure(answers.allows_email_notice)) {
    result.decision = "needs_review";
    result.reasons.push(`unclear whether contract permits email notice (p=${answers.allows_email_notice.noul.toFixed(2)})`);
    return result;
  }

  result.reasons.push(`received ${receivedDate} is on/before the ${isoDate(deadline)} deadline, by an allowed method`);
  return result;
}
