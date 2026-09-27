// decide.ts — culprit-line picker for CI failure logs (last 200 lines).
//
// Pointing at which of several similar items *caused* something is Jev's
// weakest measured mode (~65-67% accuracy at ~0.88 mean confidence, the
// worst calibration in the study), regardless of how the question is
// encoded. So this never auto-answers off one soft hit: it requires both a
// high probability AND a clear margin over the runner-up, and otherwise
// returns a ranked shortlist for a developer to look at instead of guessing.
// Low confidence never gets rounded up to a single answer.

const FAILURE_PATTERN = /error|err!|fail|exception|traceback|fatal|panic/i;
const CONTEXT_LINES_AFTER = 2; // stack-trace frames usually follow the hit
const MAX_CANDIDATES = 40; // keep the request small; 200 lines rarely need more

const CAUSE_PREFIX = "is_cause_";
const HIGH_CONFIDENCE = 0.85;
const MIN_MARGIN = 0.25;
const SHORTLIST_SIZE = 3;

/**
 * Deterministic prefilter: only lines that could plausibly be the culprit
 * get a Jev question at all. This is derivation, not judgment — code decides
 * what code can settle completely, so Jev is only asked about lines a
 * developer would actually consider.
 */
export function selectCandidates(logLines: string[]): number[] {
  const hits = new Set<number>();
  logLines.forEach((line, i) => {
    if (FAILURE_PATTERN.test(line)) {
      const end = Math.min(i + CONTEXT_LINES_AFTER, logLines.length - 1);
      for (let j = i; j <= end; j++) hits.add(j);
    }
  });
  return [...hits].sort((a, b) => a - b).slice(0, MAX_CANDIDATES);
}

/**
 * Builds the questions map to send alongside `{ logLines }` as state: one
 * `noul` per candidate line, scored independently, compared with argmax in
 * code — the best-measured encoding for picking the best of several
 * candidates.
 */
export function buildQuestions(logLines: string[]) {
  const questions: Record<string, unknown> = {};
  for (const i of selectCandidates(logLines)) {
    questions[`${CAUSE_PREFIX}${i}`] = {
      type: "noul",
      instructions: `Is line ${i} of \`logLines\` the specific line that caused the CI job to fail — the direct root-cause line, not a symptom, a passing/unrelated line, or scaffolding around the failure?`,
      criteria: {
        true: `line ${i} is the direct cause of the failure`,
        false: `line ${i} is not the direct cause`,
      },
    };
  }
  return questions;
}

type NoulAnswers = Record<string, { noul: number }>;

export type Verdict =
  | { mode: "single"; index: number; line: string; confidence: number }
  | { mode: "shortlist"; candidates: { index: number; line: string; confidence: number }[] }
  | { mode: "none" };

/** Runs on the Jev answers for one job. */
export function decide(logLines: string[], answers: NoulAnswers): Verdict {
  const ranked = Object.entries(answers)
    .filter(([id]) => id.startsWith(CAUSE_PREFIX))
    .map(([id, { noul }]) => {
      const index = Number(id.slice(CAUSE_PREFIX.length));
      return { index, line: logLines[index], confidence: noul };
    })
    .sort((a, b) => b.confidence - a.confidence);

  if (ranked.length === 0) return { mode: "none" };

  const [top, runnerUp] = ranked;
  const margin = top.confidence - (runnerUp?.confidence ?? 0);

  if (top.confidence >= HIGH_CONFIDENCE && margin >= MIN_MARGIN) {
    return { mode: "single", index: top.index, line: top.line, confidence: top.confidence };
  }
  return { mode: "shortlist", candidates: ranked.slice(0, SHORTLIST_SIZE) };
}
