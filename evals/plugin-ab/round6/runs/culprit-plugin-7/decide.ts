// Culprit-line pointer for CI failures. Causal pointing ("which line caused this") is Jev's
// weakest measured mode (~65-67.5% accuracy at ~0.88 mean confidence), so this never auto-answers
// on its own: it pre-filters obvious candidates in code, scores each with Jev, and always produces
// a ranked shortlist. It only auto-points when the top answer is both confident and well-separated
// from the runner-up; those two thresholds are placeholders — tune them against ~30 labelled
// failures (half hard cases) with jev-eval before trusting AUTO_POINT.

export interface LogLine {
  i: number; // original line number in the last-200-line window
  text: string;
}

export interface JevRequest {
  model: "typesafe-ai/jev";
  state: { job_id: string; command: string; log_lines: LogLine[] };
  questions: Record<string, { type: "noul"; instructions: string; criteria: { true: string; false: string } }>;
}

export interface CulpritResult {
  autoPoint: LogLine | null; // set only when confident + separated enough to skip the shortlist
  shortlist: Array<LogLine & { probability: number }>; // top 3, always populated
}

// Pre-filter: most true culprit lines mention error/exception/failure vocabulary. Restricting to
// these keeps the question count (and cost) down and removes noise Jev would otherwise have to
// rank against. Falls back to the full window if the regex finds nothing, so a failure with no
// conventional vocabulary still gets scored.
const FAILURE_PATTERN = /\b(error|exception|fail(ed|ure)?|assert|panic|fatal|traceback|denied|refused)\b|exit code [1-9]/i;
const MAX_CANDIDATES = 40;

export function candidateLines(last200: LogLine[]): LogLine[] {
  const hits = last200.filter((l) => FAILURE_PATTERN.test(l.text));
  const pool = hits.length > 0 ? hits : last200;
  return pool.slice(-MAX_CANDIDATES);
}

export function buildRequest(jobId: string, command: string, last200: LogLine[]): JevRequest {
  const candidates = candidateLines(last200);
  const questions: JevRequest["questions"] = {};
  for (const line of candidates) {
    questions[`cause_${line.i}`] = {
      type: "noul",
      instructions: `Does log_lines[i=${line.i}].text directly show the reason this CI job failed — an error message, exception, stack trace frame, assertion failure, or an explicit non-zero exit/failure report — as opposed to setup, progress, or unrelated output?`,
      criteria: {
        true: "this line itself states or shows the failure",
        false: "this line is context, setup, progress, or success output",
      },
    };
  }
  return { model: "typesafe-ai/jev", state: { job_id: jobId, command, log_lines: candidates }, questions };
}

const AUTO_POINT_MIN_PROB = 0.85; // placeholder — set from a measured gate, not the confidence scalar
const AUTO_POINT_MIN_GAP = 0.15; // separation from the runner-up required to skip the shortlist

export function decide(candidates: LogLine[], answers: Record<string, { noul: number }>): CulpritResult {
  const ranked = candidates
    .map((line) => ({ ...line, probability: answers[`cause_${line.i}`]?.noul ?? 0 }))
    .sort((a, b) => b.probability - a.probability);

  const shortlist = ranked.slice(0, 3);
  const [top, second] = ranked;
  const autoPoint =
    top && top.probability >= AUTO_POINT_MIN_PROB && (!second || top.probability - second.probability >= AUTO_POINT_MIN_GAP)
      ? top
      : null;

  return { autoPoint, shortlist };
}
