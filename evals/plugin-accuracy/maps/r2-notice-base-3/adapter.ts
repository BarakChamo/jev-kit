import questionsData from "./questions.json";
import { decide as decideCore } from "./decide.ts";

interface CaseInput {
  contract_text: string;
  email_text: string;
  email_from: string;
  received_date: string;
  current_term_end_date: string;
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
  legend: Record<string, number>;
  probabilities: Record<string, number>;
};

type ApiAnswer = NoulApiAnswer | ChoiceApiAnswer | ScoreApiAnswer;

export function buildState(input: CaseInput) {
  return {
    contractText: input.contract_text,
    cancellationEmailText: input.email_text,
    cancellationReceivedDate: input.received_date,
    currentTermEndDate: input.current_term_end_date,
  };
}

export function questions(_input: CaseInput) {
  return questionsData.questions;
}

export function decide(input: CaseInput, answers: Record<string, ApiAnswer>) {
  const noul = (a: ApiAnswer) => {
    const n = a as NoulApiAnswer;
    return { probability: Number(n.noul) };
  };
  const choice = (a: ApiAnswer) => {
    const c = a as ChoiceApiAnswer;
    return { choice: c.choice, confidence: c.confidence, probabilities: c.probabilities };
  };

  const jevAnswers = {
    autoRenewal: noul(answers.autoRenewal),
    requiredNoticeDays: choice(answers.requiredNoticeDays),
    noticeMethodCompliant: noul(answers.noticeMethodCompliant),
    cancellationIntentClear: noul(answers.cancellationIntentClear),
  };

  const facts = {
    cancellationReceivedDate: input.received_date,
    currentTermEndDate: input.current_term_end_date,
  };

  const result = decideCore(facts as any, jevAnswers as any);

  const outcomeByDecision: Record<string, "avoided" | "not_avoided" | "not_applicable" | "abstain"> = {
    NO_AUTO_RENEWAL_CLAUSE: "not_applicable",
    RENEWAL_AVOIDED: "avoided",
    RENEWAL_NOT_AVOIDED: "not_avoided",
    INVALID_NOTICE: "not_avoided",
    NEEDS_REVIEW: "abstain",
  };

  return { outcome: outcomeByDecision[result.decision] ?? "abstain" };
}
