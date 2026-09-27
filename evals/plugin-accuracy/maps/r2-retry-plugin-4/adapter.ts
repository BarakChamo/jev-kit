import questionsFile from "./questions.json";
import { decideRetry } from "./decide.ts";

interface CanonicalInput {
  repo: string;
  branch: string;
  runner: string;
  job_name: string;
  attempt_number: number;
  max_attempts: number;
  log_tail: string;
  log_lines?: string[];
}

export function buildState(input: CanonicalInput) {
  return {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    attempt_number: input.attempt_number,
    max_attempts: input.max_attempts,
    job_name: input.job_name,
    log_tail: input.log_tail,
  };
}

export function questions(_input: CanonicalInput) {
  return questionsFile.questions;
}

export function decide(
  input: CanonicalInput,
  answers: Record<string, any>,
): { retry: "yes" | "no" | "abstain" } {
  const answer = answers.failure_cause;
  const jev = {
    failure_cause: {
      choice: answer.choice,
      confidence: answer.confidence,
      probabilities: answer.probabilities,
    },
  };

  const job = {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    attempt_number: input.attempt_number,
    max_attempts: input.max_attempts,
  };

  const { decision } = decideRetry(job, jev as any);

  if (decision === "retry") return { retry: "yes" };
  if (decision === "no_retry") return { retry: "no" };
  return { retry: "abstain" };
}
