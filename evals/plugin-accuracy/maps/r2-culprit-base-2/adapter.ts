// Adapter between the canonical CI-failure case input and the Jev request/decision
// defined in questions.json / decide.ts. Builds the state + questions to send,
// and maps decide.ts's own decision back onto the case input's log_lines indices.

import { buildRequest, decide as decideCi, CiLogState, JevAnswers } from "./decide";

export interface CaseInput {
  repo: string;
  branch: string;
  runner: string;
  job_name: string;
  attempt_number: number;
  max_attempts: number;
  log_tail: string;
  log_lines: string[];
}

export interface NoulAnswer {
  type: "noul";
  noul: boolean;
}

export interface ChoiceApiAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface ScoreApiAnswer {
  type: "score";
  score: number;
  confidence: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
}

export type ApiAnswer = NoulAnswer | ChoiceApiAnswer | ScoreApiAnswer;

export interface Answers {
  culprit_line: ChoiceApiAnswer;
  is_infra_failure: NoulAnswer;
}

function jobId(input: CaseInput): string {
  return `${input.repo}:${input.job_name}#${input.attempt_number}`;
}

function request(input: CaseInput) {
  return buildRequest(jobId(input), input.log_lines.length, input.log_lines);
}

export function buildState(input: CaseInput): CiLogState {
  return request(input).state;
}

export function questions(input: CaseInput): Record<string, unknown> {
  return request(input).questions;
}

export function decide(input: CaseInput, answers: Answers): { culprit_lines: number[] } {
  const state = buildState(input);

  const jevAnswers: JevAnswers = {
    culprit_line: {
      choice: answers.culprit_line.choice,
      confidence: answers.culprit_line.confidence,
      probabilities: answers.culprit_line.probabilities,
    },
    // is_infra_failure is a noul answer with no probability field; derive one
    // mechanically from the boolean flag since decide.ts wants P(true).
    is_infra_failure: Number(answers.is_infra_failure.noul),
  };

  const decision = decideCi(state, jevAnswers);

  if (decision.kind === "infra") {
    return { culprit_lines: [] };
  }
  if (decision.kind === "pinpoint") {
    return { culprit_lines: [decision.lineNumber - state.start_line] };
  }
  return {
    culprit_lines: decision.candidates.map((c) => c.lineNumber - state.start_line),
  };
}
