// Culprit-line detection for CI failures, built on Jev (typesafe-ai/jev).
// Local regex filter narrows 200 lines -> a handful of candidates (keeps the
// per-failure Jev call cheap at "thousands of failures a day"), then one
// request asks Jev to pick among them. See questions.json for the request shape.

export interface LogLine {
  n: number; // 1-based line number in the original 200-line tail
  text: string;
}

export interface Candidate {
  id: string; // "L<n>", used as the choice option key
  line: number;
  text: string;
  context: string; // candidate line +/-1 line, "n: text" joined by \n
}

export interface Job {
  name: string;
  repo: string;
  runId: string;
  command: string;
}

// Lines that look like they carry a root cause vs. pure noise. Ordered
// roughly most-specific-first; anything matching is a candidate, the model
// decides which is *the* culprit.
const ERROR_PATTERNS = [
  /\berror\b/i,
  /\bexception\b/i,
  /\bfail(ed|ure)?\b/i,
  /\btraceback\b/i,
  /\bpanic:/i,
  /\bassert(ion)?\b/i,
  /\btimed? ?out\b/i,
  /\bexit(ed)? (code|status)\s*[1-9]/i,
  /\bnpm err!/i,
  /\bfatal\b/i,
];

const MAX_CANDIDATES = 20;

export function filterCandidates(lines: LogLine[], max = MAX_CANDIDATES): Candidate[] {
  const byLine = new Map(lines.map((l) => [l.n, l]));
  const matches = lines.filter((l) => ERROR_PATTERNS.some((re) => re.test(l.text)));

  // Always keep the last line: it's often the CI runner's own failure
  // summary and a useful anchor even when nothing else matched.
  const last = lines[lines.length - 1];
  const picked = matches.length > 0 ? matches : last ? [last] : [];

  const capped = picked.slice(-max); // prefer the most recent matches

  return capped.map((l) => {
    const ctxLines = [byLine.get(l.n - 1), l, byLine.get(l.n + 1)].filter(
      (x): x is LogLine => !!x
    );
    return {
      id: `L${l.n}`,
      line: l.n,
      text: l.text,
      context: ctxLines.map((x) => `${x.n}: ${x.text}`).join("\n"),
    };
  });
}

export interface JevRequest {
  model: "typesafe-ai/jev";
  state: {
    job: Job;
    totalLines: number;
    candidates: Candidate[];
  };
  questions: {
    culprit: {
      type: "choice";
      instructions: string;
      criteria: Record<string, string>;
    };
    single_root_cause: {
      type: "noul";
      instructions: string;
      criteria: { true: string; false: string };
    };
  };
}

export function buildRequest(job: Job, last200Lines: LogLine[]): JevRequest {
  const candidates = filterCandidates(last200Lines);
  return {
    model: "typesafe-ai/jev",
    state: { job, totalLines: last200Lines.length, candidates },
    questions: {
      culprit: {
        type: "choice",
        instructions:
          `This is a CI job log for \`${job.command}\` in ${job.repo}. Below are candidate ` +
          "lines (with 1-line context) pulled from the last 200 lines of a failed run. Pick " +
          "the single line that is the ROOT CAUSE of the failure -- the earliest, most " +
          "specific line that explains WHY the job broke -- not a downstream symptom that " +
          "just restates 'something failed' (generic exit codes, lifecycle wrappers, CI " +
          "runner summaries).",
        criteria: Object.fromEntries(candidates.map((c) => [c.id, c.context])),
      },
      single_root_cause: {
        type: "noul",
        instructions:
          "Looking at the full set of candidate lines together: does this failure trace " +
          "back to one clear, identifiable root cause line, as opposed to multiple unrelated " +
          "errors, flaky/infra noise, or a cascade where no single line clearly explains it?",
        criteria: {
          true: "There is one line that clearly and specifically explains the failure.",
          false:
            "The candidates are ambiguous, unrelated to each other, or none is specific " +
            "enough to call the cause.",
        },
      },
    },
  };
}

// --- Answers -----------------------------------------------------------

export interface ChoiceAnswer {
  choice: string; // candidate id, e.g. "L143"
  confidence: number; // 0..1
  probabilities: Record<string, number>;
}

export interface NoulAnswer {
  probability: number; // 0..1, P(true)
}

export interface JevAnswers {
  culprit: ChoiceAnswer;
  single_root_cause: NoulAnswer;
}

export type Verdict =
  | { mode: "pinpoint"; line: number; text: string; confidence: number }
  | {
      mode: "ranked";
      reason: "no-single-cause" | "low-confidence";
      candidates: Array<{ line: number; text: string; probability: number }>;
    };

const CONFIDENCE_THRESHOLD = 0.6;
const RANKED_TOP_N = 3;

export function decide(answers: JevAnswers, candidates: Candidate[]): Verdict {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const { culprit, single_root_cause } = answers;

  const confident =
    single_root_cause.probability >= CONFIDENCE_THRESHOLD &&
    culprit.confidence >= CONFIDENCE_THRESHOLD;

  if (confident) {
    const picked = byId.get(culprit.choice);
    if (picked) {
      return {
        mode: "pinpoint",
        line: picked.line,
        text: picked.text,
        confidence: culprit.confidence,
      };
    }
  }

  const ranked = Object.entries(culprit.probabilities)
    .sort(([, a], [, b]) => b - a)
    .slice(0, RANKED_TOP_N)
    .map(([id, probability]) => {
      const c = byId.get(id);
      return { line: c?.line ?? -1, text: c?.text ?? "", probability };
    });

  return {
    mode: "ranked",
    reason: single_root_cause.probability < CONFIDENCE_THRESHOLD ? "no-single-cause" : "low-confidence",
    candidates: ranked,
  };
}

// The actual HTTP call is intentionally not implemented here:
// POST https://ai-gateway.vercel.sh/typesafe/v1/systemone with buildRequest(...)'s
// output as the body, then pass the parsed answers to decide().
