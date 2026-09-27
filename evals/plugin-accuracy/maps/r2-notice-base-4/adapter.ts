import questionsJson from "./questions.json";
import { decide as runDecide, type CaseResult } from "./decide";

interface CanonicalInput {
  id: string;
  input: {
    contract_text: string;
    email_text: string;
    email_from?: string;
    received_date: string;
    current_term_end_date: string;
  };
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
  legend: Record<string, unknown>;
  probabilities: Record<string, number>;
};
type ApiAnswer = NoulApiAnswer | ChoiceApiAnswer | ScoreApiAnswer;

const EXAMPLE_STATE = questionsJson.state as any;

export function buildState(input: CanonicalInput) {
  const c = input.input;
  return {
    contract: {
      id: EXAMPLE_STATE.contract.id,
      text: c.contract_text,
      current_term_end: c.current_term_end_date,
    },
    cancellation: {
      id: EXAMPLE_STATE.cancellation.id,
      text: c.email_text,
      date_received: c.received_date,
    },
  };
}

export function questions(_input: CanonicalInput) {
  return questionsJson.questions;
}

function noulProbability(answer: NoulApiAnswer): number {
  return Number(answer.noul);
}

export function decide(
  input: CanonicalInput,
  answers: Record<string, ApiAnswer>
): { outcome: "avoided" | "not_avoided" | "not_applicable" | "abstain" } {
  const state = buildState(input);

  const autoRenewal = answers.auto_renewal_clause as NoulApiAnswer;
  const requiredNoticeDays = answers.required_notice_days as ChoiceApiAnswer;
  const validCancellationNotice = answers.valid_cancellation_notice as NoulApiAnswer;
  const noticeTimely = answers.notice_timely as NoulApiAnswer;

  const result: CaseResult = runDecide({
    contractId: state.contract.id,
    cancellationId: state.cancellation.id,
    currentTermEnd: state.contract.current_term_end,
    dateReceived: state.cancellation.date_received,
    answers: {
      auto_renewal_clause: { probability: noulProbability(autoRenewal) },
      required_notice_days: {
        choice: requiredNoticeDays.choice,
        confidence: requiredNoticeDays.confidence,
        probabilities: requiredNoticeDays.probabilities,
      },
      valid_cancellation_notice: { probability: noulProbability(validCancellationNotice) },
      notice_timely: { probability: noulProbability(noticeTimely) },
    },
  });

  switch (result.decision) {
    case "no_auto_renewal":
      return { outcome: "not_applicable" };
    case "notice_sufficient":
      return { outcome: "avoided" };
    case "invalid_notice_renewal_proceeds":
    case "notice_insufficient":
      return { outcome: "not_avoided" };
    case "needs_review":
      return { outcome: "abstain" };
  }
}
