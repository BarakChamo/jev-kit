// Turns a Jev answer for the `questions.json` map into a retry decision.
// Business rules (attempt cap, thresholds) run in code; Jev only classifies
// the failure cause from the log and detects log text aimed at the reader.

type ChoiceAnswer = {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};

type NoulAnswer = number; // probability that the statement is true

interface JevAnswers {
  failure_cause: ChoiceAnswer;
  instructs_reader: NoulAnswer;
}

interface JobMeta {
  attempt_number: number;
}

const MAX_ATTEMPTS = 3;
// Gate on the probability mass of the labels we care about, not the
// top-choice `confidence` scalar (it under-reports by up to ~29 points).
const RETRY_PROB_THRESHOLD = 0.65;
const NO_RETRY_PROB_THRESHOLD = 0.35; // p_retry below this => confidently deterministic
const INSTRUCTION_PROB_THRESHOLD = 0.5;

const RETRY_ELIGIBLE_CAUSES = ["flaky_test", "infrastructure", "timeout"] as const;

export type Decision =
  | { action: "retry"; reason: string }
  | { action: "no_retry"; reason: string }
  | { action: "rerun_free"; reason: string } // cancelled run: re-run without spending an attempt
  | { action: "escalate"; reason: string };

export function decide(job: JobMeta, answers: JevAnswers): Decision {
  const { failure_cause, instructs_reader } = answers;
  const p = failure_cause.probabilities;

  if (job.attempt_number >= MAX_ATTEMPTS) {
    return { action: "no_retry", reason: `attempt ${job.attempt_number} reached MAX_ATTEMPTS=${MAX_ATTEMPTS}` };
  }

  if (instructs_reader >= INSTRUCTION_PROB_THRESHOLD) {
    return {
      action: "escalate",
      reason: `log_tail contains text aimed at the reader (p=${instructs_reader.toFixed(2)}); do not let it drive an automatic decision`,
    };
  }

  const pCancelled = p["cancelled"] ?? 0;
  if (pCancelled > 0.5) {
    return { action: "rerun_free", reason: `classified cancelled (p=${pCancelled.toFixed(2)})` };
  }

  const pRetry = RETRY_ELIGIBLE_CAUSES.reduce((sum, k) => sum + (p[k] ?? 0), 0);

  if (pRetry >= RETRY_PROB_THRESHOLD) {
    return { action: "retry", reason: `${failure_cause.choice}, p_retry_eligible=${pRetry.toFixed(2)}` };
  }

  if (pRetry <= NO_RETRY_PROB_THRESHOLD) {
    return { action: "no_retry", reason: `${failure_cause.choice}, p_retry_eligible=${pRetry.toFixed(2)}` };
  }

  return {
    action: "escalate",
    reason: `ambiguous cause (top=${failure_cause.choice}, p_retry_eligible=${pRetry.toFixed(2)})`,
  };
}
