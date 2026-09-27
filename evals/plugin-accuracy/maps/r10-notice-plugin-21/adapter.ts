import questionsJson from "./questions.json";
import { decideNoticeSufficiency, type CaseInput, type JevAnswers } from "./decide";

export interface Input {
  contract_text: string;
  email_text: string;
  email_from?: string;
  received_date: string;
  current_term_end_date: string;
}

export function buildState(input: Input) {
  return {
    contract_text: input.contract_text,
    cancellation_email_text: input.email_text,
    cancellation_email_received_date: input.received_date,
    current_term_end_date: input.current_term_end_date,
  };
}

export function questions(_input: Input) {
  return questionsJson.questions;
}

type Answer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "score"; score: number; confidence: number; legend: Record<string, number>; probabilities: Record<string, number> };

export function decide(
  input: Input,
  answers: Record<string, Answer>,
): { outcome: "avoided" | "not_avoided" | "not_applicable" | "abstain" } {
  const caseInput: CaseInput = {
    contractText: input.contract_text,
    cancellationEmailText: input.email_text,
    emailReceivedDate: input.received_date,
    currentTermEndDate: input.current_term_end_date,
  };

  const jevAnswers = answers as unknown as JevAnswers;

  const decision = decideNoticeSufficiency(caseInput, jevAnswers);

  switch (decision.outcome) {
    case "sufficient_notice":
      return { outcome: "avoided" };
    case "insufficient_notice":
      return { outcome: "not_avoided" };
    case "escalate":
      return { outcome: "abstain" };
  }
}
