// Decision logic applied to Jev's answers for questions.json.
// Call the API yourself; this only consumes the response.

interface JobState {
  repo: string;
  branch: string;
  runner: string;
  job_name: string;
  attempt: number;
  max_attempts: number;
  log_tail: string[];
}

interface NoulAnswer {
  probability: number; // P(criteria.true)
}

interface ChoiceAnswer {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

type RetryValueLevel =
  | "not_worth_retrying"
  | "low_value"
  | "moderate_value"
  | "high_value";

interface ScoreAnswer {
  level: RetryValueLevel;
}

interface JevAnswers {
  is_transient: NoulAnswer;
  failure_category: ChoiceAnswer;
  retry_value: ScoreAnswer;
}

export interface RetryDecision {
  retry: boolean;
  reason: string;
}

const RETRY_VALUE_RANK: Record<RetryValueLevel, number> = {
  not_worth_retrying: 0,
  low_value: 1,
  moderate_value: 2,
  high_value: 3,
};

const TRANSIENT_THRESHOLD = 0.6;
const HIGH_CONFIDENCE_TRANSIENT_THRESHOLD = 0.85;
const MIN_RETRY_VALUE = RETRY_VALUE_RANK.moderate_value;
const CODE_DEFECT_CONFIDENCE_THRESHOLD = 0.5;

export function decideRetry(state: JobState, answers: JevAnswers): RetryDecision {
  if (state.attempt >= state.max_attempts) {
    return { retry: false, reason: "max_attempts_reached" };
  }

  const { is_transient, failure_category, retry_value } = answers;

  const confidentCodeDefect =
    failure_category.choice === "code_defect" &&
    failure_category.confidence >= CODE_DEFECT_CONFIDENCE_THRESHOLD;

  if (confidentCodeDefect) {
    return { retry: false, reason: "confident_code_defect" };
  }

  // Strong transience signal alone is enough, regardless of the score.
  if (is_transient.probability >= HIGH_CONFIDENCE_TRANSIENT_THRESHOLD) {
    return { retry: true, reason: "high_confidence_transient" };
  }

  const transient = is_transient.probability >= TRANSIENT_THRESHOLD;
  const valuable = RETRY_VALUE_RANK[retry_value.level] >= MIN_RETRY_VALUE;

  if (transient && valuable) {
    return { retry: true, reason: "transient_and_valuable" };
  }

  return { retry: false, reason: "insufficient_evidence" };
}
