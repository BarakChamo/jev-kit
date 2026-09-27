import { decide as decideCulprit } from "./decide";
import questionsJson from "./questions.json";

interface CaseInput {
  repo: string;
  branch: string;
  runner: string;
  job_name: string;
  attempt_number: number;
  max_attempts: number;
  log_tail: string;
  log_lines: string[];
}

interface ChoiceApiAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

const CULPRIT_INSTRUCTIONS = (questionsJson as any).questions.culprit_line
  .instructions as string;
const NONE_IDENTIFIABLE_CRITERION = (questionsJson as any).questions
  .culprit_line.criteria.none_identifiable as string;

export function buildState(input: CaseInput) {
  return {
    job_name: input.job_name,
    log_lines: input.log_lines.map((line, i) => `${i + 1}: ${line}`),
  };
}

export function questions(input: CaseInput) {
  const criteria: Record<string, string> = {};
  input.log_lines.forEach((line, i) => {
    criteria[String(i + 1)] = line.replace(/^\d+:\s*/, "").trim();
  });
  criteria.none_identifiable = NONE_IDENTIFIABLE_CRITERION;

  return {
    culprit_line: {
      type: "choice",
      instructions: CULPRIT_INSTRUCTIONS,
      criteria,
    },
  };
}

export function decide(
  input: CaseInput,
  answers: { culprit_line: ChoiceApiAnswer }
): { culprit_lines: number[] } {
  const { choice, confidence, probabilities } = answers.culprit_line;

  const logLines = input.log_lines.map((text, i) => ({
    number: i + 1,
    text,
  }));

  const decision = decideCulprit(
    { answers: { culprit_line: { choice, confidence, probabilities } } },
    logLines
  );

  switch (decision.kind) {
    case "point":
      return { culprit_lines: [decision.line.number - 1] };
    case "review":
      return {
        culprit_lines: decision.candidates.map((c) => c.line.number - 1),
      };
    case "no_culprit_line":
      return { culprit_lines: [] };
  }
}
