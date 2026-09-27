import questionsJson from "./questions.json";
import { decide as decideImpl, JevAnswers, Decision } from "./decide";

export interface CaseInput {
  contract_text: string;
  email_text: string;
  email_from: string;
  received_date: string;
  current_term_end_date: string;
}

type NoulAnswer = { type: "noul"; noul: number };
type ChoiceAnswer = { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };
type ScoreAnswer = { type: "score"; score: number; confidence: number; legend: Record<string, string>; probabilities: Record<string, number> };
type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export function buildState(input: CaseInput) {
  return {
    contract_text: input.contract_text,
    cancellation_email_text: input.email_text,
    date_received: input.received_date,
  };
}

export function questions(_input: CaseInput) {
  return questionsJson.questions;
}

const OUTCOME_MAP: Record<Decision["outcome"], "avoided" | "not_avoided" | "not_applicable" | "abstain"> = {
  renewal_avoided: "avoided",
  renewal_not_avoided: "not_avoided",
  not_applicable: "not_applicable",
  needs_human_review: "abstain",
};

export function decide(_input: CaseInput, answers: Record<string, Answer>) {
  const jevAnswers = answers as unknown as JevAnswers;
  const result = decideImpl(jevAnswers);
  return { outcome: OUTCOME_MAP[result.outcome] };
}
