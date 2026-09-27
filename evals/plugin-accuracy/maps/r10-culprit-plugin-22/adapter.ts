import { buildRequest, decide as decideCulprit } from "./decide.ts";

interface JevChoiceAnswer {
  type?: string;
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

interface CaseInput {
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

const FALLBACK_JOB_ID = "build-42891"; // example state's value; canonical input has no job id

function jobIdFor(input: CaseInput): string {
  return input.id ?? FALLBACK_JOB_ID;
}

export function buildState(input: CaseInput) {
  return buildRequest(jobIdFor(input), input.input.log_lines).state;
}

export function questions(input: CaseInput) {
  return buildRequest(jobIdFor(input), input.input.log_lines).questions;
}

export function decide(input: CaseInput, answers: Record<string, JevChoiceAnswer>) {
  const request = buildRequest(jobIdFor(input), input.input.log_lines);
  const decision = decideCulprit(request, answers.culprit);

  if (decision.outcome === "resolved") {
    return { culprit_lines: [decision.lineIndex] };
  }
  return { culprit_lines: decision.candidates.map((c) => c.lineIndex) };
}
