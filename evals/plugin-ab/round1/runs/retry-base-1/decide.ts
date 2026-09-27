// Decision logic for CI job retries, driven by answers from questions.json.

interface JobState {
  repo: string;
  branch: string;
  runner: string;
  attempt: number;
  maxAttempts: number;
  logTail: string[];
}

interface NoulAnswer {
  probability: number; // P(criteria.true)
}

interface ChoiceAnswer {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

interface ScoreAnswer {
  level: string; // one of the criteria levels, e.g. "unlikely"
}

interface JevAnswers {
  transient: NoulAnswer;
  category: ChoiceAnswer;
  retrySuccessLikelihood: ScoreAnswer;
}

const SCORE_LEVELS = ["very_unlikely", "unlikely", "uncertain", "likely", "very_likely"] as const;
type ScoreLevel = (typeof SCORE_LEVELS)[number];

const RETRY_CATEGORIES = new Set(["infra_transient", "flaky_test"]);
const NO_RETRY_CATEGORIES = new Set(["code_defect"]);

export interface RetryDecision {
  retry: boolean;
  reason: string;
}

export function decide(state: JobState, answers: JevAnswers): RetryDecision {
  if (state.attempt >= state.maxAttempts) {
    return { retry: false, reason: `Exhausted attempts (${state.attempt}/${state.maxAttempts}).` };
  }

  const { transient, category, retrySuccessLikelihood } = answers;
  const scoreIndex = SCORE_LEVELS.indexOf(retrySuccessLikelihood.level as ScoreLevel);

  // High-confidence code defect: retrying wastes CI time regardless of other signals.
  if (NO_RETRY_CATEGORIES.has(category.choice) && category.confidence >= 0.6) {
    return {
      retry: false,
      reason: `Classified as ${category.choice} with confidence ${category.confidence.toFixed(2)}; retry would reproduce the same failure.`,
    };
  }

  // Strong transient/flaky signal with a favorable success estimate: retry.
  if (
    RETRY_CATEGORIES.has(category.choice) &&
    transient.probability >= 0.6 &&
    scoreIndex >= SCORE_LEVELS.indexOf("likely")
  ) {
    return {
      retry: true,
      reason: `Classified as ${category.choice} (transient=${transient.probability.toFixed(2)}), retry success rated "${retrySuccessLikelihood.level}".`,
    };
  }

  // Weak/ambiguous signals: fall back to a blended threshold.
  const blended = 0.5 * transient.probability + 0.5 * (scoreIndex / (SCORE_LEVELS.length - 1));
  if (blended >= 0.55) {
    return {
      retry: true,
      reason: `Blended transient/success score ${blended.toFixed(2)} >= 0.55 (category=${category.choice}).`,
    };
  }

  return {
    retry: false,
    reason: `Blended transient/success score ${blended.toFixed(2)} < 0.55 (category=${category.choice}, transient=${transient.probability.toFixed(2)}).`,
  };
}
