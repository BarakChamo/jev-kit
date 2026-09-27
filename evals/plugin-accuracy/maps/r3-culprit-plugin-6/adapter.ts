// Adapter between the culprit-line CI case input and Jev's map (questions.json / decide.ts).

import { selectCandidates, buildQuestions, decide as runDecide } from "./decide";
import type { Candidate, NoulAnswers } from "./decide";
import exampleRequest from "./questions.json";

export interface CulpritCaseInput {
  repo: string;
  branch: string;
  runner: string;
  job_name: string;
  attempt_number: number;
  max_attempts: number;
  log_tail: string;
  log_lines: string[];
}

const EXAMPLE_STATE = exampleRequest.state;

export function buildState(input: CulpritCaseInput) {
  const log_lines = input.log_lines;
  const candidates: Candidate[] = selectCandidates(log_lines);
  return {
    // `job_id` isn't present on the case input; fall back to the example state's value.
    job_id: EXAMPLE_STATE.job_id,
    log_lines,
    candidates,
  };
}

export function questions(input: CulpritCaseInput) {
  const candidates = selectCandidates(input.log_lines);
  return buildQuestions(candidates);
}

export function decide(
  input: CulpritCaseInput,
  answers: NoulAnswers
): { culprit_lines: number[] } {
  const candidates = selectCandidates(input.log_lines);
  const result = runDecide(EXAMPLE_STATE.job_id, candidates, answers);

  if (result.likelyOutsideCandidates) {
    return { culprit_lines: [] };
  }

  return { culprit_lines: result.shortlist.map((item) => item.index) };
}
