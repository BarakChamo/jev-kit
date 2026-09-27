// Adapter: canonical case input -> Jev request (state/questions) -> decide.ts decision.

import {
  type JobMeta,
  type JevAnswers,
  type JevRequest,
  buildRequest,
  decide as decideJev,
} from "./decide.ts";

export interface CaseInput {
  id: string;
  input: {
    repo: string;
    branch: string;
    runner: string;
    job_name: string;
    attempt_number: number;
    max_attempts: number;
    log_tail: string;
    log_lines: string[];
  };
}

// Fallback values for state fields the canonical input has no source for.
const EXAMPLE_JOB: JobMeta = {
  id: "gha-8841203-3",
  name: "test",
  provider: "github-actions",
  exit_code: 1,
};

function jobMetaFrom(caseInput: CaseInput): JobMeta {
  const { input } = caseInput;
  const exitMatch = input.log_tail.match(/exit code (\d+)/i);
  return {
    id: EXAMPLE_JOB.id,
    name: input.job_name ?? EXAMPLE_JOB.name,
    provider: EXAMPLE_JOB.provider,
    exit_code: exitMatch ? Number(exitMatch[1]) : EXAMPLE_JOB.exit_code,
  };
}

function requestFor(caseInput: CaseInput): JevRequest {
  return buildRequest(jobMetaFrom(caseInput), caseInput.input.log_lines);
}

export function buildState(input: CaseInput) {
  return requestFor(input).state;
}

export function questions(input: CaseInput) {
  return requestFor(input).questions;
}

export function decide(input: CaseInput, answers: JevAnswers): { culprit_lines: number[] } {
  const req = requestFor(input);
  // buildRequest keeps only the last MAX_LINES lines, re-indexed from 0;
  // offset maps those indices back onto input.log_lines.
  const offset = input.input.log_lines.length - req.state.lines.length;
  const result = decideJev(req.state.lines, answers);

  if (result.status === "found") {
    return { culprit_lines: [offset + result.line.i] };
  }
  return { culprit_lines: result.top.map((t) => offset + t.line.i) };
}
