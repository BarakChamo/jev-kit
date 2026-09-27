import questionsJson from "./questions.json";
import { decideNotice, type CaseState, type JevAnswers } from "./decide.ts";

interface CaseInput {
  id: string;
  input: {
    contract_text: string;
    email_text: string;
    email_from: string;
    received_date: string;
    current_term_end_date: string;
  };
  notes?: string;
}

export function buildState(input: CaseInput): CaseState {
  return {
    contract_text: input.input.contract_text,
    cancellation_email_text: input.input.email_text,
    cancellation_received_date: input.input.received_date,
  };
}

export function questions(_input: CaseInput) {
  return questionsJson.questions;
}

export function decide(
  input: CaseInput,
  answers: JevAnswers
): { outcome: "avoided" | "not_avoided" | "not_applicable" | "abstain" } {
  const state = buildState(input);
  const result = decideNotice(state, answers);

  switch (result.status) {
    case "notice_sufficient":
      return { outcome: "avoided" };
    case "notice_insufficient":
      return { outcome: "not_avoided" };
    case "needs_review":
      return { outcome: "abstain" };
  }
}
