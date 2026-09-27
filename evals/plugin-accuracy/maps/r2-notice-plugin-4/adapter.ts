import questionsJson from "./questions.json";
import { decide as decideImpl, type CaseState, type JevAnswers } from "./decide.ts";

export interface CanonicalInput {
  contract_text: string;
  email_text: string;
  email_from: string;
  received_date: string;
  current_term_end_date: string;
}

export function buildState(input: CanonicalInput): CaseState {
  return {
    contract_text: input.contract_text,
    cancellation_email_text: input.email_text,
    cancellation_received_date: input.received_date,
    current_term_end_date: input.current_term_end_date,
  };
}

export function questions(_input: CanonicalInput) {
  return questionsJson.questions;
}

export function decide(input: CanonicalInput, answers: JevAnswers) {
  const verdict = decideImpl(buildState(input), answers);

  const outcome =
    verdict.decision === "NOT_APPLICABLE"
      ? "not_applicable"
      : verdict.decision === "SUFFICIENT_NOTICE"
      ? "avoided"
      : verdict.decision === "INSUFFICIENT_NOTICE"
      ? "not_avoided"
      : "abstain";

  return { outcome };
}
