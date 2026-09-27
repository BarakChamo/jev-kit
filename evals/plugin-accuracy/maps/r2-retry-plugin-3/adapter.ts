import questionsJson from "./questions.json";
import { decideRetry, type JobState, type JevAnswers, type FailureCause } from "./decide.ts";

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

export function buildState(input: CaseInput): JobState {
  return {
    job_id: questionsJson.state.job_id,
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    attempt_number: input.attempt_number,
    max_attempts: input.max_attempts,
    log_tail: input.log_tail,
  };
}

export function questions(_input: CaseInput) {
  return questionsJson.questions;
}

interface ApiChoiceAnswer {
  type: "choice";
  choice: FailureCause;
  confidence: number;
  probabilities: Record<FailureCause, number>;
}

export function decide(
  input: CaseInput,
  answers: { failure_cause: ApiChoiceAnswer }
): { retry: "yes" | "no" | "abstain" } {
  const jevAnswers: JevAnswers = {
    failure_cause: {
      choice: answers.failure_cause.choice,
      confidence: answers.failure_cause.confidence,
      probabilities: answers.failure_cause.probabilities,
    },
  };

  const decision = decideRetry(buildState(input), jevAnswers);

  switch (decision.action) {
    case "retry":
      return { retry: "yes" };
    case "no_retry":
      return { retry: "no" };
    case "escalate":
      return { retry: "abstain" };
  }
}
