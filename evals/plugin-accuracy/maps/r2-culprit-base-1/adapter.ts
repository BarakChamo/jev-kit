import {
  buildRequest,
  filterCandidates,
  decide as decideVerdict,
  type Job,
  type LogLine,
  type JevAnswers,
} from "./decide.ts";

// Fallback values copied from questions.json's example state.job; the
// canonical case input has no equivalent fields.
const EXAMPLE_RUN_ID = "run_9f21";
const EXAMPLE_COMMAND = "pnpm build";

export interface CaseInput {
  repo: string;
  branch: string;
  runner: string;
  job_name: string;
  attempt_number: number;
  max_attempts: number;
  log_tail: string;
  log_lines: string[];
}

function toLogLines(input: CaseInput): LogLine[] {
  return input.log_lines.map((text, i) => ({ n: i + 1, text }));
}

function toJob(input: CaseInput): Job {
  return {
    name: input.job_name,
    repo: input.repo,
    runId: EXAMPLE_RUN_ID,
    command: EXAMPLE_COMMAND,
  };
}

export function buildState(input: CaseInput) {
  return buildRequest(toJob(input), toLogLines(input)).state;
}

export function questions(input: CaseInput) {
  return buildRequest(toJob(input), toLogLines(input)).questions;
}

export function decide(
  input: CaseInput,
  answers: {
    culprit: { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };
    single_root_cause: { type: "noul"; noul: boolean };
  }
): { culprit_lines: number[] } {
  const candidates = filterCandidates(toLogLines(input));

  const jevAnswers: JevAnswers = {
    culprit: {
      choice: answers.culprit.choice,
      confidence: answers.culprit.confidence,
      probabilities: answers.culprit.probabilities,
    },
    single_root_cause: {
      probability: Number(answers.single_root_cause.noul),
    },
  };

  const verdict = decideVerdict(jevAnswers, candidates);

  if (verdict.mode === "pinpoint") {
    return { culprit_lines: [verdict.line - 1] };
  }

  return {
    culprit_lines: verdict.candidates
      .map((c) => c.line - 1)
      .filter((n) => n >= 0),
  };
}
