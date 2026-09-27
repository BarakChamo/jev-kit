// Culprit-line detection for failed CI jobs.
// Sends the raw tail of the log (never a pre-filtered subset — an unmeasured
// regex filter can drop the real error line before Jev ever sees it) and asks
// one `choice` question over all candidate lines. Gate on the probability
// mass of the winning option, not the `confidence` scalar (systematically
// under-confident by up to 29 points per the jev-questions rules).

interface LogLine {
  index: number;
  text: string;
}

interface JevChoiceAnswer {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

interface JevRequest {
  model: "typesafe-ai/jev";
  state: { job_id: string; lines: LogLine[] };
  questions: {
    culprit: {
      type: "choice";
      instructions: string;
      criteria: Record<string, string>;
    };
  };
}

const INSTRUCTIONS =
  "Each option is one line, named by its `index` in `lines`, from the tail of a failed CI job's " +
  "log. Which line states the specific underlying error or failure reason — the root cause a " +
  "developer would need to open and fix? Skip generic wrapper and footer lines that only report " +
  "that the job failed, without saying why: 'Process completed with exit code N', " +
  "'npm ERR! code ELIFECYCLE', 'npm ERR! errno N', re-echoed commands, timestamps, and " +
  "summary/count lines. Pick the line that names the actual error, exception, assertion, or " +
  "failing check. If no single line in `lines` states the cause, choose 'unclear'.";

const MAX_LINES = 200; // choice caps at 255 options; we add one ("unclear")

/** Builds the Jev request for one failed job. Takes the raw tail, unfiltered. */
export function buildRequest(jobId: string, rawTailLines: string[]): JevRequest {
  const lines: LogLine[] = rawTailLines
    .map((text, i) => ({ index: i, text }))
    .filter((l) => l.text.trim().length > 0)
    .slice(-MAX_LINES);

  const criteria: Record<string, string> = { unclear: "No single line in `lines` clearly states the cause of failure" };
  for (const line of lines) criteria[String(line.index)] = line.text;

  return {
    model: "typesafe-ai/jev",
    state: { job_id: jobId, lines },
    questions: {
      culprit: { type: "choice", instructions: INSTRUCTIONS, criteria },
    },
  };
}

export type CulpritDecision =
  | { outcome: "resolved"; lineIndex: number; lineText: string; probability: number }
  | { outcome: "escalate"; reason: "unclear" | "low_confidence"; candidates: { lineIndex: number; lineText: string; probability: number }[] };

// Tune this against ~30 labelled failures (jev-eval) before relying on it;
// rule 11 measured 65–100% on this task depending on how distinctive the errors are.
const PROBABILITY_THRESHOLD = 0.6;
const TOP_N_FOR_ESCALATION = 3;

export function decide(request: JevRequest, answer: JevChoiceAnswer): CulpritDecision {
  const lineByIndex = new Map(request.state.lines.map((l) => [String(l.index), l.text]));

  const ranked = Object.entries(answer.probabilities)
    .filter(([key]) => key !== "unclear")
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N_FOR_ESCALATION)
    .map(([key, probability]) => ({
      lineIndex: Number(key),
      lineText: lineByIndex.get(key) ?? "",
      probability,
    }));

  const topProbability = answer.probabilities[answer.choice] ?? 0;

  if (answer.choice === "unclear") {
    return { outcome: "escalate", reason: "unclear", candidates: ranked };
  }
  if (topProbability < PROBABILITY_THRESHOLD) {
    return { outcome: "escalate", reason: "low_confidence", candidates: ranked };
  }
  return {
    outcome: "resolved",
    lineIndex: Number(answer.choice),
    lineText: lineByIndex.get(answer.choice) ?? "",
    probability: topProbability,
  };
}

// --- Wiring, e.g. in a CI webhook handler ---
//
// const req = buildRequest(job.id, job.log.tailLines(200));
// const res = await callJev(req);              // POST to systemone with req
// const decision = decide(req, res.answers.culprit);
//
// if (decision.outcome === "resolved") {
//   postComment(job, `Likely cause: line ${decision.lineIndex} — ${decision.lineText}`);
// } else {
//   // Show the top 2–3 candidates to the developer, never to another model
//   // (rule: a shortlist is an instruction to a model, an option list to a person).
//   postComment(job, formatCandidatesForHuman(decision.candidates));
// }
