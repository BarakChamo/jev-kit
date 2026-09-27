import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { decideRetry } from "./decide.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const questionsDoc = JSON.parse(
  readFileSync(path.join(__dirname, "questions.json"), "utf8"),
);

interface CaseInput {
  repo: string;
  branch: string;
  runner: string;
  job_name: string;
  attempt_number: number;
  max_attempts: number;
  log_tail: string;
  log_lines?: string[];
}

type FailureCause =
  | "infra_transient"
  | "flaky_test"
  | "resource_exhaustion"
  | "dependency_unavailable"
  | "code_defect"
  | "unknown";

interface NoulApiAnswer {
  type: "noul";
  noul: number;
}

interface ChoiceApiAnswer<T extends string = string> {
  type: "choice";
  choice: T;
  confidence: number;
  probabilities: Record<T, number>;
}

interface ScoreApiAnswer {
  type: "score";
  score: number;
  confidence: number;
  legend: unknown;
  probabilities: Record<string, number>;
}

type AnswersMap = Record<
  string,
  NoulApiAnswer | ChoiceApiAnswer | ScoreApiAnswer
>;

export function buildState(input: CaseInput) {
  return {
    job_id: "",
    repo: input.repo,
    branch: input.branch,
    workflow: "",
    runner: input.runner,
    attempt: input.attempt_number,
    max_attempts: input.max_attempts,
    log_tail: input.log_tail,
  };
}

export function questions(_input: CaseInput) {
  return questionsDoc.questions;
}

export function decide(
  input: CaseInput,
  answers: AnswersMap,
): { retry: "yes" | "no" | "abstain" } {
  const state = buildState(input);

  const failureCause = answers.failure_cause as ChoiceApiAnswer<FailureCause>;
  const injectedInstruction = answers.injected_instruction as NoulApiAnswer;

  const decision = decideRetry(state, {
    failure_cause: {
      choice: failureCause.choice,
      confidence: failureCause.confidence,
      probabilities: failureCause.probabilities,
    },
    injected_instruction: {
      noul: injectedInstruction.noul,
    },
  });

  if (decision.retry) {
    return { retry: "yes" };
  }
  if (decision.escalate) {
    return { retry: "abstain" };
  }
  return { retry: "no" };
}
