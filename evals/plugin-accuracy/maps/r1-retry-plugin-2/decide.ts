// Retry decision for a failed CI job, driven by answers from questions.json.
// Jev classifies *what happened now*; every "should we act on it" rule lives here.

interface JobState {
  repo: string;
  branch: string;
  runner: string;
  attempt: number;
  max_attempts: number;
  log_tail: string;
}

interface ChoiceAnswer {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

interface NoulAnswer {
  noul: number; // P(true)
}

interface JevAnswers {
  failure_cause: ChoiceAnswer;
  cause_visible_in_log: NoulAnswer;
}

type Decision =
  | { action: "retry" }
  | { action: "no_retry"; reason: string }
  | { action: "escalate"; reason: string };

const RETRYABLE = new Set(["infra_transient", "flaky_test"]);
const TERMINAL = new Set([
  "deterministic_code_failure",
  "deterministic_test_failure",
  "environment_config",
]);

// Gate on summed probability mass over the winning class(es), not the confidence scalar
// (rule 8): the scalar under-reports true accuracy by up to 29 points.
const RETRY_PROB_THRESHOLD = 0.7;
const TERMINAL_PROB_THRESHOLD = 0.7;
const LOG_SUFFICIENCY_THRESHOLD = 0.6;

export function decide(state: JobState, answers: JevAnswers): Decision {
  // Hard cap lives in code: it's a fact already in the state, not a judgment.
  if (state.attempt >= state.max_attempts) {
    return {
      action: "no_retry",
      reason: `attempt ${state.attempt} reached max_attempts ${state.max_attempts}`,
    };
  }

  // Low confidence must never relax the decision: an unreadable log escalates
  // regardless of what failure_cause says, since its classification isn't trustworthy here.
  if (answers.cause_visible_in_log.noul < LOG_SUFFICIENCY_THRESHOLD) {
    return {
      action: "escalate",
      reason: "log_tail does not show the underlying error; classification is unreliable",
    };
  }

  const { choice, probabilities } = answers.failure_cause;
  const retryMass = sumProb(probabilities, RETRYABLE);
  const terminalMass = sumProb(probabilities, TERMINAL);

  if (retryMass >= RETRY_PROB_THRESHOLD) {
    return { action: "retry" };
  }

  if (terminalMass >= TERMINAL_PROB_THRESHOLD) {
    return {
      action: "no_retry",
      reason: `failure classified as ${choice} (p=${terminalMass.toFixed(2)})`,
    };
  }

  // Neither class clears its threshold (includes "unknown" winning, or a near-even split
  // between a retryable and a terminal cause) — don't guess, send to a human.
  return {
    action: "escalate",
    reason: `failure_cause ambiguous: top=${choice}, retry_mass=${retryMass.toFixed(2)}, terminal_mass=${terminalMass.toFixed(2)}`,
  };
}

function sumProb(probabilities: Record<string, number>, labels: Set<string>): number {
  let total = 0;
  for (const label of labels) total += probabilities[label] ?? 0;
  return total;
}
