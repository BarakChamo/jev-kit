// Derives the retry decision from the Jev answers to questions.json.
// Never call the API here — this only shapes the request and consumes its response.

type Cause = "infra_transient" | "flaky" | "code_defect" | "cancelled_or_external" | "unclear";

interface ChoiceAnswer<T extends string> {
  choice: T;
  confidence: number;
  probabilities: Record<T, number>;
}

interface NoulAnswer {
  noul: number; // probability of "true"
}

interface JobState {
  repo: string;
  branch: string;
  runner: string;
  attempt: number;
  max_attempts: number;
  log_tail: string;
}

interface JevAnswers {
  cause: ChoiceAnswer<Cause>;
  explicit_retry_claim: NoulAnswer;
}

export type RetryAction = "retry" | "no_retry" | "escalate";

export interface RetryDecision {
  action: RetryAction;
  reason: string;
  review_suggested: boolean; // surfaced to a human queue, never used to change `action`
}

const RETRY_WORTHY: Cause[] = ["infra_transient", "flaky", "cancelled_or_external"];

const RETRY_PROB_THRESHOLD = 0.75;
const NO_RETRY_PROB_THRESHOLD = 0.75;
const MANIPULATION_CLAIM_THRESHOLD = 0.5;

export function decideRetry(state: JobState, answers: JevAnswers): RetryDecision {
  // Attempt budget is a plain integer comparison — never asked to Jev.
  if (state.attempt >= state.max_attempts) {
    return { action: "no_retry", reason: "attempt budget exhausted", review_suggested: false };
  }

  const { probabilities } = answers.cause;
  const retryWorthyProb = RETRY_WORTHY.reduce((sum, c) => sum + (probabilities[c] ?? 0), 0);
  const codeDefectProb = probabilities.code_defect ?? 0;

  // A log line telling the classifier "this is flaky, retry me" is exactly the kind of
  // manipulable claim rule 10 warns about. It never changes the action — low confidence
  // or a manipulation signal only ever escalates, it never relaxes into an allow — but it
  // does route the case to a human review queue alongside whatever action was taken.
  const reviewSuggested = answers.explicit_retry_claim.noul >= MANIPULATION_CLAIM_THRESHOLD;

  if (codeDefectProb >= NO_RETRY_PROB_THRESHOLD) {
    return { action: "no_retry", reason: "likely a real code/test defect", review_suggested: reviewSuggested };
  }

  if (retryWorthyProb >= RETRY_PROB_THRESHOLD) {
    return { action: "retry", reason: `cause=${answers.cause.choice} (p=${retryWorthyProb.toFixed(2)})`, review_suggested: reviewSuggested };
  }

  // Neither threshold cleared — ambiguous signal. Never default to retry or no_retry here.
  return { action: "escalate", reason: "no cause cleared its probability threshold", review_suggested: true };
}
