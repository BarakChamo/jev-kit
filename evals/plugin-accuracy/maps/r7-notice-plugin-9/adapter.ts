import questionsJson from "./questions.json";
import { decide as decideCore, JevAnswers } from "./decide";

interface CaseInput {
  id: string;
  input: {
    contract_text: string;
    email_text: string;
    email_from: string;
    received_date: string;
    current_term_end_date: string;
  };
  notes?: string;
}

// Raw shapes exactly as returned by the Jev API.
interface NoulApiAnswer {
  type: "noul";
  noul: boolean | number;
}
interface ChoiceApiAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}
interface ScoreApiAnswer {
  type: "score";
  score: number;
  confidence: number;
  legend: Record<string, unknown>;
  probabilities: Record<string, number>;
}
type ApiAnswer = NoulApiAnswer | ChoiceApiAnswer | ScoreApiAnswer;
type Answers = Record<string, ApiAnswer>;

// A noul's own value carries the fuzzy-true probability; coerce a plain
// boolean into 0/1 for callers (like decide.ts) that expect a number.
function noulProbability(ans: NoulApiAnswer): number {
  return typeof ans.noul === "number" ? ans.noul : ans.noul ? 1 : 0;
}

export function buildState(input: CaseInput) {
  return {
    contract_text: input.input.contract_text,
    cancellation_text: input.input.email_text,
    received_date: input.input.received_date,
  };
}

export function questions(_input: CaseInput) {
  return questionsJson.questions;
}

export function decide(_input: CaseInput, answers: Answers) {
  const a: JevAnswers = {
    clear_intent_to_cancel: noulProbability(answers.clear_intent_to_cancel as NoulApiAnswer),
    auto_renewal_clause: noulProbability(answers.auto_renewal_clause as NoulApiAnswer),
    deadline_determinable: noulProbability(answers.deadline_determinable as NoulApiAnswer),
    required_notice_bucket: {
      choice: (answers.required_notice_bucket as ChoiceApiAnswer).choice,
      confidence: (answers.required_notice_bucket as ChoiceApiAnswer).confidence,
      probabilities: (answers.required_notice_bucket as ChoiceApiAnswer).probabilities,
    } as JevAnswers["required_notice_bucket"],
    actual_notice_bucket: {
      choice: (answers.actual_notice_bucket as ChoiceApiAnswer).choice,
      confidence: (answers.actual_notice_bucket as ChoiceApiAnswer).confidence,
      probabilities: (answers.actual_notice_bucket as ChoiceApiAnswer).probabilities,
    } as JevAnswers["actual_notice_bucket"],
    notice_method_compliant: noulProbability(answers.notice_method_compliant as NoulApiAnswer),
  };

  const result = decideCore(a);

  switch (result.decision) {
    case "NOTICE_SUFFICIENT":
      return { outcome: "avoided" as const };
    case "NOTICE_INSUFFICIENT":
      return { outcome: "not_avoided" as const };
    case "NO_AUTO_RENEWAL_CLAUSE":
      return { outcome: "not_applicable" as const };
    case "NEEDS_HUMAN_REVIEW":
    default:
      return { outcome: "abstain" as const };
  }
}
