import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { decide as decideImpl } from "./decide.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const questionsFile = JSON.parse(
  readFileSync(path.join(__dirname, "questions.json"), "utf8"),
);

const EXAMPLE_STATE: Record<string, unknown> = questionsFile.state;
const QUESTIONS: Record<string, unknown> = questionsFile.questions;

interface CaseInput {
  contract_text?: string;
  email_text?: string;
  email_from?: string;
  received_date?: string;
  current_term_end_date?: string;
}

// Accepts either the raw case-input fields or a full {id, input, notes} case record.
function unwrap(raw: any): CaseInput {
  if (raw && typeof raw === "object" && raw.input && "contract_text" in raw.input) {
    return raw.input;
  }
  return raw ?? {};
}

export function buildState(rawInput: any) {
  const input = unwrap(rawInput);
  return {
    contractText: input.contract_text ?? EXAMPLE_STATE.contractText,
    cancellationEmailText: input.email_text ?? EXAMPLE_STATE.cancellationEmailText,
    cancellationEmailFrom: input.email_from ?? EXAMPLE_STATE.cancellationEmailFrom,
    cancellationReceivedDate: input.received_date ?? EXAMPLE_STATE.cancellationReceivedDate,
    currentTermEndDate: input.current_term_end_date ?? EXAMPLE_STATE.currentTermEndDate,
  };
}

export function questions(_rawInput: any) {
  return QUESTIONS;
}

type NoulApiAnswer = { type: "noul"; noul: boolean };
type ChoiceApiAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};
type ScoreApiAnswer = {
  type: "score";
  score: number;
  confidence: number;
  legend: string[] | Record<string, string>;
  probabilities: number[] | Record<string, number>;
};
type ApiAnswer = NoulApiAnswer | ChoiceApiAnswer | ScoreApiAnswer;

// decide.ts wants a boolean-derived probability on noul answers; the API's noul
// answer has no probability field, so derive it mechanically from the boolean.
function withProbability(a: NoulApiAnswer) {
  return { ...a, probability: Number(a.noul) };
}

// decide.ts wants a level name on score answers; derive it from score+legend.
function levelFromScore(a: ScoreApiAnswer): string {
  const { score, legend } = a;
  if (Array.isArray(legend)) return legend[score];
  return (legend as Record<string, string>)[score] ?? (legend as Record<string, string>)[String(score)];
}

function toJevAnswers(answers: Record<string, ApiAnswer>) {
  return {
    has_auto_renewal: withProbability(answers.has_auto_renewal as NoulApiAnswer),
    notice_timely: withProbability(answers.notice_timely as NoulApiAnswer),
    method_compliant: withProbability(answers.method_compliant as NoulApiAnswer),
    intent_clear: withProbability(answers.intent_clear as NoulApiAnswer),
    clause_ambiguity: {
      ...(answers.clause_ambiguity as ScoreApiAnswer),
      level: levelFromScore(answers.clause_ambiguity as ScoreApiAnswer),
    },
  };
}

export type DecideResult = {
  outcome: "avoided" | "not_avoided" | "not_applicable" | "abstain";
};

export function decide(_rawInput: any, answers: Record<string, ApiAnswer>): DecideResult {
  const decision = decideImpl(toJevAnswers(answers) as any);

  if (decision.needsHumanReview || decision.outcome === "uncertain") {
    return { outcome: "abstain" };
  }
  if (decision.outcome === "sufficient_notice") return { outcome: "avoided" };
  if (decision.outcome === "insufficient_notice") return { outcome: "not_avoided" };
  if (decision.outcome === "not_applicable") return { outcome: "not_applicable" };
  return { outcome: "abstain" };
}
