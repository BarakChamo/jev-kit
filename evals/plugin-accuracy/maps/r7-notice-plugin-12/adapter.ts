import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decide as decideCase, type Answers, type CancellationCase } from "./decide.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const questionsDoc = JSON.parse(
  readFileSync(join(__dirname, "questions.json"), "utf8"),
);

// The suite wraps each case as { id, input: {...}, notes }; unwrap if present.
function unwrap(input: any) {
  return input?.input ?? input;
}

export function buildState(input: any) {
  const c = unwrap(input);
  return {
    contract_text: c.contract_text,
    cancellation_email_text: c.email_text,
    received_date: c.received_date,
    current_term_end_date: c.current_term_end_date,
  };
}

export function questions(_input: any) {
  return questionsDoc.questions;
}

const OUTCOME_BY_VERDICT: Record<string, "avoided" | "not_avoided" | "not_applicable" | "abstain"> = {
  no_auto_renewal_clause: "not_applicable",
  sufficient_notice: "avoided",
  insufficient_notice: "not_avoided",
  needs_human_review: "abstain",
};

export function decide(input: any, answers: Answers) {
  const c = unwrap(input);
  const caseInfo: CancellationCase = {
    received_date: c.received_date,
    current_term_end_date: c.current_term_end_date,
  };
  const decision = decideCase(answers, caseInfo);
  return { outcome: OUTCOME_BY_VERDICT[decision.verdict] };
}
