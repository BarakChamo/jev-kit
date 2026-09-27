import questionsData from "./questions.json";
import { decideNotice, type JevAnswers } from "./decide.ts";

export interface CaseInput {
  contract_text: string;
  email_text: string;
  email_from: string;
  received_date: string;
  current_term_end_date?: string;
}

interface NoulApiAnswer {
  type: "noul";
  noul: boolean | string | null;
  confidence?: number;
  probabilities?: Record<string, number>;
}

interface ChoiceApiAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

type ApiAnswer = NoulApiAnswer | ChoiceApiAnswer;

export function buildState(input: CaseInput) {
  return {
    contract_text: input.contract_text,
    cancellation_email_text: input.email_text,
    received_date: input.received_date,
  };
}

export function questions(_input: CaseInput) {
  return questionsData.questions;
}

// decide.ts's NoulAnswer is a plain number: P(true). The API's noul answer
// carries that as probabilities.true; fall back to deriving it from
// noul/confidence if probabilities is missing.
function noulProbability(answer: NoulApiAnswer): number {
  if (typeof answer.noul === "number") return answer.noul; // the API sends P(true) as a number
  if (answer.probabilities && typeof answer.probabilities["true"] === "number") {
    return answer.probabilities["true"];
  }
  const confidence = answer.confidence ?? 1;
  if (answer.noul === true || answer.noul === "true") return confidence;
  if (answer.noul === false || answer.noul === "false") return 1 - confidence;
  return 0.5;
}

export function decide(
  input: CaseInput,
  answers: Record<string, ApiAnswer>,
): { outcome: "avoided" | "not_avoided" | "not_applicable" | "abstain" } {
  const jevAnswers: JevAnswers = {
    has_auto_renewal: noulProbability(answers.has_auto_renewal as NoulApiAnswer),
    email_allowed: noulProbability(answers.email_allowed as NoulApiAnswer),
    email_states_cancellation: noulProbability(answers.email_states_cancellation as NoulApiAnswer),
    start_year: answers.start_year as ChoiceApiAnswer,
    start_month: answers.start_month as ChoiceApiAnswer,
    start_day: answers.start_day as ChoiceApiAnswer,
    term_length: answers.term_length as ChoiceApiAnswer,
    notice_period: answers.notice_period as ChoiceApiAnswer,
  };

  const decision = decideNotice(input.received_date, jevAnswers);

  switch (decision.outcome) {
    case "NOTICE_TIMELY":
      return { outcome: "avoided" };
    case "NOTICE_LATE":
    case "INVALID_METHOD":
      return { outcome: "not_avoided" };
    case "NO_AUTO_RENEWAL":
      return { outcome: "not_applicable" };
    case "NEEDS_HUMAN_REVIEW":
      return { outcome: "abstain" };
  }
}
