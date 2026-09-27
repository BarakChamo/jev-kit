// Adapter wiring questions.json's state/questions to decide.ts's decision logic.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decideRetry } from "./decide.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const questionsDoc = JSON.parse(
  readFileSync(join(__dirname, "questions.json"), "utf8"),
);

interface CaseInput {
  repo: string;
  branch: string;
  runner: string;
  job_name: string;
  attempt_number: number;
  max_attempts: number;
  log_tail?: string;
  log_lines?: string[];
}

interface NoulApiAnswer {
  type: "noul";
  noul: boolean;
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
  legend: Record<string, number> | string[];
  probabilities: Record<string, number>;
}

interface ApiAnswers {
  is_transient: NoulApiAnswer;
  failure_category: ChoiceApiAnswer;
  retry_value: ScoreApiAnswer;
}

export function buildState(input: CaseInput) {
  const example = questionsDoc.state;

  const lines: string[] =
    input.log_lines ??
    (typeof input.log_tail === "string" ? input.log_tail.split("\n") : example.log_tail);

  return {
    repo: input.repo ?? example.repo,
    branch: input.branch ?? example.branch,
    runner: input.runner ?? example.runner,
    job_name: input.job_name ?? example.job_name,
    attempt: input.attempt_number ?? example.attempt,
    max_attempts: input.max_attempts ?? example.max_attempts,
    log_tail: lines.slice(-200),
  };
}

export function questions(_input: CaseInput) {
  return questionsDoc.questions;
}

function levelFromScore(answer: ScoreApiAnswer): string {
  const { score, legend, probabilities } = answer;

  if (Array.isArray(legend)) {
    const idx = Math.round(score);
    return legend[Math.max(0, Math.min(legend.length - 1, idx))];
  }

  if (legend && typeof legend === "object") {
    let bestKey: string | undefined;
    let bestDiff = Infinity;
    for (const [key, value] of Object.entries(legend)) {
      const diff = Math.abs(value - score);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestKey = key;
      }
    }
    if (bestKey !== undefined) return bestKey;
  }

  const sorted = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  return sorted[0][0];
}

export function decide(input: CaseInput, answers: ApiAnswers) {
  const state = buildState(input);

  const decisionAnswers = {
    is_transient: { probability: Number(answers.is_transient.noul) },
    failure_category: {
      choice: answers.failure_category.choice,
      confidence: answers.failure_category.confidence,
      probabilities: answers.failure_category.probabilities,
    },
    retry_value: { level: levelFromScore(answers.retry_value) },
  };

  const result = decideRetry(state as any, decisionAnswers as any);

  return { retry: result.retry ? "yes" : "no" } as const;
}
