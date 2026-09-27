import { buildQuestions, decide as decideVerdict } from "./decide.ts";

export function buildState(input: any) {
  return {
    logLines: input.log_lines,
  };
}

export function questions(input: any) {
  return buildQuestions(input.log_lines);
}

export function decide(
  input: any,
  answers: Record<string, { type: string; noul: number }>
): { culprit_lines: number[] } {
  const verdict = decideVerdict(input.log_lines, answers as any);

  if (verdict.mode === "single") return { culprit_lines: [verdict.index] };
  if (verdict.mode === "shortlist") {
    return { culprit_lines: verdict.candidates.map((c) => c.index) };
  }
  return { culprit_lines: [] };
}
