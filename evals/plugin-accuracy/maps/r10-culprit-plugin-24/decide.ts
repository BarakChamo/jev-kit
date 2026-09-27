// Builds the Jev request for a failed CI job's last 200 log lines, and turns
// the answer into an action. Do NOT pre-filter lines with a regex before
// building the request (a code pre-filter is an unmeasured classifier and
// has been observed to drop the true culprit line in ~5/30 cases) — send the
// whole window every time; the state is paid for once regardless of size.

interface LogLine {
  n: number;
  text: string;
}

interface JobMeta {
  name: string;
  workflow: string;
  conclusion: "failure" | "cancelled" | "timed_out";
}

interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

interface JevRequest {
  model: "typesafe-ai/jev";
  state: { job: JobMeta; lines: LogLine[] };
  questions: { culprit_line: ChoiceQuestion };
}

interface ChoiceAnswer {
  choice: string; // one of the line numbers (as string) or "unclear"
  confidence: number;
  probabilities: Record<string, number>;
}

const INSTRUCTIONS =
  "Exactly one line in `lines` states the specific error that caused this CI job to fail — " +
  "the assertion, exception, or tool diagnostic that names what actually went wrong. Pick its `n`. " +
  "Skip lines that only report that the job failed without saying why: exit-code wrappers " +
  "(`##[error]Process completed with exit code 1`, `Process completed with exit code 1`), " +
  "step/job summary lines, and pass/fail counts (`Tests: 1 failed, 47 passed, 48 total`). " +
  "If a stack trace is present, pick the line with the error message itself, not a `at ...` frame. " +
  "If no single line in `lines` states a specific cause, choose `unclear`.";

export function buildRequest(job: JobMeta, lines: LogLine[]): JevRequest {
  const criteria: Record<string, string> = {};
  for (const line of lines) {
    criteria[String(line.n)] =
      `line ${line.n} of \`lines\` is the specific line that states the cause of the failure`;
  }
  criteria["unclear"] =
    "no single line in `lines` states a specific cause (e.g. the log tail is truncated, silent, " +
    "or the failure requires combining several lines)";

  return {
    model: "typesafe-ai/jev",
    state: { job, lines },
    questions: {
      culprit_line: { type: "choice", instructions: INSTRUCTIONS, criteria },
    },
  };
}

// Gate on the probability of the top label, not the `confidence` scalar
// (the scalar was measured systematically under-confident by up to 29 points).
// Tune via jev-eval on ~30 labelled failures before trusting this default.
const AUTO_POINT_THRESHOLD = 0.6;
const ESCALATE_CANDIDATES = 3;

export type Decision =
  | { kind: "point"; line: LogLine; probability: number }
  | { kind: "escalate"; candidates: { line: LogLine; probability: number }[]; reason: "unclear" | "low_confidence" };

export function decide(answer: ChoiceAnswer, lines: LogLine[]): Decision {
  const byLine = new Map(lines.map((l) => [String(l.n), l]));

  const ranked = Object.entries(answer.probabilities)
    .filter(([key]) => key !== "unclear")
    .sort((a, b) => b[1] - a[1])
    .slice(0, ESCALATE_CANDIDATES)
    .map(([key, probability]) => ({ line: byLine.get(key)!, probability }));

  if (answer.choice === "unclear") {
    return { kind: "escalate", candidates: ranked, reason: "unclear" };
  }

  const topProbability = answer.probabilities[answer.choice] ?? 0;
  if (topProbability < AUTO_POINT_THRESHOLD) {
    return { kind: "escalate", candidates: ranked, reason: "low_confidence" };
  }

  return { kind: "point", line: byLine.get(answer.choice)!, probability: topProbability };
}
