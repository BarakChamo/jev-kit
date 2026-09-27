// Decision logic for the "which log line caused this CI failure" Jev request
// defined in questions.json. Builds the request body and interprets the answers.
// Does not call the API.

export interface CiLogState {
  job_id: string;
  start_line: number; // 1-based line number of lines[0] in the full log
  lines: string[]; // last <=200 lines of the job log, in order
}

export interface JevRequest {
  model: "typesafe-ai/jev";
  state: CiLogState;
  questions: Record<string, unknown>;
}

export interface ChoiceAnswer {
  choice: string;
  confidence: number; // 0..1
  probabilities: Record<string, number>;
}

export interface JevAnswers {
  culprit_line: ChoiceAnswer;
  is_infra_failure: number; // probability true
}

const CONFIDENCE_THRESHOLD = 0.5;
const INFRA_THRESHOLD = 0.6;
const TOP_N_CANDIDATES = 3;

// Build the request for a real job from its last 200 log lines.
export function buildRequest(
  jobId: string,
  fullLogLineCount: number,
  last200Lines: string[]
): JevRequest {
  const startLine = fullLogLineCount - last200Lines.length + 1;
  const criteria: Record<string, string> = {};
  last200Lines.forEach((line, i) => {
    criteria[String(i)] = line.slice(0, 500); // guard against pathological line lengths
  });

  return {
    model: "typesafe-ai/jev",
    state: { job_id: jobId, start_line: startLine, lines: last200Lines },
    questions: {
      culprit_line: {
        type: "choice",
        instructions:
          "This is the tail of a CI job log (state.lines), one array entry per log line, indexed from 0 in order. The job failed. Pick the single line that is the root cause of the failure: the first assertion failure, thrown exception, compiler/lint error, or first non-zero-exit-triggering error that explains why the job failed. Do NOT pick a downstream summary line (e.g. 'Tests: 1 failed'), a re-print/echo of an earlier error, or generic wrapper output (e.g. 'npm ERR! Test failed', 'Process completed with exit code 1').",
        criteria,
      },
      is_infra_failure: {
        type: "noul",
        instructions:
          "Given the same CI log tail (state.lines), decide whether this failure is caused by infrastructure/environment problems (runner OOM, network timeout, docker pull failure, disk full, package registry outage, flaky runner crash) rather than by the code or tests under test.",
        criteria: {
          true: "The log shows infra/environment breakage unrelated to application code: timeouts, OOM kills, network or registry errors, runner crashes, 'no space left on device', etc.",
          false: "The log shows a normal code-caused failure: a failing test/assertion, a compile/type error, a lint error, or an application exception.",
        },
      },
    },
  };
}

export type Decision =
  | { kind: "infra"; message: string; confidence: number }
  | { kind: "pinpoint"; lineNumber: number; line: string; confidence: number }
  | {
      kind: "ambiguous";
      candidates: { lineNumber: number; line: string; probability: number }[];
    };

// Turn the Jev answers into a routing decision for the CI UI.
export function decide(state: CiLogState, answers: JevAnswers): Decision {
  if (answers.is_infra_failure >= INFRA_THRESHOLD) {
    return {
      kind: "infra",
      message: "Likely an infrastructure/environment failure, not a code issue. Consider rerunning the job.",
      confidence: answers.is_infra_failure,
    };
  }

  const { choice, confidence, probabilities } = answers.culprit_line;
  const idx = Number(choice);

  if (confidence < CONFIDENCE_THRESHOLD) {
    const candidates = Object.entries(probabilities)
      .sort(([, a], [, b]) => b - a)
      .slice(0, TOP_N_CANDIDATES)
      .map(([i, probability]) => ({
        lineNumber: state.start_line + Number(i),
        line: state.lines[Number(i)],
        probability,
      }));
    return { kind: "ambiguous", candidates };
  }

  return {
    kind: "pinpoint",
    lineNumber: state.start_line + idx,
    line: state.lines[idx],
    confidence,
  };
}
