// Turns the Jev "culprit_line" answer into an action: auto-point, or hand a
// developer the top 2-3 candidates. Threshold below is a starting point —
// tune it against labelled cases (jev-eval) before trusting it in prod.

interface ChoiceAnswer {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

interface JevResponse {
  answers: {
    culprit_line: ChoiceAnswer;
  };
}

interface LogLine {
  number: number;
  text: string;
}

export type Decision =
  | { kind: "point"; line: LogLine; probability: number }
  | { kind: "review"; candidates: Array<{ line: LogLine; probability: number }> }
  | { kind: "no_culprit_line" };

// Gate on the probability of the chosen label, not the `confidence` scalar
// (the scalar under-reports by up to ~29 points; the distribution is calibrated).
const AUTO_POINT_THRESHOLD = 0.7;
const TOP_N_FOR_REVIEW = 3;

export function decide(response: JevResponse, logLines: LogLine[]): Decision {
  const { choice, probabilities } = response.answers.culprit_line;

  if (choice === "none_identifiable") {
    return { kind: "no_culprit_line" };
  }

  const byLineNumber = new Map(logLines.map((l) => [String(l.number), l]));
  const rank = Object.entries(probabilities)
    .filter(([key]) => key !== "none_identifiable")
    .sort((a, b) => b[1] - a[1]);

  const top = rank[0];
  if (top && top[0] === choice && top[1] >= AUTO_POINT_THRESHOLD) {
    const line = byLineNumber.get(choice);
    if (line) return { kind: "point", line, probability: top[1] };
  }

  // Low confidence: don't auto-point at a near-identical error line, show the
  // shortlist instead (per jev-questions: showing top labels recovers 12-25
  // points of recall where a human decides).
  const candidates = rank
    .slice(0, TOP_N_FOR_REVIEW)
    .map(([key, probability]) => ({ line: byLineNumber.get(key)!, probability }))
    .filter((c) => c.line);

  return { kind: "review", candidates };
}
