import {
  LogLine,
  Answers,
  selectCandidates,
  buildQuestions,
  decide as decideCore,
} from "./decide";

export interface CulpritInput {
  repo: string;
  branch: string;
  runner: string;
  job_name: string;
  attempt_number: number;
  max_attempts: number;
  log_tail: string;
  log_lines: string[];
}

export interface CulpritState {
  job_id: string;
  repo: string;
  step: string;
  lines: LogLine[];
  candidate_indices: number[];
}

function toLines(logLines: string[]): LogLine[] {
  return logLines.map((text, idx) => ({ i: idx + 1, text }));
}

// Plain transformation: the step name is the most recent "Run <cmd>" group
// header in the log, since that's the command whose output follows it.
function extractStep(logLines: string[]): string {
  let step = "";
  for (const text of logLines) {
    const match = /^##\[group\]Run (.+)$/.exec(text);
    if (match) step = match[1];
  }
  return step;
}

export function buildState(input: CulpritInput): CulpritState {
  const lines = toLines(input.log_lines);
  return {
    job_id: "gha-run-48213-job-2",
    repo: input.repo,
    step: extractStep(input.log_lines),
    lines,
    candidate_indices: selectCandidates(lines),
  };
}

export function questions(input: CulpritInput): Record<string, unknown> {
  const lines = toLines(input.log_lines);
  return buildQuestions(selectCandidates(lines));
}

export function decide(
  input: CulpritInput,
  answers: Answers,
): { culprit_lines: number[] } {
  const lines = toLines(input.log_lines);
  const candidateIndices = selectCandidates(lines);
  const decision = decideCore(lines, candidateIndices, answers);

  if (decision.status === "resolved" && decision.culpritLine !== undefined) {
    return { culprit_lines: [decision.culpritLine - 1] };
  }
  return { culprit_lines: decision.topCandidates.map((c) => c.line - 1) };
}
