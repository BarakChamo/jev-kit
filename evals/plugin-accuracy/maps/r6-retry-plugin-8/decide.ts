// Retry decision for a failed CI job, derived from the Jev answers to questions.json.
// Jev classifies the failure cause and flags possible log manipulation; every other
// judgment (attempt cap, retry-ability of a cause, confidence gating) is decided here.

type FailureCause =
  | "infra"
  | "dependency"
  | "flaky_test"
  | "timeout"
  | "build_failure"
  | "test_failure"
  | "unclear";

interface ChoiceAnswer<T extends string> {
  choice: T;
  confidence: number;
  probabilities: Record<T, number>;
}

interface NoulAnswer {
  noul: number; // probability the "true" criterion holds
}

interface JevAnswers {
  failure_cause: ChoiceAnswer<FailureCause>;
  log_manipulated: NoulAnswer;
}

interface JobMetadata {
  attempt_number: number;
  max_attempts: number;
}

export type RetryDecision =
  | { action: "retry"; reason: string }
  | { action: "no_retry"; reason: string }
  | { action: "manual_review"; reason: string };

// A cause is retry-able iff it's definitionally an environment/timing problem,
// not a defect in the code under test (rule 6: derive a class-membership fact in code).
const RETRYABLE_CAUSES: ReadonlySet<FailureCause> = new Set([
  "infra",
  "dependency",
  "flaky_test",
  "timeout",
]);
const NON_RETRYABLE_CAUSES: ReadonlySet<FailureCause> = new Set([
  "build_failure",
  "test_failure",
]);

const RETRY_PROB_THRESHOLD = 0.75;
const NO_RETRY_PROB_THRESHOLD = 0.75;
const MANIPULATION_PROB_THRESHOLD = 0.5;

export function decideRetry(
  job: JobMetadata,
  answers: JevAnswers,
): RetryDecision {
  // Pure code, no model needed: the attempt cap is fully determined by metadata.
  if (job.attempt_number >= job.max_attempts) {
    return { action: "no_retry", reason: "max_attempts_reached" };
  }

  // Untrusted log content: a low-confidence gate never relaxes a decision, so a
  // suspected manipulation attempt always routes to a human rather than auto-retrying.
  if (answers.log_manipulated.noul >= MANIPULATION_PROB_THRESHOLD) {
    return { action: "manual_review", reason: "possible_log_manipulation" };
  }

  // Gate on the probability mass of the labels we care about, not the confidence scalar.
  const probs = answers.failure_cause.probabilities;
  const retryableProb = sumProbabilities(probs, RETRYABLE_CAUSES);
  const nonRetryableProb = sumProbabilities(probs, NON_RETRYABLE_CAUSES);

  if (retryableProb >= RETRY_PROB_THRESHOLD) {
    return {
      action: "retry",
      reason: `cause=${answers.failure_cause.choice} p=${retryableProb.toFixed(2)}`,
    };
  }
  if (nonRetryableProb >= NO_RETRY_PROB_THRESHOLD) {
    return {
      action: "no_retry",
      reason: `cause=${answers.failure_cause.choice} p=${nonRetryableProb.toFixed(2)}`,
    };
  }

  // Neither side is confident enough (includes the "unclear" choice): abstain.
  return { action: "manual_review", reason: "low_confidence_classification" };
}

function sumProbabilities(
  probabilities: Record<FailureCause, number>,
  causes: ReadonlySet<FailureCause>,
): number {
  let total = 0;
  for (const cause of causes) total += probabilities[cause] ?? 0;
  return total;
}
