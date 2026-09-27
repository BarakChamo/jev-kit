// Points a failed CI job at the single log line that caused it, via one Jev `choice`
// question over the job's last <=200 log lines. See questions.json for the request shape
// and the jev-questions skill for why this is one `choice` (not a `noul` per line).

const JEV_URL = "https://ai-gateway.vercel.sh/typesafe/v1/systemone";
const MAX_LINES = 200;

// Gate on the winning option's own probability (skill rule 8), not `confidence`.
// Pick this from ~30 labelled failures (jev-eval) before trusting it in prod.
const CONFIDENCE_THRESHOLD = 0.6;

interface LogLine {
  i: number;
  text: string;
}

interface JevChoiceAnswer {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export type Decision =
  | { status: "resolved"; line: LogLine; probability: number }
  | { status: "needs_review"; candidates: { line: LogLine; probability: number }[]; reason: "unclear" | "low_confidence" }
  | { status: "trivial"; line: LogLine };

function buildLines(rawLines: string[]): LogLine[] {
  const tail = rawLines.slice(-MAX_LINES);
  // Truncate individual lines (not the line list) so one giant one-liner doesn't
  // blow up the request; every line still gets a vote.
  return tail.map((text, idx) => ({ i: idx, text: text.length > 500 ? text.slice(0, 500) + "…" : text }));
}

export function buildRequest(jobId: string, jobName: string, rawLines: string[]) {
  const lines = buildLines(rawLines);
  const criteria: Record<string, string> = {
    unclear: "no single line above clearly states a specific failure cause",
  };
  for (const line of lines) criteria[String(line.i)] = line.text;

  return {
    lines,
    body: {
      model: "typesafe-ai/jev",
      state: { job_id: jobId, job_name: jobName, lines },
      questions: {
        culprit: {
          type: "choice",
          instructions:
            "Exactly one line in `lines` states the specific error, exception, assertion failure, or failing command that caused this CI job to fail. Pick that line's index. Skip generic wrapper, header and summary lines that only report that the job failed or ran, such as 'Run <command>', '##[error]Process completed with exit code N', a final 'Tests: X failed, Y passed' count, or a shell prompt echo — those never name the cause. If two lines both look causal (e.g. an exception message and its stack frame), pick the one that names the error itself, not a frame that only shows where it was thrown. If no single line in `lines` clearly states a specific cause, choose \"unclear\".",
          criteria,
        },
      },
    },
  };
}

export async function decide(jobId: string, jobName: string, rawLines: string[]): Promise<Decision> {
  const lines = buildLines(rawLines);
  if (lines.length <= 1) {
    return { status: "trivial", line: lines[0] };
  }

  const { body } = buildRequest(jobId, jobName, rawLines);
  const res = await fetch(JEV_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}` },
    body: JSON.stringify(body),
  });
  const { culprit }: { culprit: JevChoiceAnswer } = await res.json();

  const byLine = new Map(lines.map((l) => [String(l.i), l]));
  const ranked = Object.entries(culprit.probabilities)
    .filter(([key]) => key !== "unclear")
    .sort(([, a], [, b]) => b - a)
    .map(([key, p]) => ({ line: byLine.get(key)!, probability: p }));

  const topProbability = culprit.probabilities[culprit.choice] ?? 0;

  if (culprit.choice === "unclear") {
    return { status: "needs_review", candidates: ranked.slice(0, 3), reason: "unclear" };
  }
  // Low confidence never resolves on its own — it always escalates (skill: "low confidence
  // must never relax a decision"). Show a person the top few, per the runner-up-recovery rule.
  if (topProbability < CONFIDENCE_THRESHOLD) {
    return { status: "needs_review", candidates: ranked.slice(0, 3), reason: "low_confidence" };
  }

  return { status: "resolved", line: byLine.get(culprit.choice)!, probability: topProbability };
}

// Formats a resolved/needs_review decision as a GitHub Actions log annotation.
export function toAnnotation(decision: Decision): string {
  switch (decision.status) {
    case "trivial":
    case "resolved": {
      const line = decision.status === "trivial" ? decision.line : decision.line;
      return `::error::Likely cause (log line ${line.i}): ${line.text}`;
    }
    case "needs_review":
      return decision.candidates
        .map((c) => `::warning::Possible cause (${(c.probability * 100).toFixed(0)}%, line ${c.line.i}): ${c.line.text}`)
        .join("\n");
  }
}
