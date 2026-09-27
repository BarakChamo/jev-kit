import questionsJson from "./questions.json";
import { decide as decideNotice } from "./decide";

interface CaseInput {
  contract_text: string;
  email_text: string;
  email_from?: string;
  received_date: string;
  current_term_end_date?: string;
}

export function buildState(input: CaseInput) {
  return {
    contract_text: input.contract_text,
    cancellation_email_text: input.email_text,
    email_received_date: input.received_date,
  };
}

export function questions(_input: CaseInput) {
  return questionsJson.questions;
}

type NoulApiAnswer = { type: "noul"; noul: number };
type ChoiceApiAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};
type ScoreApiAnswer = {
  type: "score";
  score: number;
  confidence: number;
  legend: Record<string, number>;
  probabilities: Record<string, number>;
};
type ApiAnswer = NoulApiAnswer | ChoiceApiAnswer | ScoreApiAnswer;

export function decide(
  _input: CaseInput,
  answers: Record<string, ApiAnswer>
): { outcome: "avoided" | "not_avoided" | "not_applicable" | "abstain" } {
  const result = decideNotice(answers as any);

  switch (result.decision) {
    case "sufficient_notice":
      return { outcome: "avoided" };
    case "insufficient_notice":
      return { outcome: "not_avoided" };
    case "no_auto_renewal_clause":
      return { outcome: "not_applicable" };
    case "needs_human_review":
    default:
      return { outcome: "abstain" };
  }
}
