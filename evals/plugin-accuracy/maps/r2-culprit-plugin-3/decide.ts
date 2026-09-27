// Culprit-line detection for CI failures, built on Jev (typesafe-ai/jev).
//
// One request per failed job: state = job metadata + last <=200 log lines,
// questions = one `noul` "is line i the cause?" per line, plus one `choice`
// asking whether a single line even accounts for the failure. All lines
// share one state payload (cheaper than one request per line — see
// jev-questions rule "one long state, many scoped questions").

export interface LogLine {
  i: number;
  text: string;
}

export interface JobMeta {
  id: string;
  name: string;
  provider: string;
  exit_code: number;
}

type NoulQuestion = { type: "noul"; instructions: string; criteria: { true: string; false: string } };
type ChoiceQuestion = { type: "choice"; instructions: string; criteria: Record<string, string> };

export interface JevRequest {
  model: "typesafe-ai/jev";
  state: { job: JobMeta; lines: LogLine[] };
  questions: Record<string, NoulQuestion | ChoiceQuestion>;
}

const MAX_LINES = 200;

export function buildRequest(job: JobMeta, rawLines: string[]): JevRequest {
  const lines: LogLine[] = rawLines.slice(-MAX_LINES).map((text, i) => ({ i, text }));

  const questions: JevRequest["questions"] = {
    diagnosable: {
      type: "choice",
      instructions:
        "Considering all lines in state.lines together as one CI job log for the job in state.job, " +
        "is the specific reason state.job failed identifiable from a single line in this excerpt?",
      criteria: {
        single_line: "one specific line in state.lines states the concrete error, assertion failure, or exception that caused the failure",
        multi_line: "the cause is only clear by combining several lines (e.g. a multi-frame stack trace or a diff), no single line states it alone",
        not_in_excerpt: "these lines do not contain the actual cause (e.g. truncated log, infra flake, timeout with no error text)",
      },
    },
  };

  for (const line of lines) {
    questions[`culprit_${line.i}`] = {
      type: "noul",
      instructions:
        `Does line ${line.i} in state.lines (${JSON.stringify(line.text)}) directly state the specific ` +
        "reason state.job failed, as opposed to setup output, a passing step, a stack-trace frame that " +
        "only shows call path, or noise emitted after the real cause?",
      criteria: {
        true: `line ${line.i} is the specific statement of the failure cause`,
        false: `line ${line.i} is not the cause`,
      },
    };
  }

  return { model: "typesafe-ai/jev", state: { job, lines }, questions };
}

// --- decide over the answers ---------------------------------------------

export interface NoulAnswer {
  noul: number; // probability
}
export interface ChoiceAnswer {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}
export type JevAnswers = Record<string, NoulAnswer | ChoiceAnswer>;

export type Decision =
  | { status: "found"; line: LogLine; probability: number; runnerUp?: { line: LogLine; probability: number } }
  | { status: "escalate"; reason: "not_single_line" | "ambiguous_top_candidates"; top: Array<{ line: LogLine; probability: number }> };

// Below this, "found" is not confident enough to hand to a developer unreviewed.
const MIN_PROBABILITY = 0.5;
// If the runner-up is this close to the top pick, the model isn't distinguishing them.
const AMBIGUITY_MARGIN = 0.15;

export function decide(lines: LogLine[], answers: JevAnswers): Decision {
  const diagnosable = answers.diagnosable as ChoiceAnswer;

  const ranked = lines
    .map((line) => ({ line, probability: (answers[`culprit_${line.i}`] as NoulAnswer).noul }))
    .sort((a, b) => b.probability - a.probability);

  if (diagnosable.choice !== "single_line") {
    return { status: "escalate", reason: "not_single_line", top: ranked.slice(0, 3) };
  }

  const [best, second] = ranked;

  if (best.probability < MIN_PROBABILITY || (second && best.probability - second.probability < AMBIGUITY_MARGIN)) {
    return { status: "escalate", reason: "ambiguous_top_candidates", top: ranked.slice(0, 3) };
  }

  return {
    status: "found",
    line: best.line,
    probability: best.probability,
    ...(second ? { runnerUp: { line: second.line, probability: second.probability } } : {}),
  };
}
