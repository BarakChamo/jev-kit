import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decide as jevDecide } from "./decide.ts";

interface LogLine {
  i: number;
  text: string;
}

interface State {
  job_id: string;
  repo: string;
  branch: string;
  command: string;
  exit_code: number;
  log_lines: LogLine[];
}

interface CaseInput {
  repo: string;
  branch: string;
  runner?: string;
  job_name?: string;
  attempt_number?: number;
  max_attempts?: number;
  log_tail?: string;
  log_lines: string[];
}

const questionsJsonPath = fileURLToPath(new URL("./questions.json", import.meta.url));
const questionsJson = JSON.parse(readFileSync(questionsJsonPath, "utf8"));
const EXAMPLE_STATE = questionsJson.state as State;
const CULPRIT_TEMPLATE = questionsJson.questions.culprit_line;
const INFRA_FLAKE_QUESTION = questionsJson.questions.is_infra_flake;

export function buildState(input: CaseInput): State {
  return {
    job_id: EXAMPLE_STATE.job_id,
    repo: input.repo,
    branch: input.branch,
    command: EXAMPLE_STATE.command,
    exit_code: EXAMPLE_STATE.exit_code,
    log_lines: input.log_lines.map((text, idx) => ({ i: idx + 1, text })),
  };
}

export function questions(input: CaseInput) {
  const state = buildState(input);

  const criteria: Record<string, string> = {
    "0": CULPRIT_TEMPLATE.criteria["0"],
  };
  for (const line of state.log_lines) {
    criteria[String(line.i)] = line.text;
  }

  return {
    culprit_line: {
      type: CULPRIT_TEMPLATE.type,
      instructions: CULPRIT_TEMPLATE.instructions,
      criteria,
    },
    is_infra_flake: INFRA_FLAKE_QUESTION,
  };
}

interface NoulAnswer {
  type: "noul";
  noul: number;
}

interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

interface ScoreAnswer {
  type: "score";
  score: number;
  confidence: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
}

interface Answers {
  culprit_line: ChoiceAnswer;
  is_infra_flake: NoulAnswer;
  [key: string]: NoulAnswer | ChoiceAnswer | ScoreAnswer;
}

export function decide(input: CaseInput, answers: Answers): { culprit_lines: number[] } {
  const state = buildState(input);

  const verdict = jevDecide(
    {
      culprit_line: {
        choice: answers.culprit_line.choice,
        confidence: answers.culprit_line.confidence,
        probabilities: answers.culprit_line.probabilities,
      },
      is_infra_flake: {
        noul: answers.is_infra_flake.noul,
      },
    },
    state.log_lines,
  );

  if (verdict.mode === "confident" || verdict.mode === "shortlist") {
    return { culprit_lines: verdict.shortlist.map((line) => line.i - 1) };
  }

  return { culprit_lines: [] };
}
