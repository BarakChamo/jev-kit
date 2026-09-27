// Point a developer at the one log line that caused a CI failure, out of the last 200 lines.
// Uses one `choice` question over every candidate line (see questions.json) — never a `noul`
// per line, which the measured suite this is based on put the generic exit-code wrapper line
// on top in 23/30 cases.

const MAX_LINES = 200;
const CRITERIA_TEXT_LIMIT = 300; // truncate a single line's text if pathologically long
const CONFIDENCE_THRESHOLD = 0.6; // gate on the choice's own top probability, not `confidence`

interface LogLine {
  line_number: number;
  text: string;
}

interface JevChoiceAnswer {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

interface Resolved {
  status: "resolved";
  jobId: string;
  lineNumber: number;
  lineText: string;
  probability: number;
}

interface Escalated {
  status: "escalate";
  jobId: string;
  reason: "unclear" | "low_confidence";
  topCandidates: { lineNumber: number | null; lineText: string; probability: number }[];
}

type Decision = Resolved | Escalated;

// Take the last MAX_LINES lines of a raw job log and number them for the request.
export function buildLines(rawLog: string[]): LogLine[] {
  const tail = rawLog.slice(-MAX_LINES);
  const offset = rawLog.length - tail.length;
  return tail.map((text, i) => ({ line_number: offset + i + 1, text }));
}

export function buildRequest(jobId: string, lines: LogLine[]) {
  const criteria: Record<string, string> = {
    unclear: "no line in `lines` states a specific cause of the failure; a human should read the full log",
  };
  for (const line of lines) {
    criteria[String(line.line_number)] = line.text.slice(0, CRITERIA_TEXT_LIMIT);
  }

  return {
    model: "typesafe-ai/jev",
    state: { job_id: jobId, lines },
    questions: {
      culprit_line: {
        type: "choice",
        instructions:
          "The state's `lines` array holds the last 200 lines of a failed CI job's output, each with a " +
          "line_number and text, in original order. Select the line_number of the single line that most " +
          "directly states the SPECIFIC cause of the failure: the actual error message, exception, failed " +
          "assertion, or the name of the specific check/test that failed. Do not pick generic wrapper or " +
          "summary lines that only report that the job ended badly, such as '##[error] Process completed " +
          "with exit code N', a shell exit-code line with no error text of its own, or a final pass/fail " +
          "tally line. If a stack trace is present, pick the line that first names the specific error " +
          "(e.g. the exception message), not the frames below it that just show the call stack. If no " +
          "line in `lines` states a specific cause, choose 'unclear'.",
        criteria,
      },
    },
  };
}

// answers = { culprit_line: JevChoiceAnswer } from the systemone response.
export function decide(
  jobId: string,
  lines: LogLine[],
  answers: { culprit_line: JevChoiceAnswer }
): Decision {
  const { choice, probabilities } = answers.culprit_line;
  const byLine = new Map(lines.map((l) => [String(l.line_number), l]));

  const ranked = Object.entries(probabilities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, probability]) => ({
      lineNumber: key === "unclear" ? null : Number(key),
      lineText: key === "unclear" ? "(no single line states a specific cause)" : byLine.get(key)?.text ?? "",
      probability,
    }));

  const topProbability = probabilities[choice];

  if (choice === "unclear") {
    return { status: "escalate", jobId, reason: "unclear", topCandidates: ranked };
  }
  if (topProbability < CONFIDENCE_THRESHOLD) {
    return { status: "escalate", jobId, reason: "low_confidence", topCandidates: ranked };
  }

  const line = byLine.get(choice);
  if (!line) {
    // Model returned an option outside the ones we sent — treat as unresolved rather than guess.
    return { status: "escalate", jobId, reason: "low_confidence", topCandidates: ranked };
  }

  return {
    status: "resolved",
    jobId,
    lineNumber: line.line_number,
    lineText: line.text,
    probability: topProbability,
  };
}
