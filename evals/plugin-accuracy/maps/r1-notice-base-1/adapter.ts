import questionsData from "./questions.json";
import { decide as decideCore } from "./decide.ts";

interface CaseInput {
  contract_text: string;
  email_text: string;
  email_from?: string;
  received_date: string;
  current_term_end_date?: string;
}

type NoulApiAnswer = { type: "noul"; noul: boolean };
type ChoiceApiAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};
type ScoreApiAnswer = {
  type: "score";
  score: number;
  confidence: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
};
type ApiAnswer = NoulApiAnswer | ChoiceApiAnswer | ScoreApiAnswer;

const exampleState = (questionsData as any).state;

export function buildState(input: CaseInput) {
  return {
    contract: {
      id: exampleState.contract.id,
      text: input.contract_text,
    },
    cancellation: {
      text: input.email_text,
      receivedAt: input.received_date,
    },
  };
}

export function questions(_input: CaseInput) {
  return (questionsData as any).questions;
}

export function decide(_input: CaseInput, answers: Record<string, ApiAnswer>) {
  const asNoul = (a: ApiAnswer) => ({ probability: Number((a as NoulApiAnswer).noul) });
  const asChoice = (a: ApiAnswer) => {
    const c = a as ChoiceApiAnswer;
    return { choice: c.choice, confidence: c.confidence, probabilities: c.probabilities };
  };

  const jevAnswers = {
    auto_renewal_clause: asNoul(answers.auto_renewal_clause),
    required_notice_window: asChoice(answers.required_notice_window),
    notice_method_compliant: asNoul(answers.notice_method_compliant),
    cancellation_intent_clear: asNoul(answers.cancellation_intent_clear),
    notice_timely: asNoul(answers.notice_timely),
  };

  const decision = decideCore(jevAnswers as any);

  const outcomeByVerdict: Record<string, "avoided" | "not_avoided" | "not_applicable" | "abstain"> = {
    NOT_APPLICABLE: "not_applicable",
    SUFFICIENT_NOTICE: "avoided",
    INSUFFICIENT_NOTICE: "not_avoided",
    NEEDS_HUMAN_REVIEW: "abstain",
  };

  return { outcome: outcomeByVerdict[decision.verdict] };
}
