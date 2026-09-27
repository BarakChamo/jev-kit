// Retry decision for a failed CI job, built on one Jev `choice` question (see questions.json).
// Jev classifies *why* the job failed; the retry/no-retry/escalate logic is a plain code gate
// over its calibrated probabilities plus the attempt budget (a pure numeric comparison, so it
// never goes near the model).

export interface JobState {
  job_id: string;
  repo: string;
  branch: string;
  runner: string;
  attempt_number: number;
  max_attempts: number;
  log_tail: string;
}

export type FailureCause =
  | "transient_infrastructure"
  | "resource_exhaustion"
  | "flaky_test"
  | "deterministic_code_failure"
  | "environment_configuration_issue"
  | "unknown_insufficient_evidence";

export interface ChoiceAnswer<T extends string> {
  choice: T;
  confidence: number;
  probabilities: Record<T, number>;
}

export interface JevAnswers {
  failure_cause: ChoiceAnswer<FailureCause>;
}

export type RetryDecision =
  | { action: "retry"; reason: string }
  | { action: "no_retry"; reason: string }
  | { action: "escalate"; reason: string };

// Causes retrying is expected to fix.
const RETRYABLE: FailureCause[] = ["transient_infrastructure", "resource_exhaustion", "flaky_test"];
// Causes retrying will just reproduce.
const TERMINAL: FailureCause[] = ["deterministic_code_failure", "environment_configuration_issue"];

// Gate on the summed probability mass of a label group, not the `confidence` scalar
// (the scalar is systematically under-confident; the distribution is well calibrated).
const DECISION_THRESHOLD = 0.7;

function massOf(probabilities: Record<FailureCause, number>, causes: FailureCause[]): number {
  return causes.reduce((sum, c) => sum + (probabilities[c] ?? 0), 0);
}

export function decideRetry(state: JobState, answers: JevAnswers): RetryDecision {
  if (state.attempt_number >= state.max_attempts) {
    return {
      action: "no_retry",
      reason: `attempt ${state.attempt_number} has reached max_attempts (${state.max_attempts})`,
    };
  }

  const { probabilities } = answers.failure_cause;
  const retryMass = massOf(probabilities, RETRYABLE);
  const terminalMass = massOf(probabilities, TERMINAL);

  // Low confidence never relaxes toward retry: an uncertain case is escalated, not allowed.
  if (retryMass >= DECISION_THRESHOLD) {
    return {
      action: "retry",
      reason: `failure_cause points to a retryable cause (p=${retryMass.toFixed(2)}: ${describeTop(probabilities, RETRYABLE)})`,
    };
  }

  if (terminalMass >= DECISION_THRESHOLD) {
    return {
      action: "no_retry",
      reason: `failure_cause points to a terminal cause (p=${terminalMass.toFixed(2)}: ${describeTop(probabilities, TERMINAL)})`,
    };
  }

  return {
    action: "escalate",
    reason: `failure_cause is ambiguous (retry mass=${retryMass.toFixed(2)}, terminal mass=${terminalMass.toFixed(2)}); route to human review`,
  };
}

function describeTop(probabilities: Record<FailureCause, number>, causes: FailureCause[]): string {
  const top = [...causes].sort((a, b) => (probabilities[b] ?? 0) - (probabilities[a] ?? 0))[0];
  return `${top}=${(probabilities[top] ?? 0).toFixed(2)}`;
}
