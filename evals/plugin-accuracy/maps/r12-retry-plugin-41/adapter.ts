import questionsJson from "./questions.json";
import { decide as decideImpl } from "./decide.ts";

interface JobInput {
  repo: string;
  branch: string;
  runner: string;
  job_name?: string;
  attempt_number: number;
  max_attempts?: number;
  log_tail: string;
  log_lines?: string[];
}

type ChoiceApiAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};

type NoulApiAnswer = {
  type: "noul";
  noul: number;
};

type ScoreApiAnswer = {
  type: "score";
  score: number;
  confidence: number;
  legend: Record<string, number>;
  probabilities: Record<string, number>;
};

interface JevAnswerMap {
  failure_cause: ChoiceApiAnswer;
  instructs_reader: NoulApiAnswer;
  [key: string]: ChoiceApiAnswer | NoulApiAnswer | ScoreApiAnswer;
}

export function buildState(input: JobInput) {
  const example = questionsJson.state;
  return {
    repo: input.repo ?? example.repo,
    branch: input.branch ?? example.branch,
    runner: input.runner ?? example.runner,
    attempt_number: input.attempt_number ?? example.attempt_number,
    log_tail: input.log_tail ?? example.log_tail,
  };
}

export function questions(_input: JobInput) {
  return questionsJson.questions;
}

export function decide(input: JobInput, answers: JevAnswerMap): { retry: "yes" | "no" | "abstain" } {
  const { failure_cause, instructs_reader } = answers;

  const decision = decideImpl(
    { attempt_number: input.attempt_number },
    {
      failure_cause: {
        choice: failure_cause.choice,
        confidence: failure_cause.confidence,
        probabilities: failure_cause.probabilities,
      },
      // NoulAnswer is the probability that the statement is true.
      instructs_reader: instructs_reader.noul,
    }
  );

  switch (decision.action) {
    case "retry":
    case "rerun_free":
      return { retry: "yes" };
    case "no_retry":
      return { retry: "no" };
    case "escalate":
    default:
      return { retry: "abstain" };
  }
}
