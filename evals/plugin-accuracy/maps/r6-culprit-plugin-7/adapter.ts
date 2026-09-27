import { candidateLines, buildRequest, decide as decideCulprit, type LogLine } from "./decide";

// decide.ts's state.job_id/command aren't derivable from the case input by plain
// transformation, so we fall back to questions.json's example values, as instructed.
const EXAMPLE_JOB_ID = "ci-8841";
const EXAMPLE_COMMAND = "npm test";

function toLogLines(lines: string[]): LogLine[] {
  return lines.map((text, i) => ({ i, text }));
}

function candidatesFor(input: { log_lines: string[] }): LogLine[] {
  return candidateLines(toLogLines(input.log_lines ?? []));
}

export function buildState(input: { log_lines: string[] }) {
  return {
    job_id: EXAMPLE_JOB_ID,
    command: EXAMPLE_COMMAND,
    log_lines: candidatesFor(input),
  };
}

export function questions(input: { log_lines: string[] }) {
  return buildRequest(EXAMPLE_JOB_ID, EXAMPLE_COMMAND, toLogLines(input.log_lines ?? [])).questions;
}

export function decide(
  input: { log_lines: string[] },
  answers: Record<string, { type: "noul"; noul: number }>,
): { culprit_lines: number[] } {
  const result = decideCulprit(candidatesFor(input), answers);
  if (result.autoPoint) {
    return { culprit_lines: [result.autoPoint.i] };
  }
  return { culprit_lines: result.shortlist.map((line) => line.i) };
}
