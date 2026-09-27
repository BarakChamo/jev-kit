// Turns a Jev response for questions.json into a routing decision for a CI failure.

type LogLine = { n: number; text: string };
type State = { jobId: string; logUrl: string; lines: LogLine[] };

type ChoiceAnswer = { choice: string; confidence: number; probabilities: Record<string, number> };
type NoulAnswer = { probability: number };
type ScoreAnswer = { level: string };

type JevAnswers = {
  culprit: ChoiceAnswer;
  isInfra: NoulAnswer;
  confidence: ScoreAnswer;
};

export type Decision =
  | { action: "point-developer"; line: number; text: string; link: string; reason: string }
  | { action: "flag-flake"; line: number; text: string; link: string; reason: string }
  | { action: "manual-triage"; reason: string };

// Thresholds tuned for "thousands of failures a day": err toward manual-triage
// rather than pointing a developer at the wrong line.
const MIN_CHOICE_CONFIDENCE = 0.5;
const INFRA_PROBABILITY_THRESHOLD = 0.65;
const LOW_CONFIDENCE_LEVELS = new Set(["low"]);

export function decide(state: State, answers: JevAnswers): Decision {
  const { culprit, isInfra, confidence } = answers;

  if (LOW_CONFIDENCE_LEVELS.has(confidence.level) || culprit.confidence < MIN_CHOICE_CONFIDENCE) {
    return {
      action: "manual-triage",
      reason: `Jev confidence too low (choice=${culprit.confidence.toFixed(2)}, level=${confidence.level}) to trust a single line.`,
    };
  }

  const lineNumber = Number(culprit.choice);
  const line = state.lines.find((l) => l.n === lineNumber);
  if (!line) {
    return { action: "manual-triage", reason: `Jev picked line ${culprit.choice}, not found in state.lines.` };
  }
  const link = `${state.logUrl}#L${line.n}`;

  if (isInfra.probability >= INFRA_PROBABILITY_THRESHOLD) {
    return {
      action: "flag-flake",
      line: line.n,
      text: line.text,
      link,
      reason: `Likely infra/flake (p=${isInfra.probability.toFixed(2)}); suggest retry instead of assigning to a developer.`,
    };
  }

  return {
    action: "point-developer",
    line: line.n,
    text: line.text,
    link,
    reason: `Root-cause line (choice confidence=${culprit.confidence.toFixed(2)}, overall=${confidence.level}).`,
  };
}
