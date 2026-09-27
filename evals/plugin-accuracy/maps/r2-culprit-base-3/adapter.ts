// Adapter between a canonical CI-failure case and questions.json / decide.ts.

import { decide as decideImpl } from "./decide";
import questionsData from "./questions.json";

type LogLine = { n: number; text: string };
type State = { jobId: string; logUrl: string; lines: LogLine[] };

export type CaseInput = {
  id?: string;
  input: {
    repo?: string;
    branch?: string;
    runner?: string;
    job_name?: string;
    attempt_number?: number;
    max_attempts?: number;
    log_tail?: string;
    log_lines: string[];
  };
};

type NoulRaw = { type: "noul"; noul: boolean };
type ChoiceRaw = { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };
type ScoreRaw = {
  type: "score";
  score: number;
  confidence: number;
  legend: Record<string, unknown>;
  probabilities: Record<string, number>;
};

export type Answers = {
  culprit: ChoiceRaw;
  isInfra: NoulRaw;
  confidence: ScoreRaw;
};

const EXAMPLE_STATE = (questionsData as any).state;
const EXAMPLE_QUESTIONS = (questionsData as any).questions;

export function buildState(input: CaseInput): State {
  const logLines = input.input.log_lines ?? [];
  const numbered: LogLine[] = logLines.map((text, i) => ({ n: i + 1, text }));
  const lines = numbered.slice(-200);

  return {
    jobId: EXAMPLE_STATE.jobId,
    logUrl: EXAMPLE_STATE.logUrl,
    lines,
  };
}

export function questions(input: CaseInput) {
  // The example's culprit options are the example log's line numbers; rebuild them from this case's
  // lines in the same {n: text} form, leaving the instructions and other questions untouched.
  const lines = buildState(input).lines;
  return {
    ...EXAMPLE_QUESTIONS,
    culprit: { ...EXAMPLE_QUESTIONS.culprit, criteria: Object.fromEntries(lines.map((l) => [String(l.n), l.text || '(blank line)'])) },
  };
}

// Picks the legend entry whose numeric side is closest to `score`; the
// legend can map score->level or level->score depending on the API version.
function levelFromScore(score: number, legend: Record<string, unknown>): string {
  const entries = Object.entries(legend ?? {});
  if (entries.length === 0) return "";

  const keysAreNumeric = entries.every(([k]) => !Number.isNaN(Number(k)));
  let best = entries[0];
  let bestDiff = Infinity;

  for (const entry of entries) {
    const numericSide = keysAreNumeric ? Number(entry[0]) : Number(entry[1]);
    const diff = Math.abs(numericSide - score);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = entry;
    }
  }

  return String(keysAreNumeric ? best[1] : best[0]);
}

export function decide(input: CaseInput, answers: Answers): { culprit_lines: number[] } {
  const state = buildState(input);

  const culprit = {
    choice: answers.culprit.choice,
    confidence: answers.culprit.confidence,
    probabilities: answers.culprit.probabilities,
  };
  const isInfra = {
    probability: Number(answers.isInfra.noul),
  };
  const confidence = {
    level: levelFromScore(answers.confidence.score, answers.confidence.legend),
  };

  const decision = decideImpl(state, { culprit, isInfra, confidence });

  if (decision.action === "manual-triage") {
    return { culprit_lines: [] };
  }

  return { culprit_lines: [decision.line - 1] };
}
