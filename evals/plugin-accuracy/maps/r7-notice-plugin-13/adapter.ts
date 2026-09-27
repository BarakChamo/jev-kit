import { readFileSync } from "fs";
import { join } from "path";
import { decide as decideNotice, type JevAnswers } from "./decide";

const questionsDoc = JSON.parse(
  readFileSync(new URL("./questions.json", import.meta.url), "utf8")
);

export interface CaseInput {
  id: string;
  input: {
    contract_text: string;
    email_text: string;
    email_from?: string;
    received_date: string;
    current_term_end_date?: string;
  };
  notes?: string;
}

export function buildState(input: CaseInput) {
  const { contract_text, email_text, received_date } = input.input;
  return {
    contract_text,
    email_text,
    email_received_date: received_date,
  };
}

export function questions(_input: CaseInput) {
  return questionsDoc.questions;
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
  legend: Record<string, string>;
  probabilities: Record<string, number>;
};
type ApiAnswer = NoulApiAnswer | ChoiceApiAnswer | ScoreApiAnswer;

export type Outcome = "avoided" | "not_avoided" | "not_applicable" | "abstain";

export function decide(
  _input: CaseInput,
  answers: Record<string, ApiAnswer>
): { outcome: Outcome } {
  const verdict = decideNotice(answers as unknown as JevAnswers);

  switch (verdict.decision) {
    case "SUFFICIENT_NOTICE":
      return { outcome: "avoided" };
    case "INSUFFICIENT_NOTICE":
      return { outcome: "not_avoided" };
    case "NO_AUTO_RENEWAL_CLAUSE":
      return { outcome: "not_applicable" };
    case "NEEDS_HUMAN_REVIEW":
    default:
      return { outcome: "abstain" };
  }
}
