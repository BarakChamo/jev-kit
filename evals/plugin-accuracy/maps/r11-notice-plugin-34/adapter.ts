import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decide as decideCase, type DecisionResult } from "./decide";

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
    contract_text: input.contract_text,
    cancellation_email_text: input.email_text,
    received_date: input.received_date,
  };
}

export function questions(_input: CaseInput) {
  return spec.questions;
}

const DECISION_TO_OUTCOME: Record<DecisionResult["decision"], "avoided" | "not_avoided" | "not_applicable" | "abstain"> = {
  notice_sufficient: "avoided",
  notice_too_late: "not_avoided",
  method_not_allowed: "not_avoided",
  no_auto_renewal: "not_applicable",
  needs_review: "abstain",
};

export function decide(input: CaseInput, answers: Parameters<typeof decideCase>[0]) {
  const result = decideCase(answers, input.received_date);
  return { outcome: DECISION_TO_OUTCOME[result.decision] };
}
