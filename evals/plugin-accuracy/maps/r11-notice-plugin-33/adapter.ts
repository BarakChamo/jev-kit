import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decide as decideRenewal } from "./decide.ts";

const questionsPath = fileURLToPath(new URL("./questions.json", import.meta.url));
const questionsDoc = JSON.parse(readFileSync(questionsPath, "utf8"));

export interface CaseInput {
  contract_text: string;
  email_text: string;
  email_from?: string;
  received_date: string;
  current_term_end_date?: string;
}

export function buildState(input: CaseInput) {
  return {
    contract_text: input.contract_text ?? questionsDoc.state.contract_text,
    cancellation_text: input.email_text ?? questionsDoc.state.cancellation_text,
    received_date: input.received_date ?? questionsDoc.state.received_date,
  };
}

export function questions(_input: CaseInput) {
  return questionsDoc.questions;
}

// Matches decide.ts's own NOUL_FALSE threshold: below it, decide.ts treats
// has_auto_renewal as clearly false and returns "renewal_avoided" for the
// "nothing to avoid" case rather than for an actual timely-notice case.
const NOUL_FALSE = 0.25;

export function decide(input: CaseInput, answers: Record<string, any>) {
  const result = decideRenewal(answers as any, input.received_date);

  let outcome: "avoided" | "not_avoided" | "not_applicable" | "abstain";
  switch (result.outcome) {
    case "needs_human_review":
      outcome = "abstain";
      break;
    case "insufficient_notice":
      outcome = "not_avoided";
      break;
    case "renewal_avoided":
      outcome = answers.has_auto_renewal?.noul <= NOUL_FALSE ? "not_applicable" : "avoided";
      break;
    default:
      outcome = "abstain";
  }

  return { outcome };
}
