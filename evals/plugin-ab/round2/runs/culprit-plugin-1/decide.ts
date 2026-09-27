// Picks the single log line that caused a CI failure, out of the last 200 lines.
// Pattern: score candidates with one `noul` per candidate, argmax + gate in code (jev-questions rule 11).

interface LogLine {
  index: number;
  text: string;
}

interface JevState {
  job_name: string;
  command: string;
  exit_code: number;
  lines: LogLine[]; // all lines shown for context; only candidates get a question
}

type NoulQuestion = {
  type: "noul";
  instructions: string;
  criteria: { true: string; false: string };
};

interface JevRequest {
  model: "typesafe-ai/jev";
  state: JevState;
  questions: Record<string, NoulQuestion>;
}

interface JevNoulAnswers {
  [questionId: string]: { noul: number };
}

const ABSTAIN_ID = "no_clear_culprit";

// Cheap regex pass: which of the last 200 lines could plausibly be the culprit.
// Kept intentionally broad -- false positives just become extra (cheap) noul questions,
// false negatives mean the true culprit is never asked about, so err on the side of inclusion.
const CANDIDATE_PATTERN =
  /\b(FAILED?|ERROR|Error|error:|panic:|Exception|Traceback|fatal:|E   |exit code [1-9]|Segmentation fault|assert)\b/;

function pickCandidates(lines: LogLine[]): LogLine[] {
  const hits = lines.filter((l) => CANDIDATE_PATTERN.test(l.text));
  // The final summary line (if present) is always a useful anchor even without a keyword hit.
  const last = lines[lines.length - 1];
  if (last && !hits.includes(last)) hits.push(last);
  return hits;
}

function buildRequest(job_name: string, command: string, exit_code: number, allLines: LogLine[], candidates: LogLine[]): JevRequest {
  const questions: Record<string, NoulQuestion> = {};

  for (const c of candidates) {
    questions[`line_${c.index}`] = {
      type: "noul",
      instructions:
        `In \`lines\`, the entry with index ${c.index} has text ${JSON.stringify(c.text)}. ` +
        "Is THIS line the single line that most directly names the root cause of the CI failure in `command`, " +
        "as opposed to being a test-runner status announcement, surrounding context, or a downstream symptom " +
        "of a cause stated elsewhere in `lines`?",
      criteria: {
        true: "this exact line is where the root cause is stated",
        false: "this line is a symptom, a status announcement, or context, and the cause is stated elsewhere",
      },
    };
  }

  questions[ABSTAIN_ID] = {
    type: "noul",
    instructions:
      "Looking only at the text of every entry in `lines`, is it true that no single entry clearly names the " +
      "root cause of the CI failure in `command` -- for example because the log was truncated before the cause " +
      "appeared, the failure is a flaky/infra error with no line pointing at a specific cause, or two or more " +
      "unrelated causes are present?",
    criteria: {
      true: "no single line in `lines` can be picked out as the root cause",
      false: "at least one line in `lines` clearly names the root cause",
    },
  };

  return {
    model: "typesafe-ai/jev",
    state: { job_name, command, exit_code, lines: allLines },
    questions,
  };
}

// Below this, don't trust the pick; above it, still require separation from the runner-up.
const MIN_TOP_PROBABILITY = 0.7;
const MIN_MARGIN_OVER_RUNNER_UP = 0.2;
const MAX_ABSTAIN_PROBABILITY = 0.5;

type Verdict =
  | { outcome: "culprit"; line: LogLine; probability: number }
  | { outcome: "escalate"; reason: string };

function decide(candidates: LogLine[], answers: JevNoulAnswers): Verdict {
  const scored = candidates
    .map((c) => ({ line: c, p: answers[`line_${c.index}`]?.noul ?? 0 }))
    .sort((a, b) => b.p - a.p);

  const abstainP = answers[ABSTAIN_ID]?.noul ?? 0;
  if (abstainP > MAX_ABSTAIN_PROBABILITY) {
    return { outcome: "escalate", reason: `no clear culprit line (p=${abstainP.toFixed(2)})` };
  }

  const top = scored[0];
  const runnerUp = scored[1];
  if (!top || top.p < MIN_TOP_PROBABILITY) {
    return { outcome: "escalate", reason: `no candidate line reached ${MIN_TOP_PROBABILITY} probability` };
  }
  if (runnerUp && top.p - runnerUp.p < MIN_MARGIN_OVER_RUNNER_UP) {
    return {
      outcome: "escalate",
      reason: `top two candidates too close (${top.p.toFixed(2)} vs ${runnerUp.p.toFixed(2)})`,
    };
  }

  return { outcome: "culprit", line: top.line, probability: top.p };
}

// Entry point for a CI run: last200 is the tail of the job log, one entry per line, 1-indexed.
export async function findCulprit(
  job_name: string,
  command: string,
  exit_code: number,
  last200: string[],
  callJev: (req: JevRequest) => Promise<JevNoulAnswers>
): Promise<Verdict> {
  const allLines: LogLine[] = last200.map((text, i) => ({ index: i + 1, text }));
  const candidates = pickCandidates(allLines);

  if (candidates.length === 0) {
    return { outcome: "escalate", reason: "no candidate line matched any known failure pattern" };
  }
  // Code can settle this completely: exactly one plausible line, no judgment needed.
  if (candidates.length === 1) {
    return { outcome: "culprit", line: candidates[0], probability: 1 };
  }

  const req = buildRequest(job_name, command, exit_code, allLines, candidates);
  const answers = await callJev(req);
  return decide(candidates, answers);
}
