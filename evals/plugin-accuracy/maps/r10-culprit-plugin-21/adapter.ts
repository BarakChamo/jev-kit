import { buildRequest } from "./decide";

// Mirrors decide.ts's own (unexported) threshold — see decide.ts CONFIDENCE_THRESHOLD.
const CONFIDENCE_THRESHOLD = 0.6;

// The example state's job_id (questions.json) — the canonical input has no job-id field to copy.
const EXAMPLE_JOB_ID = "build-42891";

export interface CaseInput {
  id?: string;
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

export interface NoulAnswer {
  type: "noul";
  noul: boolean;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  confidence: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
}

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export function buildState(input: CaseInput) {
  const { job_name, log_lines } = input.input;
  return buildRequest(EXAMPLE_JOB_ID, job_name, log_lines).body.state;
}

export function questions(input: CaseInput) {
  const { job_name, log_lines } = input.input;
  return buildRequest(EXAMPLE_JOB_ID, job_name, log_lines).body.questions;
}

export function decide(input: CaseInput, answers: Record<string, Answer>): { culprit_lines: number[] } {
  const { job_name, log_lines } = input.input;
  const { lines } = buildRequest(EXAMPLE_JOB_ID, job_name, log_lines);

  if (lines.length <= 1) {
    return { culprit_lines: lines.length === 1 ? [lines[0].i] : [] };
  }

  const culprit = answers.culprit as ChoiceAnswer;
  const byLine = new Map(lines.map((l) => [String(l.i), l]));
  const ranked = Object.entries(culprit.probabilities)
    .filter(([key]) => key !== "unclear")
    .sort(([, a], [, b]) => b - a)
    .map(([key, p]) => ({ line: byLine.get(key)!, probability: p }));

  const topProbability = culprit.probabilities[culprit.choice] ?? 0;

  if (culprit.choice === "unclear" || topProbability < CONFIDENCE_THRESHOLD) {
    return { culprit_lines: ranked.slice(0, 3).map((c) => c.line.i) };
  }

  return { culprit_lines: [byLine.get(culprit.choice)!.i] };
}
