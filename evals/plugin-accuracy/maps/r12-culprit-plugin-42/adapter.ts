import { buildLines, buildRequest, decide as decideJev } from "./decide";

interface CaseInput {
  repo: string;
  branch: string;
  runner: string;
  job_name: string;
  attempt_number: number;
  max_attempts: number;
  log_tail: string;
  log_lines: string[];
}

interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

function jobId(input: CaseInput): string {
  return `${input.repo}/${input.job_name}#${input.attempt_number}`;
}

function requestFor(input: CaseInput) {
  const lines = buildLines(input.log_lines);
  return buildRequest(jobId(input), lines);
}

export function buildState(input: CaseInput) {
  return requestFor(input).state;
}

export function questions(input: CaseInput) {
  return requestFor(input).questions;
}

export function decide(
  input: CaseInput,
  answers: { culprit_line: JevChoiceAnswer }
): { culprit_lines: number[] } {
  const lines = buildLines(input.log_lines);
  const result = decideJev(jobId(input), lines, answers);

  if (result.status === "resolved") {
    return { culprit_lines: [result.lineNumber - 1] };
  }

  const culprit_lines = result.topCandidates
    .filter((c) => c.lineNumber !== null)
    .map((c) => (c.lineNumber as number) - 1);
  return { culprit_lines };
}
