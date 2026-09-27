import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { decide as decideImpl } from "./decide.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jev = JSON.parse(readFileSync(path.join(__dirname, "questions.json"), "utf8"));
const EXAMPLE_STATE = jev.state;
const QUESTIONS = jev.questions;

export interface CaseInput {
  contract_text: string;
  email_text: string;
  email_from: string;
  received_date: string;
  current_term_end_date: string;
}

export function buildState(input: CaseInput) {
  return {
    contract_text: input.contract_text ?? EXAMPLE_STATE.contract_text,
    cancellation_email_text: input.email_text ?? EXAMPLE_STATE.cancellation_email_text,
    cancellation_received_date: input.received_date ?? EXAMPLE_STATE.cancellation_received_date,
    current_term_end_date: input.current_term_end_date ?? EXAMPLE_STATE.current_term_end_date,
  };
}

export function questions(_input: CaseInput) {
  return QUESTIONS;
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
  legend: unknown;
  probabilities: Record<string, number>;
};
type ApiAnswer = NoulApiAnswer | ChoiceApiAnswer | ScoreApiAnswer;

const OUTCOME_MAP: Record<string, "avoided" | "not_avoided" | "not_applicable" | "abstain"> = {
  notice_sufficient: "avoided",
  notice_insufficient: "not_avoided",
  not_applicable: "not_applicable",
  needs_human_review: "abstain",
};

export function decide(_input: CaseInput, answers: Record<string, ApiAnswer>) {
  const result = decideImpl(answers as any);
  return { outcome: OUTCOME_MAP[result.verdict] ?? "abstain" };
}
