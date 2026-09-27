import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decide as decideCase, type JevAnswers, type Decision } from "./decide.ts";

const questionsJson = JSON.parse(
  readFileSync(join(new URL(".", import.meta.url).pathname, "questions.json"), "utf8")
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

const DECISION_TO_OUTCOME: Record<Decision, "avoided" | "not_avoided" | "not_applicable" | "abstain"> = {
  not_applicable: "not_applicable",
  sufficient_notice: "avoided",
  insufficient_notice: "not_avoided",
  needs_human_review: "abstain",
};

export function decide(_input: CaseInput, answers: JevAnswers) {
  const result = decideCase(answers);
  return { outcome: DECISION_TO_OUTCOME[result.decision] };
}
