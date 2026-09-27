import questionsData from "./questions.json" with { type: "json" };
import { decideRetry } from "./decide.ts";

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

export function buildState(input: CaseInput) {
  return {
    repo: input.repo,
    workflow: questionsData.state.workflow,
    job_name: input.job_name,
    branch: input.branch,
    runner: input.runner,
    attempt_number: input.attempt_number,
    max_attempts: input.max_attempts,
    log_tail: input.log_tail,
  };
}

export function questions(_input: CaseInput) {
  return questionsData.questions;
}

export function decide(input: CaseInput, answers: any): { retry: "yes" | "no" | "abstain" } {
  const state = buildState(input);
  const { action } = decideRetry(state, answers);

  if (action === "retry") return { retry: "yes" };
  if (action === "no_retry") return { retry: "no" };
  return { retry: "abstain" };
}
