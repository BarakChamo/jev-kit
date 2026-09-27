// Adapter between a canonical CI-failure case and Jev's culprit_line map.

import { buildCulpritRequest, decideCulpritLine } from "./decide.ts";
import questionsJson from "./questions.json" with { type: "json" };

type CaseInput = {
  id?: string;
  repo?: string;
  branch?: string;
  runner?: string;
  job_name?: string;
  attempt_number?: number;
  max_attempts?: number;
  log_tail?: string;
  log_lines: string[];
};

type NoulAnswer = { type: "noul"; noul: boolean; probability?: number };
type ChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};
type ScoreAnswer = {
  type: "score";
  score: number;
  confidence: number;
  legend?: Record<string, number>;
  probabilities?: Record<string, number>;
};
type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

const EXAMPLE_STATE = questionsJson.state as {
  job_name: string;
  step_name: string;
  exit_code: number;
  lines: Record<string, string>;
};

function extractExitCode(input: CaseInput): number {
  const match = (input.log_tail ?? "").match(/exit code (\d+)/);
  return match ? Number(match[1]) : EXAMPLE_STATE.exit_code;
}

export function buildState(input: CaseInput) {
  const { lines } = buildCulpritRequest(input.log_lines, 0);
  return {
    job_name: input.job_name ?? EXAMPLE_STATE.job_name,
    step_name: EXAMPLE_STATE.step_name,
    exit_code: extractExitCode(input),
    lines,
  };
}

export function questions(input: CaseInput) {
  const { criteria } = buildCulpritRequest(input.log_lines, 0);
  const base = questionsJson.questions.culprit_line;
  return {
    culprit_line: {
      ...base,
      criteria,
    },
  };
}

export function decide(input: CaseInput, answers: { culprit_line: Answer }): {
  culprit_lines: number[];
} {
  const { lines } = buildCulpritRequest(input.log_lines, 0);
  const answer = answers.culprit_line as ChoiceAnswer;

  const result = decideCulpritLine(lines, answer);

  if (result.status === "auto") {
    return { culprit_lines: [result.line] };
  }
  return { culprit_lines: result.candidates.map((c) => c.line) };
}
