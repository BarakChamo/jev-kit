import questionsData from "./questions.json" with { type: "json" };
import { decideNoticeSufficiency, type Decision } from "./decide.ts";

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

export function buildState(input: CaseInput) {
  const { contract_text, email_text, received_date } = input.input;
  return {
    contract_text,
    cancellation_email_text: email_text,
    cancellation_received_date: received_date,
  };
}

export function questions(_input: CaseInput) {
  return questionsData.questions;
}

const DECISION_TO_OUTCOME: Record<
  Decision,
  "avoided" | "not_avoided" | "not_applicable" | "abstain"
> = {
  NO_AUTO_RENEWAL_CLAUSE: "not_applicable",
  SUFFICIENT_NOTICE: "avoided",
  INSUFFICIENT_NOTICE: "not_avoided",
  BORDERLINE_NEEDS_REVIEW: "abstain",
  AMBIGUOUS_CANCELLATION_TEXT: "abstain",
  UNCERTAIN_NEEDS_REVIEW: "abstain",
};

export function decide(
  _input: CaseInput,
  answers: Record<string, ApiAnswer>
) {
  const result = decideNoticeSufficiency(answers as any);
  return { outcome: DECISION_TO_OUTCOME[result.decision] };
}
