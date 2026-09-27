// Culprit-line pointer for CI failures. Runs on the last 200 log lines of a failed job.
//
// NOTE ON FIT: pointing at which of several similar lines *caused* a failure is the weakest
// measured Jev pattern (65-67.5% accuracy at ~0.88 mean confidence, across every encoding tried).
// So this never auto-answers. It narrows 200 lines to a handful of candidates with cheap
// heuristics, asks Jev one noul per candidate in a single parallel pass, and only ever emits
// either a single confident+separated pick or a ranked shortlist for the developer to glance at.
// Do not wire this to auto-close, auto-triage, or auto-assign without a measured gate (jev-eval).

interface JevNoulAnswer {
  noul: number; // P(true), calibrated
}

type JevAnswers = Record<string, JevNoulAnswer>;

interface Question {
  type: "noul";
  instructions: string;
  criteria: { true: string; false: string };
}

// Lines that plausibly name a cause rather than being routine pass/summary/retry noise.
const CANDIDATE_PATTERNS = [
  /error/i,
  /exception/i,
  /assert(ion)?/i,
  /fail(ed|ure)?/i,
  /panic/i,
  /traceback/i,
  /\bexit code [1-9]\d*/i,
  /timed? ?out/i,
  /\bnon-zero\b/i,
  /^\s*at\s+\S+\s*\(.*:\d+:\d+\)/, // stack frame
];

const MAX_CANDIDATES = 30; // keep the request cheap; noul has no 255-option ceiling but there's no reason to ask about 200 lines
const CONFIDENT_P = 0.75; // gate on the noul probability itself, not a confidence scalar
const MIN_MARGIN = 0.2; // top vs runner-up must be clearly separated to call a single line

export function selectCandidates(logLines: string[]): number[] {
  const indices = logLines
    .map((line, i) => ({ i, line }))
    .filter(({ line }) => CANDIDATE_PATTERNS.some((re) => re.test(line)))
    .map(({ i }) => i);

  // Nothing matched (unusual log format) — fall back to the last N lines, which is where
  // most CI runners print the actual failure right before exiting.
  if (indices.length === 0) {
    return logLines.map((_, i) => i).slice(-MAX_CANDIDATES);
  }
  return indices.slice(-MAX_CANDIDATES);
}

export function buildQuestions(logLines: string[], candidates: number[]): Record<string, Question> {
  const questions: Record<string, Question> = {};
  for (const i of candidates) {
    const text = logLines[i];
    questions[`cause_${i}`] = {
      type: "noul",
      instructions:
        `In state.log_lines, does line index ${i} ("${text}") name the specific error, ` +
        `exception, or assertion that caused the CI job to fail, as opposed to being a ` +
        `symptom, a retry, a summary count, or unrelated output?`,
      criteria: {
        true: `line ${i} states the specific failing assertion/exception/command`,
        false: `line ${i} is context, a downstream symptom, a retry notice, a summary, or generic noise`,
      },
    };
  }
  return questions;
}

export interface CulpritResult {
  logLines: string[];
  // Present only when the top pick is confident AND clearly separated from the runner-up.
  singleCulprit?: { index: number; line: string; probability: number };
  // Always present: top-3 by probability, for a developer to scan when there's no clean single pick.
  shortlist: { index: number; line: string; probability: number }[];
}

export function decide(logLines: string[], candidates: number[], answers: JevAnswers): CulpritResult {
  const scored = candidates
    .map((i) => ({ index: i, line: logLines[i], probability: answers[`cause_${i}`]?.noul ?? 0 }))
    .sort((a, b) => b.probability - a.probability);

  const shortlist = scored.slice(0, 3);
  const [top, runnerUp] = scored;

  const singleCulprit =
    top && top.probability >= CONFIDENT_P && (!runnerUp || top.probability - runnerUp.probability >= MIN_MARGIN)
      ? top
      : undefined;

  return { logLines, singleCulprit, shortlist };
}

// Entry point: caller supplies the last 200 lines, gets back the question map to send to Jev
// plus the candidate index list to pass into decide() once answers come back.
export function prepare(logLines: string[]) {
  const candidates = selectCandidates(logLines);
  return { candidates, questions: buildQuestions(logLines, candidates) };
}
