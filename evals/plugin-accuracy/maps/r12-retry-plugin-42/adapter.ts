import questionsJson from "./questions.json";
import { decideRetry, type RetryAction } from "./decide.ts";

interface CaseInput {
  id: string;
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

export function buildState(input: CaseInput) {
  const { repo, branch, runner, attempt_number, max_attempts, log_tail } = input.input;
  return {
    repo,
    branch,
    runner,
    attempt: attempt_number,
    max_attempts,
    log_tail,
  };
}

export function questions(_input: CaseInput) {
  return questionsJson.questions;
}

interface ChoiceApiAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

interface NoulApiAnswer {
  type: "noul";
  noul: number;
}

interface Answers {
  cause: ChoiceApiAnswer;
  explicit_retry_claim: NoulApiAnswer;
}

const ACTION_TO_RETRY: Record<RetryAction, "yes" | "no" | "abstain"> = {
  retry: "yes",
  no_retry: "no",
  escalate: "abstain",
};

export function decide(input: CaseInput, answers: Answers) {
  const state = buildState(input);
  const decision = decideRetry(state, {
    cause: answers.cause as any,
    explicit_retry_claim: answers.explicit_retry_claim,
  });
  return { retry: ACTION_TO_RETRY[decision.action] };
}
