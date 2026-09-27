// Turns a Jev response (answers to the questions.json questions map) into a
// moderation decision. Pure post-processing — no API calls here.

type NoulAnswer = { type: "noul"; probability: number };
type ChoiceAnswer = { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };
type ScoreAnswer = { type: "score"; level: string };
type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export type JevAnswers = Record<string, Answer>;

export type Decision = {
  action: "allow" | "escalate" | "remove" | "report";
  reasons: string[];
};

// Probability at/above which a noul question counts as a violation.
// Zero-tolerance categories (e.g. CSAM) get a much lower bar than judgment
// calls (e.g. spam), because a false positive there is cheap to review but a
// false negative is not.
const NOUL_THRESHOLDS: Record<string, number> = {
  hate_speech: 0.85,
  violence_threat: 0.8,
  sexual_content_minors: 0.3,
  self_harm_content: 0.7,
  spam_or_scam: 0.9,
};

const SEVERITY_ORDER = ["none", "low", "medium", "high", "critical"];

export function decide(answers: JevAnswers): Decision {
  const reasons: string[] = [];

  // Zero-tolerance: any real signal on minors + sexual content skips
  // straight to report, independent of everything else.
  const csam = answers.sexual_content_minors as NoulAnswer | undefined;
  if (csam && csam.probability >= NOUL_THRESHOLDS.sexual_content_minors) {
    return { action: "report", reasons: ["sexual_content_minors"] };
  }

  const violations = Object.entries(NOUL_THRESHOLDS)
    .filter(([id]) => id !== "sexual_content_minors")
    .filter(([id, threshold]) => {
      const a = answers[id] as NoulAnswer | undefined;
      return a && a.probability >= threshold;
    })
    .map(([id]) => id);
  reasons.push(...violations);

  if (violations.length === 0) {
    return { action: "allow", reasons: [] };
  }

  const severity = (answers.severity as ScoreAnswer | undefined)?.level;
  const severityRank = severity ? SEVERITY_ORDER.indexOf(severity) : -1;

  if (severityRank >= SEVERITY_ORDER.indexOf("high")) {
    return { action: "remove", reasons };
  }

  // Violated something, but not severe enough to auto-remove: send to a
  // human rather than guess.
  return { action: "escalate", reasons };
}
