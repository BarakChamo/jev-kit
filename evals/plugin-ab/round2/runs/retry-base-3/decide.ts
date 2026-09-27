// Decision logic that runs on the answers to questions.json. Does not call Jev itself.

type FailureCategory =
  | "infra"
  | "flaky_test"
  | "dependency"
  | "code_defect"
  | "config"
  | "unknown";

type RetryConfidenceLevel =
  | "very_unlikely"
  | "unlikely"
  | "possible"
  | "likely"
  | "very_likely";

const RETRY_CONFIDENCE_LEVELS: RetryConfidenceLevel[] = [
  "very_unlikely",
  "unlikely",
  "possible",
  "likely",
  "very_likely",
];

interface JobMeta {
  repo: string;
  branch: string;
  runner: string;
  attempt: number;
  maxAttempts: number;
}

// Shapes returned by Jev per question type, per the API description:
// noul -> a probability; choice -> choice + confidence + probabilities; score -> an ordered level.
interface NoulAnswer {
  probability: number; // 0..1, P(criteria.true)
}

interface ChoiceAnswer<T extends string> {
  choice: T;
  confidence: number; // 0..1
  probabilities: Record<T, number>;
}

interface ScoreAnswer<T extends string> {
  level: T;
}

interface JevAnswers {
  transient_failure: NoulAnswer;
  failure_category: ChoiceAnswer<FailureCategory>;
  retry_confidence: ScoreAnswer<RetryConfidenceLevel>;
}

export interface RetryDecision {
  retry: boolean;
  reason: string;
  delaySeconds?: number;
}

const PROTECTED_BRANCHES = new Set(["main", "master", "release"]);
const DETERMINISTIC_CONFIDENCE_THRESHOLD = 0.6;
const RETRY_SCORE_THRESHOLD = 0.55;
const PROTECTED_RETRY_SCORE_THRESHOLD = 0.65;

function levelToUnit(level: RetryConfidenceLevel): number {
  const idx = RETRY_CONFIDENCE_LEVELS.indexOf(level);
  return idx / (RETRY_CONFIDENCE_LEVELS.length - 1);
}

function backoffSeconds(attempt: number): number {
  return Math.min(60 * 2 ** (attempt - 1), 900);
}

export function decideRetry(job: JobMeta, answers: JevAnswers): RetryDecision {
  if (job.attempt >= job.maxAttempts) {
    return { retry: false, reason: `Max attempts reached (${job.attempt}/${job.maxAttempts}).` };
  }

  const { transient_failure, failure_category, retry_confidence } = answers;

  // Deterministic failures won't be fixed by retrying, regardless of transience score.
  if (
    (failure_category.choice === "code_defect" || failure_category.choice === "config") &&
    failure_category.confidence >= DETERMINISTIC_CONFIDENCE_THRESHOLD
  ) {
    return {
      retry: false,
      reason: `Classified as ${failure_category.choice} with confidence ${failure_category.confidence.toFixed(2)}; retry won't help.`,
    };
  }

  const combinedScore =
    0.5 * transient_failure.probability + 0.5 * levelToUnit(retry_confidence.level);

  const threshold = PROTECTED_BRANCHES.has(job.branch)
    ? PROTECTED_RETRY_SCORE_THRESHOLD
    : RETRY_SCORE_THRESHOLD;

  const retry = combinedScore >= threshold;

  return {
    retry,
    reason: retry
      ? `${failure_category.choice} failure, combined retry score ${combinedScore.toFixed(2)} >= ${threshold}.`
      : `${failure_category.choice} failure, combined retry score ${combinedScore.toFixed(2)} < ${threshold}.`,
    ...(retry ? { delaySeconds: backoffSeconds(job.attempt) } : {}),
  };
}
