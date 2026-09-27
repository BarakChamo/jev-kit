import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decide as decideCore } from "./decide";

const __dirname = dirname(fileURLToPath(import.meta.url));
const questionsFile = JSON.parse(
  readFileSync(join(__dirname, "questions.json"), "utf8"),
);

interface CaseInput {
  repo: string;
  branch: string;
  runner: string;
  job_name?: string;
  attempt_number: number;
  max_attempts: number;
  log_tail: string;
  log_lines?: string[];
}

// The suite's case record is { id, input, gold }; buildState/questions/decide
// all operate on the case's `input` field, but tolerate being handed the
// whole record too.
function unwrapInput(raw: any): CaseInput {
  if (raw && typeof raw === "object" && raw.input && typeof raw.input === "object") {
    return raw.input;
  }
  return raw;
}

export function buildState(input: any) {
  const c = unwrapInput(input);
  return {
    repo: c.repo,
    branch: c.branch,
    runner: c.runner,
    attempt: c.attempt_number,
    max_attempts: c.max_attempts,
    log_tail: c.log_tail,
  };
}

export function questions(_input: any) {
  return questionsFile.questions;
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
  legend: Record<string, number>;
  probabilities: Record<string, number>;
}

type ApiAnswer = NoulApiAnswer | ChoiceApiAnswer | ScoreApiAnswer;

export function decide(
  input: any,
  answers: Record<string, ApiAnswer>,
): { retry: "yes" | "no" | "abstain" } {
  const state = buildState(input);
  const decideAnswers = {
    failure_cause: answers.failure_cause as ChoiceApiAnswer,
    cause_visible_in_log: answers.cause_visible_in_log as NoulApiAnswer,
  };

  const result = decideCore(state, decideAnswers as any);

  switch (result.action) {
    case "retry":
      return { retry: "yes" };
    case "no_retry":
      return { retry: "no" };
    case "escalate":
      return { retry: "abstain" };
  }
}
