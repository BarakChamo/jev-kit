import { buildRequest, decide as decideTs } from "./decide";
import type { JobMeta, LogLine, ChoiceAnswer } from "./decide";

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

const EXAMPLE_JOB: JobMeta = {
  id: "gh-run-48213-job-3",
  workflow: "ci.yml",
  step: "Run tests",
  conclusion: "failure",
};

const MAX_WINDOW = 200;

// Keep original 1-based positions as `n` so criteria keys map back to indices in input.log_lines.
function buildLines(input: CaseInput): LogLine[] {
  const logLines = input.log_lines ?? [];
  const start = Math.max(0, logLines.length - MAX_WINDOW);
  return logLines.slice(start).map((text, i) => ({ n: start + i + 1, text }));
}

function buildJob(input: CaseInput): JobMeta {
  return {
    id: EXAMPLE_JOB.id,
    workflow: EXAMPLE_JOB.workflow,
    step: input.job_name ?? EXAMPLE_JOB.step,
    conclusion: EXAMPLE_JOB.conclusion,
  };
}

export function buildState(input: CaseInput) {
  return buildRequest(buildJob(input), buildLines(input)).state;
}

export function questions(input: CaseInput) {
  return buildRequest(buildJob(input), buildLines(input)).questions;
}

export function decide(
  input: CaseInput,
  answers: Record<string, ChoiceAnswer & { type?: string }>
): { culprit_lines: number[] } {
  const lines = buildLines(input);
  const answer = answers.culprit_line;
  const decision = decideTs(lines, answer);

  if (decision.status === "found") {
    return { culprit_lines: [decision.line - 1] };
  }
  return { culprit_lines: decision.candidates.map((c) => c.line - 1) };
}
