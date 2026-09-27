import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decide as decideCase, type JevAnswers } from "./decide.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(join(__dirname, "questions.json"), "utf8"));

interface CaseInput {
  contract_text: string;
  email_text: string;
  email_from?: string;
  received_date: string;
  current_term_end_date?: string;
}

export function buildState(input: CaseInput) {
  return {
    contract: input.contract_text,
    cancellationEmail: input.email_text,
    receivedDate: input.received_date,
  };
}

export function questions(_input: CaseInput) {
  return spec.questions;
}

type NoulApiAnswer = { type: "noul"; noul: number };
type ChoiceApiAnswer = { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };
type ScoreApiAnswer = {
  type: "score";
  score: number;
  confidence: number;
  legend?: Record<string, unknown>;
  probabilities?: Record<string, number>;
};
type ApiAnswer = NoulApiAnswer | ChoiceApiAnswer | ScoreApiAnswer;

export function decide(_input: CaseInput, answers: Record<string, ApiAnswer>) {
  const result = decideCase(answers as unknown as JevAnswers);

  let outcome: "avoided" | "not_avoided" | "not_applicable" | "abstain";
  switch (result.decision) {
    case "sufficient_notice":
      outcome = "avoided";
      break;
    case "insufficient_notice":
    case "not_a_cancellation_request":
      outcome = "not_avoided";
      break;
    case "no_auto_renewal_clause":
      outcome = "not_applicable";
      break;
    default:
      outcome = "abstain";
  }

  return { outcome };
}
