import { selectCandidates, buildQuestions, decide as decideCulprit, type CulpritResult } from "./decide.ts";

interface CaseInput {
  job_name: string;
  log_lines: string[];
  [key: string]: unknown;
}

interface NoulAnswer {
  type: "noul";
  noul: number;
}

type Answers = Record<string, NoulAnswer | { type: string; [key: string]: unknown }>;

export function buildState(input: CaseInput) {
  return {
    job_name: input.job_name,
    log_lines: input.log_lines,
  };
}

export function questions(input: CaseInput) {
  const candidates = selectCandidates(input.log_lines);
  return buildQuestions(input.log_lines, candidates);
}

export function decide(input: CaseInput, answers: Answers): { culprit_lines: number[] } {
  const candidates = selectCandidates(input.log_lines);
  const jevAnswers: Record<string, { noul: number }> = {};
  for (const [key, answer] of Object.entries(answers)) {
    if (answer && answer.type === "noul" && typeof (answer as NoulAnswer).noul === "number") {
      jevAnswers[key] = { noul: (answer as NoulAnswer).noul };
    }
  }

  const result: CulpritResult = decideCulprit(input.log_lines, candidates, jevAnswers);

  if (result.singleCulprit) {
    return { culprit_lines: [result.singleCulprit.index] };
  }
  return { culprit_lines: result.shortlist.map((entry) => entry.index) };
}
