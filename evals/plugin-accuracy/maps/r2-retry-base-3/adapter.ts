import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decideRetry } from "./decide.ts";

const questionsJson = JSON.parse(
  readFileSync(fileURLToPath(new URL("./questions.json", import.meta.url)), "utf8"),
);

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

interface NoulApiAnswer {
  type: "noul";
  noul: number;
}

interface ChoiceApiAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

interface ScoreApiAnswer {
  type: "score";
  score: number;
  confidence: number;
  legend?: unknown;
  probabilities: Record<string, number>;
}

export interface AnswersInput {
  transient_failure: NoulApiAnswer;
  failure_category: ChoiceApiAnswer;
  retry_confidence: ScoreApiAnswer;
}

export function buildState(input: CaseInput) {
  const exampleState = questionsJson.state;
  const logTail = Array.isArray(input.log_lines) && input.log_lines.length > 0
    ? input.log_lines.slice(-200)
    : (input.log_tail ?? "").split("\n").slice(-200);

  return {
    repo: input.repo ?? exampleState.repo,
    branch: input.branch ?? exampleState.branch,
    workflow: exampleState.workflow,
    job: input.job_name ?? exampleState.job,
    runner: input.runner ?? exampleState.runner,
    attempt: input.attempt_number ?? exampleState.attempt,
    maxAttempts: input.max_attempts ?? exampleState.maxAttempts,
    logTail,
  };
}

export function questions(_input: CaseInput) {
  return questionsJson.questions;
}

function argmax(probabilities: Record<string, number>): string {
  let bestKey = "";
  let bestValue = -Infinity;
  for (const [key, value] of Object.entries(probabilities)) {
    if (value > bestValue) {
      bestValue = value;
      bestKey = key;
    }
  }
  return bestKey;
}

export function decide(input: CaseInput, answers: AnswersInput) {
  const job = {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    attempt: input.attempt_number,
    maxAttempts: input.max_attempts,
  };

  const jevAnswers = {
    transient_failure: {
      probability: answers.transient_failure.noul,
    },
    failure_category: {
      choice: answers.failure_category.choice,
      confidence: answers.failure_category.confidence,
      probabilities: answers.failure_category.probabilities,
    },
    retry_confidence: {
      level: argmax(answers.retry_confidence.probabilities),
    },
  };

  const result = decideRetry(job as any, jevAnswers as any);

  if (result.retry === true) return { retry: "yes" as const };
  if (result.retry === false) return { retry: "no" as const };
  return { retry: "abstain" as const };
}
