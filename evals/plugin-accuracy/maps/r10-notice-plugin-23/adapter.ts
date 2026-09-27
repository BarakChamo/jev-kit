import questionsJson from "./questions.json";
import { decide as decideImpl } from "./decide";

interface CaseInput {
  id: string;
  input: {
    contract_text: string;
    email_text: string;
    email_from: string;
    received_date: string;
    current_term_end_date: string;
  };
  notes?: string;
}

export function buildState(input: CaseInput) {
  const { contract_text, email_text, received_date, current_term_end_date } = input.input;
  return {
    contract_text,
    cancellation_email_text: email_text,
    cancellation_received_date: received_date,
    renewal_date: current_term_end_date,
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

export function decide(input: CaseInput, answers: Record<string, ApiAnswer>) {
  const state = buildState(input);
  const result = decideImpl(state, answers as any);

  switch (result.decision) {
    case "SUFFICIENT_NOTICE":
      return { outcome: "avoided" as const };
    case "INSUFFICIENT_NOTICE":
      return { outcome: "not_avoided" as const };
    case "NO_AUTO_RENEWAL":
      return { outcome: "not_applicable" as const };
    case "NEEDS_HUMAN_REVIEW":
    default:
      return { outcome: "abstain" as const };
  }
}
