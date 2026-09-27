import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { decide as decideJob } from "./decide";

const __dirname = dirname(fileURLToPath(import.meta.url));
const questionsDoc = JSON.parse(readFileSync(join(__dirname, "questions.json"), "utf-8"));

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

export function buildState(input: CaseInput) {
  return {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    attempt: input.attempt_number,
    max_attempts: input.max_attempts,
    log_tail: input.log_tail,
  };
}

export function questions(_input: CaseInput) {
  return questionsDoc.questions;
}

export function decide(input: CaseInput, answers: any) {
  const state = buildState(input);

  const causeAnswer = answers.cause;
  const injectionAnswer = answers.injection_attempt;

  const decideAnswers = {
    cause: {
      choice: causeAnswer.choice,
      confidence: causeAnswer.confidence,
      probabilities: causeAnswer.probabilities,
    },
    injection_attempt: {
      noul: injectionAnswer.noul,
    },
  };

  const result = decideJob(state, decideAnswers);

  const retry: "yes" | "no" | "abstain" =
    result.action === "retry" ? "yes" : result.action === "fail" ? "no" : "abstain";

  return { retry };
}
