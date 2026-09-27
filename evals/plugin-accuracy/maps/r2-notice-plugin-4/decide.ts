// Decision logic for questions.json's answers.
// Jev is used only to read the contract/email; the deadline arithmetic and
// the sufficient-notice comparison are done here, in code (see jev-questions
// rule 5/12: don't ask Jev to hold two quantities against each other).

type NoulAnswer = { noul: number }; // probability that the criteria.true statement holds
type ChoiceAnswer<Opt extends string> = {
  choice: Opt;
  confidence: number;
  probabilities: Record<Opt, number>;
};

type NoticeBucket =
  | "none_required"
  | "15_days"
  | "30_days"
  | "45_days"
  | "60_days"
  | "90_days"
  | "120_days"
  | "180_days"
  | "other_or_unspecified";

export interface JevAnswers {
  has_auto_renewal: NoulAnswer;
  notice_days_required: ChoiceAnswer<NoticeBucket>;
  notice_method_restricted: NoulAnswer;
  email_states_cancellation: NoulAnswer;
}

export interface CaseState {
  contract_text: string;
  cancellation_email_text: string;
  cancellation_received_date: string; // ISO date
  current_term_end_date: string; // ISO date, the end of the then-current term
}

export type Decision =
  | "NOT_APPLICABLE" // contract does not auto-renew
  | "SUFFICIENT_NOTICE" // notice avoids the renewal
  | "INSUFFICIENT_NOTICE" // notice is late
  | "NEEDS_REVIEW"; // Jev wasn't confident enough, or a fact is missing/ambiguous

export interface Verdict {
  decision: Decision;
  reasons: string[];
}

const NOTICE_DAYS: Record<NoticeBucket, number | null> = {
  none_required: 0,
  "15_days": 15,
  "30_days": 30,
  "45_days": 45,
  "60_days": 60,
  "90_days": 90,
  "120_days": 120,
  "180_days": 180,
  other_or_unspecified: null,
};

// Gate on the label probability, not the confidence scalar (rule 8).
const NOUL_CONFIDENT = 0.8; // true if p >= this, false if p <= 1 - this
const CHOICE_CONFIDENT = 0.6; // top probability must clear this to trust the bucket

function noulIsConfidently(answer: NoulAnswer, value: boolean): boolean {
  return value ? answer.noul >= NOUL_CONFIDENT : answer.noul <= 1 - NOUL_CONFIDENT;
}

function daysBetween(fromISO: string, toISO: string): number {
  const ms = Date.parse(toISO) - Date.parse(fromISO);
  return Math.round(ms / 86_400_000);
}

export function decide(state: CaseState, answers: JevAnswers): Verdict {
  const reasons: string[] = [];

  // Low confidence never relaxes the decision (jev-questions architecture rule):
  // any unsure fact routes to NEEDS_REVIEW instead of picking a default.
  if (
    !noulIsConfidently(answers.has_auto_renewal, true) &&
    !noulIsConfidently(answers.has_auto_renewal, false)
  ) {
    return {
      decision: "NEEDS_REVIEW",
      reasons: ["Not confident whether the contract auto-renews; a person should read Section 8-equivalent language."],
    };
  }

  if (noulIsConfidently(answers.has_auto_renewal, false)) {
    return {
      decision: "NOT_APPLICABLE",
      reasons: ["Contract has no automatic-renewal clause; notice timing does not apply."],
    };
  }

  if (!noulIsConfidently(answers.email_states_cancellation, true)) {
    return {
      decision: "NEEDS_REVIEW",
      reasons: ["The email does not clearly state an intent to cancel or not renew."],
    };
  }

  if (noulIsConfidently(answers.notice_method_restricted, true)) {
    reasons.push(
      "Contract appears to require a delivery method other than plain email; confirm the notice channel before relying on this decision."
    );
    return { decision: "NEEDS_REVIEW", reasons };
  }

  const requiredDays = NOTICE_DAYS[answers.notice_days_required.choice];
  const bucketConfident = answers.notice_days_required.probabilities[answers.notice_days_required.choice] >= CHOICE_CONFIDENT;

  if (requiredDays === null || !bucketConfident) {
    return {
      decision: "NEEDS_REVIEW",
      reasons: ["Required notice period could not be determined confidently from the contract."],
    };
  }

  const daysBeforeTermEnd = daysBetween(state.cancellation_received_date, state.current_term_end_date);

  if (daysBeforeTermEnd >= requiredDays) {
    reasons.push(
      `Notice given ${daysBeforeTermEnd} day(s) before term end, meeting the required ${requiredDays}-day notice period.`
    );
    return { decision: "SUFFICIENT_NOTICE", reasons };
  }

  reasons.push(
    `Notice given ${daysBeforeTermEnd} day(s) before term end, short of the required ${requiredDays}-day notice period.`
  );
  return { decision: "INSUFFICIENT_NOTICE", reasons };
}
