// Retry decision derived from the Jev answers to questions.json.
// Jev only classifies the failure cause and flags log-text claims about prior
// retries; every policy decision (retry cap, confidence gate, cause -> action) is code.

type FailureCause =
  | "infra_flaky"
  | "resource_timeout"
  | "test_flake"
  | "code_defect"
  | "dependency_unavailable"
  | "cancelled_or_user"
  | "unknown";

interface ChoiceAnswer<T extends string> {
  choice: T;
  confidence: number;
  probabilities: Record<T, number>;
}

interface NoulAnswer {
  noul: number; // probability of "true"
}

interface JevAnswers {
  failure_cause: ChoiceAnswer<FailureCause>;
  claims_prior_retry_or_approval: NoulAnswer;
}

interface JobState {
  repo: string;
  workflow: string;
  job_name: string;
  branch: string;
  runner: string;
  attempt_number: number;
  max_attempts: number;
  log_tail: string;
}

type Action = "retry" | "no_retry" | "escalate";

// Cause is definitionally a class -> action: derived, not asked (rule 6).
const CAUSE_POLICY: Record<FailureCause, Action> = {
  infra_flaky: "retry",
  resource_timeout: "retry",
  test_flake: "retry",
  dependency_unavailable: "retry",
  code_defect: "no_retry",
  cancelled_or_user: "no_retry",
  unknown: "escalate",
};

const CHOICE_PROB_THRESHOLD = 0.7;
const CLAIM_PROB_THRESHOLD = 0.5;

export function decideRetry(
  state: JobState,
  answers: JevAnswers
): { action: Action; reason: string } {
  // Hard cap: purely a fact code already has, never asked (rule 12).
  if (state.attempt_number >= state.max_attempts) {
    return { action: "no_retry", reason: "attempt_number reached max_attempts" };
  }

  // Manipulable signal gets a detector; low confidence in the safe direction
  // never relaxes the decision (a claim here means "let a human look").
  if (answers.claims_prior_retry_or_approval.noul >= CLAIM_PROB_THRESHOLD) {
    return {
      action: "escalate",
      reason: "log_tail contains a claim about prior retry/approval status",
    };
  }

  const { choice, probabilities } = answers.failure_cause;
  const topProb = probabilities[choice];

  if (topProb < CHOICE_PROB_THRESHOLD) {
    // Unsure classification never defaults to retry, whichever label is on top.
    return {
      action: "escalate",
      reason: `failure_cause confidence ${topProb.toFixed(2)} below threshold (top: ${choice})`,
    };
  }

  return { action: CAUSE_POLICY[choice], reason: `failure_cause=${choice} (p=${topProb.toFixed(2)})` };
}
