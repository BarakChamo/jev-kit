// Retry decision for a failed CI job.
//
// Jev answers one fact: the most likely failure_cause, as a calibrated
// distribution over mutually-exclusive classes. Everything else -- whether
// that cause is retryable, whether attempts remain, how confident we need to
// be -- is a policy table and stays in code (jev-questions rule 6/12).

type FailureCause =
  | "flaky_test"
  | "transient_infra"
  | "deterministic_code_defect"
  | "resource_limit_exceeded"
  | "dependency_or_environment_missing"
  | "auth_or_permission_error"
  | "cancelled_or_external"
  | "unknown";

interface JevChoiceAnswer<T extends string> {
  choice: T;
  confidence: number;
  probabilities: Record<T, number>;
}

interface JevResponse {
  failure_cause: JevChoiceAnswer<FailureCause>;
}

interface JobMetadata {
  repo: string;
  branch: string;
  runner: string;
  attempt_number: number;
  max_attempts: number;
}

type Decision = "retry" | "no_retry" | "escalate";

// Only these causes are worth retrying unchanged: the job's environment, not
// its code, was the problem. Everything else either reproduces deterministically
// or needs a human/config change before retrying helps.
const RETRYABLE_CAUSES = new Set<FailureCause>(["flaky_test", "transient_infra"]);

// Gate on the probability mass on the chosen label, not the `confidence`
// scalar (jev-eval: the scalar under-confidence by up to 29 points; the
// distribution tracks the diagonal within ~4).
const MIN_RETRY_PROBABILITY = 0.7;

export function decideRetry(
  job: JobMetadata,
  jev: JevResponse,
): { decision: Decision; reason: string } {
  if (job.attempt_number >= job.max_attempts) {
    return { decision: "no_retry", reason: "max_attempts_reached" };
  }

  const { choice: cause, probabilities } = jev.failure_cause;
  const p = probabilities[cause];

  // Low confidence never relaxes toward "retry" -- it only ever pushes
  // toward the safer fallback (jev-questions rule 9).
  if (cause === "unknown" || p < MIN_RETRY_PROBABILITY) {
    return { decision: "escalate", reason: `low_confidence_cause:${cause}:${p.toFixed(2)}` };
  }

  if (RETRYABLE_CAUSES.has(cause)) {
    return { decision: "retry", reason: `retryable_cause:${cause}` };
  }

  return { decision: "no_retry", reason: `non_retryable_cause:${cause}` };
}
