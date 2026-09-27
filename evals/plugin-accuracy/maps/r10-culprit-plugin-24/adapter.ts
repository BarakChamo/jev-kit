import { buildRequest, decide as decideCulprit } from "./decide";

interface LogLine {
  n: number;
  text: string;
}

interface JobMeta {
  name: string;
  workflow: string;
  conclusion: "failure" | "cancelled" | "timed_out";
}

// Example state fallbacks for fields the canonical case input does not carry.
const EXAMPLE_JOB: JobMeta = {
  name: "test-integration",
  workflow: "ci.yml",
  conclusion: "failure",
};

interface CaseInput {
  repo?: string;
  branch?: string;
  runner?: string;
  job_name?: string;
  attempt_number?: number;
  max_attempts?: number;
  log_tail?: string;
  log_lines?: string[];
}

function buildJobAndLines(input: CaseInput): { job: JobMeta; lines: LogLine[] } {
  const job: JobMeta = {
    name: input.job_name ?? EXAMPLE_JOB.name,
    workflow: EXAMPLE_JOB.workflow,
    conclusion: EXAMPLE_JOB.conclusion,
  };

  const lines: LogLine[] = (input.log_lines ?? []).map((text, i) => ({
    n: i + 1,
    text,
  }));

  return { job, lines };
}

export function buildState(input: CaseInput) {
  const { job, lines } = buildJobAndLines(input);
  return { job, lines };
}

export function questions(input: CaseInput) {
  const { job, lines } = buildJobAndLines(input);
  return buildRequest(job, lines).questions;
}

interface ChoiceAnswer {
  type?: string;
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export function decide(
  input: CaseInput,
  answers: { culprit_line: ChoiceAnswer }
): { culprit_lines: number[] } {
  const { lines } = buildJobAndLines(input);
  const result = decideCulprit(answers.culprit_line, lines);

  if (result.kind === "point") {
    return { culprit_lines: [result.line.n - 1] };
  }

  const culprit_lines = result.candidates
    .filter((c) => c.line != null)
    .map((c) => c.line.n - 1);
  return { culprit_lines };
}
