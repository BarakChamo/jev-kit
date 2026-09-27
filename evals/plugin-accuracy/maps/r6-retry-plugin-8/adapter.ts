import { decideRetry } from "./decide";
import questionsJson from "./questions.json";

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

const EXAMPLE_STATE = questionsJson.state;

export function buildState(input: CaseInput) {
  return {
    repo: input.repo ?? EXAMPLE_STATE.repo,
    branch: input.branch ?? EXAMPLE_STATE.branch,
    runner: input.runner ?? EXAMPLE_STATE.runner,
    attempt_number: input.attempt_number ?? EXAMPLE_STATE.attempt_number,
    max_attempts: input.max_attempts ?? EXAMPLE_STATE.max_attempts,
    log_tail: input.log_tail ?? EXAMPLE_STATE.log_tail,
  };
}

export function questions(_input: CaseInput) {
  return questionsJson.questions;
}

export function decide(input: CaseInput, answers: Record<string, any>) {
  const job = {
    attempt_number: input.attempt_number,
    max_attempts: input.max_attempts,
  };

  const jevAnswers = {
    failure_cause: answers.failure_cause,
    log_manipulated: answers.log_manipulated,
  } as any;

  const result = decideRetry(job, jevAnswers);

  switch (result.action) {
    case "retry":
      return { retry: "yes" as const };
    case "no_retry":
      return { retry: "no" as const };
    default:
      return { retry: "abstain" as const };
  }
}
