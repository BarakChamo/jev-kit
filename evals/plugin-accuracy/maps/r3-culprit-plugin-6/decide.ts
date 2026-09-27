// Culprit-line finder for CI failures.
//
// Causal pointing ("which of these lines caused it") is Jev's weakest measured
// mode: 65-67.5% accuracy at ~0.88 mean confidence, the worst calibration in
// the study. So this never emits a single verdict. It always returns a ranked
// shortlist (top 3) for a human, plus an explicit confidence gate on top of
// the raw probabilities -- never the `confidence` scalar alone. Measure
// against ~30 labelled failures (jev-eval) before trusting the thresholds
// below; they're starting points, not tuned values.

const MAX_CANDIDATES = 25; // keep the request cheap: one Jev call per job either way (rule: one long state, many scoped questions)

// Heuristic pre-filter: only lines that plausibly carry error signal become
// candidates. Jev still sees the full log for context (rule 1: the premise
// goes in the state), it's just not asked to score every line individually.
const CANDIDATE_PATTERN =
  /error|exception|fail(?!ed all)|expected:|received:|traceback|panic:|##\[error\]|npm err!|\bat .*:\d+:\d+\)?$/i;

export interface LogLine {
  index: number;
  text: string;
}

export interface Candidate extends LogLine {}

export function selectCandidates(logLines: string[]): Candidate[] {
  const hits = logLines
    .map((text, index) => ({ index, text }))
    .filter(({ text }) => CANDIDATE_PATTERN.test(text) && !/^PASS /.test(text.trim()));
  return hits.slice(0, MAX_CANDIDATES);
}

export function buildQuestions(candidates: Candidate[]) {
  const questions: Record<string, unknown> = {};
  for (const { index } of candidates) {
    questions[`cause_${index}`] = {
      type: "noul",
      instructions: `In \`log_lines\`, is the line at index ${index} in \`candidates\` the specific line whose content is the origin of the CI job failure (the actual error, exception, or assertion output), as opposed to a related passing test, a context line, or a generic summary/exit line?`,
      criteria: {
        true: `line ${index} is the origin of the failure`,
        false: `line ${index} is not the origin of the failure`,
      },
    };
  }
  questions["no_candidate_is_root_cause"] = {
    type: "noul",
    instructions:
      "Considering all of `log_lines`, is it likely that the true root cause of the failure is not represented by any single line in `candidates` — for example because it appears earlier in `log_lines` outside `candidates`, or is not present in the last 200 lines at all?",
    criteria: {
      true: "no listed candidate is the root cause",
      false: "the root cause is represented by one of the candidates",
    },
  };
  return questions;
}

export type NoulAnswers = Record<string, { noul: number }>;

export interface ShortlistItem {
  index: number;
  text: string;
  probability: number;
}

export interface CulpritResult {
  jobId: string;
  shortlist: ShortlistItem[]; // top 3, always present when there are candidates — never a single "the" answer
  confident: boolean; // gate: only a UI hint to sort/badge the top item, never to hide the others
  likelyOutsideCandidates: boolean;
  note?: string;
}

// Gate thresholds: tune against labelled cases, not by feel.
const TOP_PROB_GATE = 0.75;
const MARGIN_GATE = 0.2; // top1 - top2
const ABSTAIN_GATE = 0.6; // no_candidate_is_root_cause

export function decide(
  jobId: string,
  candidates: Candidate[],
  answers: NoulAnswers
): CulpritResult {
  const ranked = candidates
    .map((c) => ({
      index: c.index,
      text: c.text,
      probability: answers[`cause_${c.index}`]?.noul ?? 0,
    }))
    .sort((a, b) => b.probability - a.probability);

  const shortlist = ranked.slice(0, 3);
  const [top1, top2] = ranked;
  const likelyOutsideCandidates =
    (answers["no_candidate_is_root_cause"]?.noul ?? 0) >= ABSTAIN_GATE;

  const confident =
    !likelyOutsideCandidates &&
    !!top1 &&
    top1.probability >= TOP_PROB_GATE &&
    (top1.probability - (top2?.probability ?? 0)) >= MARGIN_GATE;

  return {
    jobId,
    shortlist,
    confident,
    likelyOutsideCandidates,
    note: likelyOutsideCandidates
      ? "Jev flagged that the root cause is probably not among the highlighted lines — check the full log."
      : confident
      ? undefined
      : "Low confidence / no clear margin between top candidates — treat as a shortlist to check, not an answer.",
  };
}

// Wiring for one CI job:
//   const candidates = selectCandidates(last200Lines);
//   const questions = buildQuestions(candidates);
//   const { answers } = await callJev({ job_id, log_lines: last200Lines, candidates }, questions);
//   const result = decide(job_id, candidates, answers);
//   // Surface result.shortlist (top 2-3, with probabilities) in the CI UI / PR comment.
//   // Never auto-close or auto-triage on result.confident alone -- it's a display hint.
