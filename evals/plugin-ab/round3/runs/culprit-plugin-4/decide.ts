// Points a dev at the likely cause of a CI failure from Jev's answers to questions.json.
//
// Causal pointing ("which line caused this") is Jev's weakest measured mode: 65-67.5% accuracy
// at ~0.88 mean confidence, across every encoding tried. Two mitigations, both applied here:
//   1. Never auto-answer with a single line. Surface a ranked shortlist; a human confirms.
//   2. Gate separately on `is_infra_flake` (a reliable yes/no flag) before trusting the pointer
//      at all, since a flaky/infra failure has no single causal line to find.
//
// CONFIDENT_TOP1 is a placeholder. Calibrate it against ~30 labelled (job, true culprit line)
// pairs via jev-eval before relying on the "confident" bucket for anything more than sort order.

interface ChoiceAnswer {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

interface NoulAnswer {
  noul: number;
}

interface JevAnswers {
  culprit_line: ChoiceAnswer;
  is_infra_flake: NoulAnswer;
}

interface LogLine {
  i: number;
  text: string;
}

const INFRA_FLAKE_THRESHOLD = 0.75;
const CONFIDENT_TOP1 = 0.6; // TODO: calibrate via jev-eval, do not trust as-is
const SHORTLIST_SIZE = 3;

export type Verdict =
  | { mode: "infra_flake"; note: string }
  | { mode: "unclear"; note: string }
  | { mode: "confident"; primary: LogLine; shortlist: LogLine[] }
  | { mode: "shortlist"; shortlist: LogLine[] };

export function decide(answers: JevAnswers, logLines: LogLine[]): Verdict {
  const byIndex = new Map(logLines.map((l) => [String(l.i), l]));

  if (answers.is_infra_flake.noul >= INFRA_FLAKE_THRESHOLD) {
    return {
      mode: "infra_flake",
      note: "Looks like an infrastructure/environment failure, not a code defect. Suggest retry rather than pointing at a line.",
    };
  }

  const ranked = Object.entries(answers.culprit_line.probabilities)
    .filter(([option]) => option !== "0" && byIndex.has(option))
    .sort(([, a], [, b]) => b - a)
    .slice(0, SHORTLIST_SIZE)
    .map(([option]) => byIndex.get(option)!);

  const abstainProb = answers.culprit_line.probabilities["0"] ?? 0;
  const top1Prob = Object.values(answers.culprit_line.probabilities).length
    ? Math.max(...Object.values(answers.culprit_line.probabilities))
    : 0;

  if (ranked.length === 0 || abstainProb >= top1Prob) {
    return {
      mode: "unclear",
      note: "No single log line stands out as the cause. Route to a human for triage.",
    };
  }

  if (top1Prob >= CONFIDENT_TOP1) {
    return { mode: "confident", primary: ranked[0], shortlist: ranked };
  }

  return { mode: "shortlist", shortlist: ranked };
}
