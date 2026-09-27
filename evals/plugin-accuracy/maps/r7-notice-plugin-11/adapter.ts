import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decide as decideCore } from "./decide.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const questionsFile = JSON.parse(readFileSync(join(__dirname, "questions.json"), "utf8"));

interface CaseInput {
  contract_text: string;
  email_text: string;
  email_from: string;
  received_date: string;
  current_term_end_date: string;
}

const VERDICT_TO_OUTCOME: Record<string, "avoided" | "not_avoided" | "not_applicable" | "abstain"> = {
  NOT_APPLICABLE: "not_applicable",
  SUFFICIENT_NOTICE: "avoided",
  INSUFFICIENT_NOTICE: "not_avoided",
  NEEDS_HUMAN_REVIEW: "abstain",
};

export function buildState(input: CaseInput) {
  const example = questionsFile.state;
  return {
    contract_text: input.contract_text ?? example.contract_text,
    email_text: input.email_text ?? example.email_text,
    date_received: input.received_date ?? example.date_received,
    current_term_end_date: input.current_term_end_date ?? example.current_term_end_date,
  };
}

export function questions(_input: CaseInput) {
  return questionsFile.questions;
}

export function decide(input: CaseInput, answers: Record<string, any>) {
  const decideInput = {
    date_received: input.received_date,
    current_term_end_date: input.current_term_end_date,
  };
  const decision = decideCore(decideInput, answers as any);
  return { outcome: VERDICT_TO_OUTCOME[decision.verdict] };
}
