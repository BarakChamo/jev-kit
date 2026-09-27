import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decideNoticeSufficiency, type SystemOneAnswers } from "./decide.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(join(__dirname, "questions.json"), "utf8"));
const EXAMPLE_STATE = spec.state;

// Canonical case input shape (see task description):
// { contract_text, email_text, email_from, received_date, current_term_end_date }
export function buildState(input: any) {
  return {
    contract_text: input.contract_text,
    cancellation_email_text: input.email_text,
    cancellation_email_sender: input.email_from,
    cancellation_email_recipient: EXAMPLE_STATE.cancellation_email_recipient,
    email_received_date: input.received_date,
    current_term_end_date_hint: EXAMPLE_STATE.current_term_end_date_hint,
  };
}

export function questions(_input: any) {
  return spec.questions;
}

export function decide(_input: any, answers: Record<string, any>) {
  const systemOneAnswers = answers as unknown as SystemOneAnswers;
  const decision = decideNoticeSufficiency(systemOneAnswers);

  switch (decision.outcome) {
    case "NO_AUTO_RENEWAL":
      return { outcome: "not_applicable" as const };
    case "SUFFICIENT_NOTICE":
      return { outcome: "avoided" as const };
    case "INSUFFICIENT_NOTICE":
      return { outcome: "not_avoided" as const };
    case "NEEDS_HUMAN_REVIEW":
      return { outcome: "abstain" as const };
  }
}
