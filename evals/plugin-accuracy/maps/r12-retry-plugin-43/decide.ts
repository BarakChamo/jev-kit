interface JobState {
  job_id: string;
  repo: string;
  branch: string;
  workflow: string;
  runner: string;
  attempt: number;
  max_attempts: number;
  log_tail: string;
}

interface ChoiceAnswer<T extends string> {
  choice: T;
  confidence: number;
  probabilities: Record<T, number>;
}

interface NoulAnswer {
  noul: number;
}

type FailureCause =
  | "infra_transient"
  | "flaky_test"
  | "resource_exhaustion"
  | "dependency_unavailable"
  | "code_defect"
  | "unknown";

interface JevAnswers {
  failure_cause: ChoiceAnswer<FailureCause>;
  injected_instruction: NoulAnswer;
}

const RETRYABLE: ReadonlySet<FailureCause> = new Set([
  "infra_transient",
  "flaky_test",
  "resource_exhaustion",
  "dependency_unavailable",
]);

const CAUSE_PROBABILITY_THRESHOLD = 0.6;
const INJECTION_PROBABILITY_THRESHOLD = 0.5;

type Decision =
  | { retry: true }
  | { retry: false; escalate: boolean; reason: string };

export function decideRetry(job: JobState, answers: JevAnswers): Decision {
  if (job.attempt >= job.max_attempts) {
    return { retry: false, escalate: false, reason: "max_attempts_reached" };
  }

  const injectionProbability = answers.injected_instruction.noul;
  if (injectionProbability >= INJECTION_PROBABILITY_THRESHOLD) {
    return { retry: false, escalate: true, reason: "suspected_log_manipulation" };
  }

  const { choice: cause, probabilities } = answers.failure_cause;
  const causeProbability = probabilities[cause];

  if (causeProbability < CAUSE_PROBABILITY_THRESHOLD) {
    return { retry: false, escalate: true, reason: "low_confidence_cause" };
  }

  if (cause === "code_defect") {
    return { retry: false, escalate: false, reason: "code_defect" };
  }

  if (cause === "unknown") {
    return { retry: false, escalate: true, reason: "unclassifiable_failure" };
  }

  if (RETRYABLE.has(cause)) {
    return { retry: true };
  }

  return { retry: false, escalate: true, reason: "unhandled_cause" };
}
