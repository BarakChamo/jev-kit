type Label = "consistent" | "contradicts" | "unrelated";

interface ChoiceAnswer {
  choice: Label;
  confidence: number;
  probabilities: Record<Label, number>;
}

type Action = "keep" | "drop_stale" | "review";

interface Decision {
  passageId: string;
  action: Action;
  reason: string;
}

// Gate on P(contradicts), not the confidence scalar (it under-reports by up to
// ~29 points). Below FLAG_MARGIN between the top two labels, treat the passage
// as unresolved rather than trusting the top choice either way.
const FLAG_THRESHOLD = 0.7;
const FLAG_MARGIN = 0.15;

function decidePassage(passageId: string, answer: ChoiceAnswer): Decision {
  const probs = answer.probabilities;
  const pContradicts = probs.contradicts ?? 0;

  if (pContradicts >= FLAG_THRESHOLD) {
    return {
      passageId,
      action: "drop_stale",
      reason: `P(contradicts)=${pContradicts.toFixed(2)}`,
    };
  }

  const sorted = Object.values(probs).sort((a, b) => b - a);
  const margin = sorted[0] - (sorted[1] ?? 0);
  if (margin < FLAG_MARGIN) {
    // Unsure whether it's stale or just irrelevant — never let uncertainty
    // default to "keep".
    return {
      passageId,
      action: "review",
      reason: `ambiguous: top margin ${margin.toFixed(2)} (${answer.choice})`,
    };
  }

  // Confidently "consistent" or "unrelated": safe to pass through. An
  // unrelated passage is a retrieval-quality issue, not a staleness one, so
  // it isn't flagged here.
  return {
    passageId,
    action: "keep",
    reason: `${answer.choice} (confident)`,
  };
}

export function decideAll(
  answers: Record<string, ChoiceAnswer>
): Decision[] {
  return Object.entries(answers).map(([id, answer]) => decidePassage(id, answer));
}

// Passages reaching the generator: everything except drop_stale/review.
export function filterForGenerator(
  passages: { id: string; text: string }[],
  decisions: Decision[]
): { id: string; text: string }[] {
  const keep = new Set(
    decisions.filter((d) => d.action === "keep").map((d) => d.passageId)
  );
  return passages.filter((p) => keep.has(p.id));
}
