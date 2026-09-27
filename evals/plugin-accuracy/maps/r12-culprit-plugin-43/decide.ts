// Decision logic for the `culprit_line` question in questions.json.
// Jev's request/response shapes for a `choice` question.

type ChoiceAnswer = {
  choice: string; // a key from `criteria`, e.g. "196" or "unclear"
  confidence: number;
  probabilities: Record<string, number>;
};

type CulpritDecision =
  | { status: "auto"; line: number; text: string; probability: number }
  | { status: "review"; candidates: { line: number; text: string; probability: number }[] };

const AUTO_THRESHOLD = 0.85; // gate on the choice's probability mass, not `confidence`
const TOP_N_FOR_REVIEW = 3;

export function decideCulpritLine(
  lines: Record<string, string>,
  answer: ChoiceAnswer,
): CulpritDecision {
  const ranked = Object.entries(answer.probabilities)
    .filter(([option]) => option !== "unclear")
    .sort((a, b) => b[1] - a[1]);

  const [topOption, topProbability] = ranked[0];

  // Low confidence never relaxes into "pick anyway" — it always falls through to review.
  if (answer.choice === "unclear" || topProbability < AUTO_THRESHOLD) {
    const candidates = ranked.slice(0, TOP_N_FOR_REVIEW).map(([line, probability]) => ({
      line: Number(line),
      text: lines[line],
      probability,
    }));
    return { status: "review", candidates };
  }

  return {
    status: "auto",
    line: Number(topOption),
    text: lines[topOption],
    probability: topProbability,
  };
}

// Build `state.lines` and `questions.culprit_line.criteria` from a raw log.
// Every candidate line must get a criteria entry — an option missing from
// criteria is silently unselectable, which is a premise-in-state bug, not
// a model weakness. Do not pre-filter candidates with a regex (rule 12):
// send all 200 lines, since an unmeasured filter can drop the true culprit.
export function buildCulpritRequest(rawLastLines: string[], startLineNumber: number) {
  const lines: Record<string, string> = {};
  for (let i = 0; i < rawLastLines.length; i++) {
    const text = rawLastLines[i].trim();
    if (text.length === 0) continue; // blank lines are never the culprit; drop, don't renumber
    lines[String(startLineNumber + i)] = text;
  }

  const criteria: Record<string, string> = { ...lines };
  criteria.unclear = "no single line in `lines` states a concrete, specific cause";

  return { lines, criteria };
}
