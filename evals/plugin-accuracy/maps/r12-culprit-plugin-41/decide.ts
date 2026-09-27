// CI log culprit-line finder: build the Jev request from the last 200 log lines,
// then turn the answer into a decision. See questions.json for the annotated example.

export interface LogLine {
  n: number;
  text: string;
}

export interface JobMeta {
  id: string;
  workflow: string;
  step: string;
  conclusion: string;
}

export interface ChoiceAnswer {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

const UNCLEAR = "unclear";

const INSTRUCTIONS =
  "`lines` is the tail of a CI job's log, in order. Which single line number states " +
  "the specific error that caused the job (see `job`) to fail — the actual exception, " +
  "assertion failure, failing command, or stack-trace frame that pinpoints the fault? " +
  "Do not pick a generic wrapper or summary line: skip step banners ('Run ...'), " +
  "pass/fail counts ('Tests: ... failed, ... passed'), and runner exit-code wrappers " +
  "('Process completed with exit code N', '##[error]Process completed...'). " +
  "If no line in the given window actually states the fault (e.g. the log was truncated " +
  "before the real error appears), answer 'unclear'.";

// `choice` allows up to 255 options; 200 lines + "unclear" fits with room to spare.
export function buildRequest(job: JobMeta, lines: LogLine[]) {
  const criteria: Record<string, string> = { [UNCLEAR]: "no line in the window actually states the fault" };
  for (const line of lines) criteria[String(line.n)] = line.text;

  return {
    model: "typesafe-ai/jev",
    state: { job, lines },
    questions: {
      culprit_line: { type: "choice", instructions: INSTRUCTIONS, criteria },
    },
  };
}

export type Decision =
  | { status: "found"; line: number; text: string; probability: number }
  | { status: "ambiguous" | "unclear"; candidates: { line: number; text: string; probability: number }[] };

// Gate on the probability mass on the chosen line and its margin over the runner-up,
// not the `confidence` scalar (it's measurably under-confident). Pointing at a cause
// among near-identical lines is a historically weak spot for this style of question
// (65-100% depending on how distinctive the error line is), so when unsure, surface
// the top candidates for a human instead of auto-linking one.
const PROBABILITY_THRESHOLD = 0.75;
const MARGIN_OVER_RUNNER_UP = 0.15;
const TOP_N_WHEN_UNSURE = 3;

export function decide(lines: LogLine[], answer: ChoiceAnswer): Decision {
  const byLine = new Map(lines.map((l) => [String(l.n), l]));

  const ranked = Object.entries(answer.probabilities)
    .filter(([option]) => option !== UNCLEAR)
    .sort((a, b) => b[1] - a[1]);

  const toCandidate = ([n, probability]: [string, number]) => {
    const line = byLine.get(n)!;
    return { line: line.n, text: line.text, probability };
  };

  if (answer.choice === UNCLEAR) {
    return { status: "unclear", candidates: ranked.slice(0, TOP_N_WHEN_UNSURE).map(toCandidate) };
  }

  const [top, runnerUp] = ranked;
  const margin = runnerUp ? top[1] - runnerUp[1] : 1;

  if (top[1] >= PROBABILITY_THRESHOLD && margin >= MARGIN_OVER_RUNNER_UP) {
    const { line, probability } = toCandidate(top);
    return { status: "found", line, text: byLine.get(String(line))!.text, probability };
  }

  return { status: "ambiguous", candidates: ranked.slice(0, TOP_N_WHEN_UNSURE).map(toCandidate) };
}
