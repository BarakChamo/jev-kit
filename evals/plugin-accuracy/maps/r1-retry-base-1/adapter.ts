import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { decide as decideImpl, type RetryDecision } from "./decide.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const questionsData = JSON.parse(
  fs.readFileSync(path.join(__dirname, "questions.json"), "utf8"),
);

export interface CaseInput {
  repo: string;
  branch: string;
  runner: string;
  job_name?: string;
  attempt_number: number;
  max_attempts: number;
  log_tail?: string;
  log_lines?: string[];
}

export function buildState(input: CaseInput) {
  const lines =
    input.log_lines ??
    (input.log_tail ? input.log_tail.split("\n") : questionsData.state.logTail);

  return {
    repo: input.repo ?? questionsData.state.repo,
    branch: input.branch ?? questionsData.state.branch,
    runner: input.runner ?? questionsData.state.runner,
    attempt: input.attempt_number ?? questionsData.state.attempt,
    maxAttempts: input.max_attempts ?? questionsData.state.maxAttempts,
    logTail: lines.slice(-200),
  };
}

export function questions(_input: CaseInput) {
  return questionsData.questions;
}

interface NoulApiAnswer {
  type: "noul";
  noul: number | boolean;
}

interface ChoiceApiAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

interface ScoreApiAnswer {
  type: "score";
  score: string | number;
  confidence: number;
  legend: string[] | Record<string, string>;
  probabilities: Record<string, number>;
}

export interface ApiAnswers {
  transient: NoulApiAnswer;
  category: ChoiceApiAnswer;
  retrySuccessLikelihood: ScoreApiAnswer;
}

const SCORE_LEVELS = ["very_unlikely", "unlikely", "uncertain", "likely", "very_likely"];

function toProbability(noul: number | boolean): number {
  return typeof noul === "number" ? noul : noul ? 1 : 0;
}

function toLevel(score: string | number): string {
  return typeof score === "string" ? score : SCORE_LEVELS[score];
}

export function decide(
  input: CaseInput,
  answers: ApiAnswers,
): { retry: "yes" | "no" | "abstain" } {
  const state = buildState(input);

  const decideAnswers = {
    transient: {
      ...answers.transient,
      probability: toProbability(answers.transient.noul),
    },
    category: answers.category,
    retrySuccessLikelihood: {
      ...answers.retrySuccessLikelihood,
      level: toLevel(answers.retrySuccessLikelihood.score),
    },
  };

  const result: RetryDecision = decideImpl(state, decideAnswers as any);

  if (result.retry === true) return { retry: "yes" };
  if (result.retry === false) return { retry: "no" };
  return { retry: "abstain" };
}
