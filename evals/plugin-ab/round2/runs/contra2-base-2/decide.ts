// Turns Jev's answers to questions.json into flags on retrieved passages,
// before they reach the generator.

type ChoiceAnswer = {
  choice: "consistent" | "outdated" | "contradicts" | "unrelated";
  confidence: number; // 0-1
  probabilities: Record<string, number>;
};

type ScoreAnswer = {
  level: "none" | "minor" | "moderate" | "severe";
};

type JevAnswers = Record<string, ChoiceAnswer | ScoreAnswer>;

type Passage = { id: string; source: string; text: string };

export type PassageVerdict = {
  id: string;
  source: string;
  text: string;
  status: ChoiceAnswer["choice"];
  severity: ScoreAnswer["level"];
  confidence: number;
  flagged: boolean; // exclude/warn: passage is wrong vs. the CMS canonical answer
  excluded: boolean; // exclude only: passage isn't actually about this FAQ
  reason: string;
};

const CONFIDENCE_THRESHOLD = 0.6;
// A "severe" call is trusted even at lower confidence, since the cost of
// missing a badly wrong passage outweighs the cost of a false positive.
const SEVERE_CONFIDENCE_THRESHOLD = 0.4;

export function decide(
  passages: Passage[],
  answers: JevAnswers
): PassageVerdict[] {
  return passages.map((p) => {
    const status = answers[`${p.id}_status`] as ChoiceAnswer;
    const severity = (answers[`${p.id}_severity`] as ScoreAnswer).level;

    const isStale = status.choice === "outdated" || status.choice === "contradicts";
    const threshold =
      severity === "severe" ? SEVERE_CONFIDENCE_THRESHOLD : CONFIDENCE_THRESHOLD;
    const flagged = isStale && status.confidence >= threshold;
    const excluded = status.choice === "unrelated" && status.confidence >= CONFIDENCE_THRESHOLD;

    return {
      id: p.id,
      source: p.source,
      text: p.text,
      status: status.choice,
      severity,
      confidence: status.confidence,
      flagged,
      excluded,
      reason: flagged
        ? `${status.choice} vs. CMS canonical answer (severity: ${severity})`
        : excluded
          ? "not relevant to the matched FAQ"
          : "consistent with CMS canonical answer",
    };
  });
}

// What the generator should actually see: drop wrong/irrelevant passages,
// and keep the rest as-is.
export function filterForGenerator(verdicts: PassageVerdict[]): Passage[] {
  return verdicts
    .filter((v) => !v.flagged && !v.excluded)
    .map(({ id, source, text }) => ({ id, source, text }));
}

// What support ops should see: passages worth fixing/removing in the CMS,
// most severe first.
export function flaggedForReview(verdicts: PassageVerdict[]): PassageVerdict[] {
  const severityOrder = { severe: 0, moderate: 1, minor: 2, none: 3 };
  return verdicts
    .filter((v) => v.flagged)
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}
