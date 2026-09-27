import questionsJson from "./questions.json";
import { decideRetry } from "./decide.ts";

interface CaseInput {
  repo?: string;
  branch?: string;
  runner?: string;
  attempt_number?: number;
  max_attempts?: number;
  log_tail?: string;
  log_lines?: string[];
}

const EXAMPLE_STATE = questionsJson.state as {
  job: {
    id: string;
    repo: string;
    branch: string;
    runner: string;
    attempt: number;
    maxAttempts: number;
  };
  log_tail: string[];
};

export function buildState(input: CaseInput) {
  const lines =
    input.log_lines ??
    (input.log_tail !== undefined ? input.log_tail.split("\n") : EXAMPLE_STATE.log_tail);

  return {
    job: {
      id: EXAMPLE_STATE.job.id,
      repo: input.repo ?? EXAMPLE_STATE.job.repo,
      branch: input.branch ?? EXAMPLE_STATE.job.branch,
      runner: input.runner ?? EXAMPLE_STATE.job.runner,
      attempt: input.attempt_number ?? EXAMPLE_STATE.job.attempt,
      maxAttempts: input.max_attempts ?? EXAMPLE_STATE.job.maxAttempts,
    },
    log_tail: lines.slice(-200),
  };
}

export function questions(_input: CaseInput) {
  return questionsJson.questions;
}

type NoulApiAnswer = { type: "noul"; noul: number };
type ChoiceApiAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};
type ScoreApiAnswer = {
  type: "score";
  score: number;
  confidence: number;
  legend: string[];
  probabilities: Record<string, number>;
};

interface ApiAnswers {
  is_transient: NoulApiAnswer;
  failure_category: ChoiceApiAnswer;
  retry_value: ScoreApiAnswer;
}

function levelFromScore(answer: ScoreApiAnswer): string {
  const index = Math.max(0, Math.min(answer.legend.length - 1, Math.round(answer.score)));
  return answer.legend[index];
}

export function decide(input: CaseInput, answers: ApiAnswers): { retry: "yes" | "no" | "abstain" } {
  const job = {
    attempt: input.attempt_number ?? EXAMPLE_STATE.job.attempt,
    maxAttempts: input.max_attempts ?? EXAMPLE_STATE.job.maxAttempts,
  };

  const decision = decideRetry(job, {
    is_transient: {
      ...answers.is_transient,
      probability: answers.is_transient.noul,
    },
    failure_category: {
      choice: answers.failure_category.choice as any,
      confidence: answers.failure_category.confidence,
      probabilities: answers.failure_category.probabilities as any,
    },
    retry_value: {
      ...answers.retry_value,
      level: levelFromScore(answers.retry_value) as any,
    },
  });

  return { retry: decision.retry ? "yes" : "no" };
}
