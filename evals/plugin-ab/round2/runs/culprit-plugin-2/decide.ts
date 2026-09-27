// CI culprit-line lookup: pick the last-200-line window's single root-cause line.
// Candidates are pre-filtered in code (cheap, reliable) so Jev only scores lines
// that plausibly matter, one `noul` each, plus one abstain `noul` (see questions.json).

export interface LogLine {
  i: number;
  text: string;
}

export interface State {
  job_id: string;
  repo: string;
  step: string;
  lines: LogLine[];
  candidate_indices: number[];
}

const FAILURE_SIGNAL =
  /\b(error|exception|fail(?:ed|ure)?|panic|traceback|fatal|denied|refused|time(?:d)?\s*out|assert(?:ion)?|cannot|could not|segmentation fault|core dumped)\b/i;
const EXIT_CODE = /exit(?:ed)?\s+(?:with\s+)?code\s+[1-9]/i;

const MAX_CANDIDATES = 50;
const TAIL_LINES = 5;

// Deriving "is this a candidate" from keyword matching is a cheap, individually
// reliable filter (rule 6); it is NOT the root-cause judgment itself, which stays
// with Jev because it requires weighing candidates against each other.
export function selectCandidates(lines: LogLine[]): number[] {
  const flagged = lines
    .filter((l) => FAILURE_SIGNAL.test(l.text) || EXIT_CODE.test(l.text))
    .map((l) => l.i);
  const tail = lines.slice(-TAIL_LINES).map((l) => l.i);
  const merged = Array.from(new Set([...flagged, ...tail])).sort((a, b) => a - b);
  // If pre-filtering still leaves too many, keep the most recent ones: root causes
  // that predate them would usually also re-trigger a later, tail-adjacent symptom.
  return merged.length <= MAX_CANDIDATES ? merged : merged.slice(-MAX_CANDIDATES);
}

export function buildQuestions(candidateIndices: number[]): Record<string, unknown> {
  const questions: Record<string, unknown> = {};
  for (const i of candidateIndices) {
    questions[`line_${i}`] = {
      type: "noul",
      instructions: `In state.lines, is the log line at index ${i} the single line that most directly reveals the underlying cause of this CI job's failure, as opposed to a downstream symptom, an unrelated warning, retry/informational output, or a generic "exited with code" message?`,
      criteria: {
        true: "this line is the root-cause line",
        false: "this line is not the root-cause line",
      },
    };
  }
  questions["no_clear_culprit"] = {
    type: "noul",
    instructions:
      "Considering all lines listed in state.candidate_indices together, is it true that none of them alone clearly reveals the cause of the failure, because the real cause requires combining multiple lines or is not present in this log at all?",
    criteria: {
      true: "no single candidate line explains the failure",
      false: "at least one candidate line clearly explains the failure",
    },
  };
  return questions;
}

export type Answers = Record<string, { noul: number }>;

export interface ScoredLine {
  line: number;
  text: string;
  probability: number;
}

export interface Decision {
  status: "resolved" | "ambiguous" | "no_candidates";
  culpritLine?: number;
  culpritText?: string;
  probability?: number;
  // Always populated on resolved/ambiguous so a human is shown the runner-up too
  // (the truth is the second choice 67-100% of the time when the top pick is wrong).
  topCandidates: ScoredLine[];
}

const CONFIDENCE_THRESHOLD = 0.6; // gate on the noul probability itself, not a confidence scalar
const AMBIGUITY_MARGIN = 0.15; // top pick must clearly beat the runner-up
const NO_CULPRIT_THRESHOLD = 0.5;

export function decide(
  lines: LogLine[],
  candidateIndices: number[],
  answers: Answers,
): Decision {
  if (candidateIndices.length === 0) {
    return { status: "no_candidates", topCandidates: [] };
  }

  const byIndex = new Map(lines.map((l) => [l.i, l.text]));
  const scored: ScoredLine[] = candidateIndices
    .map((i) => ({
      line: i,
      text: byIndex.get(i) ?? "",
      probability: answers[`line_${i}`]?.noul ?? 0,
    }))
    .sort((a, b) => b.probability - a.probability);

  const top = scored[0];
  const runnerUp = scored[1];
  const margin = runnerUp ? top.probability - runnerUp.probability : top.probability;
  const noClearCulprit = answers["no_clear_culprit"]?.noul ?? 0;

  // Low confidence never relaxes into an auto-answer: any of these send the job to
  // a human, alongside the top two lines they'd otherwise have to hunt for.
  const ambiguous =
    noClearCulprit >= NO_CULPRIT_THRESHOLD ||
    top.probability < CONFIDENCE_THRESHOLD ||
    margin < AMBIGUITY_MARGIN;

  const topCandidates = scored.slice(0, 2);

  if (ambiguous) {
    return { status: "ambiguous", topCandidates };
  }

  return {
    status: "resolved",
    culpritLine: top.line,
    culpritText: top.text,
    probability: top.probability,
    topCandidates,
  };
}
