import { decide as decideCase, type JevAnswers } from "./decide.ts";
import questionsData from "./questions.json";

export interface CaseInput {
  id: string;
  input: {
    contract_text: string;
    email_text: string;
    email_from: string;
    received_date: string;
    current_term_end_date?: string | null;
  };
  notes?: string;
}

type NoulApiAnswer = { type: "noul"; noul: number };
type ChoiceApiAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};
export type ApiAnswer = NoulApiAnswer | ChoiceApiAnswer | Record<string, unknown>;

export function buildState(input: CaseInput) {
  return {
    contract_text: input.input.contract_text,
    cancellation_email_text: input.input.email_text,
    cancellation_received_date: input.input.received_date,
    current_term_end_date_hint: input.input.current_term_end_date ?? null,
  };
}

export function questions(_input: CaseInput) {
  return questionsData.questions;
}

export function decide(_input: CaseInput, answers: Record<string, ApiAnswer>) {
  const jevAnswers: JevAnswers = {
    is_cancellation_notice: { noul: (answers.is_cancellation_notice as NoulApiAnswer).noul },
    has_auto_renewal_clause: { noul: (answers.has_auto_renewal_clause as NoulApiAnswer).noul },
    notice_method_valid: { noul: (answers.notice_method_valid as NoulApiAnswer).noul },
    required_notice_days: answers.required_notice_days as unknown as JevAnswers["required_notice_days"],
    days_until_renewal: answers.days_until_renewal as unknown as JevAnswers["days_until_renewal"],
  };

  const result = decideCase(jevAnswers);

  switch (result.outcome) {
    case "sufficient_notice":
      return { outcome: "avoided" as const };
    case "insufficient_notice":
      return { outcome: "not_avoided" as const };
    case "invalid_notice_method":
      return { outcome: "not_avoided" as const };
    case "no_renewal_clause":
    case "not_a_cancellation":
      return { outcome: "not_applicable" as const };
    case "needs_human_review":
      return { outcome: "abstain" as const };
  }
}
