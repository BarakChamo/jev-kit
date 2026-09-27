// Decision logic for questions.json's answers. Does not call the Jev API.

interface JobState {
  repo: string;
  branch: string;
  runner: string;
  attempt: number;
  max_attempts: number;
  log_tail: string;
}

type Cause = "flaky_test" | "infrastructure" | "code_defect" | "config_or_credentials" | "unknown";

interface ChoiceAnswer<T extends string> {
  choice: T;
  confidence: number;
  probabilities: Record<T, number>;
}

interface NoulAnswer {
  noul: number; // probability the statement is true
}

interface Answers {
  cause: ChoiceAnswer<Cause>;
  injection_attempt: NoulAnswer;
}

type Action = "retry" | "fail" | "escalate";

interface Decision {
  action: Action;
  reason: string;
  cause?: Cause;
}

// Causes a retry is expected to fix. Kept separate from `unknown` and
// `config_or_credentials`/`code_defect`, which a retry won't fix.
const RETRYABLE: ReadonlySet<Cause> = new Set(["flaky_test", "infrastructure"]);

// Gate on the probability of the label we act on, not the `confidence` scalar (jev-questions rule 8).
const GATE_THRESHOLD = 0.7;

// A log claiming its own failure is "safe to retry" is exactly the kind of
// judgment that's worth cross-checking with a detector (rule 10).
const INJECTION_THRESHOLD = 0.5;

export function decide(state: JobState, answers: Answers): Decision {
  if (state.attempt >= state.max_attempts) {
    return { action: "fail", reason: `attempt ${state.attempt} reached max_attempts (${state.max_attempts})` };
  }

  if (answers.injection_attempt.noul >= INJECTION_THRESHOLD) {
    return { action: "escalate", reason: "log_tail may contain text targeting the retry decision" };
  }

  const { probabilities, choice } = answers.cause;
  const retryProb = RETRYABLE.has(choice)
    ? [...RETRYABLE].reduce((sum, c) => sum + (probabilities[c] ?? 0), 0)
    : 0;
  const failProb = 1 - [...RETRYABLE].reduce((sum, c) => sum + (probabilities[c] ?? 0), 0);

  if (retryProb >= GATE_THRESHOLD) {
    return { action: "retry", reason: choice, cause: choice };
  }
  if (failProb >= GATE_THRESHOLD) {
    return { action: "fail", reason: choice, cause: choice };
  }
  // Low confidence must never relax toward "retry" (rule: low confidence never relaxes a gate).
  return { action: "escalate", reason: `cause unclear (top: ${choice} @ ${probabilities[choice]})`, cause: choice };
}
