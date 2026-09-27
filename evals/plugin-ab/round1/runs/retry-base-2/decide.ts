// Decision logic applied to the answers returned for questions.json.
// Does not call the Jev API itself — just interprets the response.

type NoulAnswer = { probability: number };
type ChoiceAnswer<C extends string> = {
  choice: C;
  confidence: number;
  probabilities: Record<C, number>;
};
type ScoreAnswer<L extends string> = { level: L };

type FailureCategory =
  | "infra_flake"
  | "test_flake"
  | "code_defect"
  | "dependency_or_config"
  | "unknown";

type RetryValue = "none" | "low" | "medium" | "high";

interface JevAnswers {
  is_transient: NoulAnswer;
  failure_category: ChoiceAnswer<FailureCategory>;
  retry_value: ScoreAnswer<RetryValue>;
}

interface JobMeta {
  attempt: number;
  maxAttempts: number;
}

export interface Decision {
  retry: boolean;
  reason: string;
}

const RETRY_VALUE_RANK: Record<RetryValue, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const RETRIABLE_CATEGORIES: ReadonlySet<FailureCategory> = new Set([
  "infra_flake",
  "test_flake",
]);

const TRANSIENT_PROBABILITY_THRESHOLD = 0.6;
const MIN_RETRY_VALUE: RetryValue = "medium";
const CHOICE_CONFIDENCE_FLOOR = 0.5;

export function decideRetry(job: JobMeta, answers: JevAnswers): Decision {
  if (job.attempt >= job.maxAttempts) {
    return { retry: false, reason: "max attempts reached" };
  }

  const { is_transient, failure_category, retry_value } = answers;

  if (is_transient.probability < TRANSIENT_PROBABILITY_THRESHOLD) {
    return {
      retry: false,
      reason: `failure looks deterministic (transient probability ${is_transient.probability.toFixed(2)})`,
    };
  }

  const categoryIsRetriable = RETRIABLE_CATEGORIES.has(failure_category.choice);
  const categoryConfident = failure_category.confidence >= CHOICE_CONFIDENCE_FLOOR;
  if (!categoryIsRetriable || !categoryConfident) {
    return {
      retry: false,
      reason: `failure category '${failure_category.choice}' (confidence ${failure_category.confidence.toFixed(2)}) not retriable`,
    };
  }

  if (RETRY_VALUE_RANK[retry_value.level] < RETRY_VALUE_RANK[MIN_RETRY_VALUE]) {
    return { retry: false, reason: `retry value too low ('${retry_value.level}')` };
  }

  return {
    retry: true,
    reason: `transient (${is_transient.probability.toFixed(2)}), category=${failure_category.choice}, retry_value=${retry_value.level}`,
  };
}
