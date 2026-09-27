import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decide as decideCase, type JevAnswers } from "./decide.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const questionsJson = JSON.parse(
  readFileSync(join(__dirname, "questions.json"), "utf-8"),
);

export interface CaseInput {
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
    cancellation_received_date: input.received_date,
  };
}

export function questions(_input: CaseInput) {
  return questionsJson.questions;
}

type ApiAnswer =
  | { type: "noul"; noul: number }
  | {
      type: "choice";
      choice: string;
      confidence: number;
      probabilities: Record<string, number>;
    }
  | {
      type: "score";
      score: string;
      confidence: number;
      legend: string[];
      probabilities: Record<string, number>;
    };

export function decide(
  _input: CaseInput,
  answers: Record<string, ApiAnswer>,
): { outcome: "avoided" | "not_avoided" | "not_applicable" | "abstain" } {
  const result = decideCase(answers as unknown as JevAnswers);

  switch (result.verdict) {
    case "notice_sufficient":
      return { outcome: "avoided" };
    case "notice_insufficient":
      return { outcome: "not_avoided" };
    case "no_autorenewal_clause":
      return { outcome: "not_applicable" };
    case "needs_human_review":
    default:
      return { outcome: "abstain" };
  }
}
