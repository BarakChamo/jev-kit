// Combines the Jev answers from questions.json into a notice-sufficiency decision.
// All comparisons (dates, day counts) happen here, in code — never in the Jev questions.

interface ChoiceAnswer {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

interface NoulAnswer {
  noul: number; // probability of "true"
}

export interface JevAnswers {
  effective_date_year: ChoiceAnswer;
  effective_date_month: ChoiceAnswer;
  effective_date_day: ChoiceAnswer;
  term_length_months: ChoiceAnswer;
  required_notice_days: ChoiceAnswer;
  notice_method_allows_email: ChoiceAnswer;
  notice_content_clear: NoulAnswer;
}

export interface CaseState {
  contract_text: string;
  cancellation_email_text: string;
  cancellation_received_date: string; // ISO yyyy-mm-dd, known exactly — never asked to Jev
}

export type NoticeDecision =
  | {
      status: "notice_sufficient" | "notice_insufficient";
      leadTimeDays: number;
      requiredNoticeDays: number;
      termEndDate: string;
      methodOk: boolean;
      contentClear: boolean;
      reasons: string[];
    }
  | {
      status: "needs_review";
      reasons: string[];
      topLabels: Record<string, [string, number][]>; // field -> top two (label, probability)
    };

// A choice answer is trusted only when its top label carries enough probability mass;
// low confidence must escalate, never silently default to a permissive reading.
const CHOICE_CONFIDENCE_FLOOR = 0.6;
const NOUL_LOW = 0.35;
const NOUL_HIGH = 0.65;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function topTwo(probabilities: Record<string, number>): [string, number][] {
  return Object.entries(probabilities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2) as [string, number][];
}

function readChoice(
  answer: ChoiceAnswer,
  reasons: string[],
  topLabels: Record<string, [string, number][]>,
  fieldName: string
): string | null {
  const p = answer.probabilities[answer.choice] ?? answer.confidence;
  if (answer.choice === "unclear" || p < CHOICE_CONFIDENCE_FLOOR) {
    reasons.push(`${fieldName} is unclear or low-confidence (top: ${answer.choice} @ ${p.toFixed(2)})`);
    topLabels[fieldName] = topTwo(answer.probabilities);
    return null;
  }
  return answer.choice;
}

// Steps the effective date forward by termLengthMonths until it lands on or after
// referenceDate — that boundary is the end of the term currently running.
function currentTermEnd(effectiveDate: Date, termLengthMonths: number, referenceDate: Date): Date {
  let boundary = new Date(effectiveDate);
  while (boundary.getTime() < referenceDate.getTime()) {
    boundary = new Date(boundary.getFullYear(), boundary.getMonth() + termLengthMonths, boundary.getDate());
  }
  return boundary;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export function decideNotice(state: CaseState, answers: JevAnswers): NoticeDecision {
  const reasons: string[] = [];
  const topLabels: Record<string, [string, number][]> = {};

  const year = readChoice(answers.effective_date_year, reasons, topLabels, "effective_date_year");
  const monthName = readChoice(answers.effective_date_month, reasons, topLabels, "effective_date_month");
  const day = readChoice(answers.effective_date_day, reasons, topLabels, "effective_date_day");
  const termLength = readChoice(answers.term_length_months, reasons, topLabels, "term_length_months");
  const requiredDaysStr = readChoice(answers.required_notice_days, reasons, topLabels, "required_notice_days");
  const methodChoice = readChoice(answers.notice_method_allows_email, reasons, topLabels, "notice_method_allows_email");

  const noulTrue = answers.notice_content_clear.noul;
  if (noulTrue > NOUL_LOW && noulTrue < NOUL_HIGH) {
    reasons.push(`notice_content_clear is ambiguous (p(true)=${noulTrue.toFixed(2)})`);
  }

  if (year === null || monthName === null || day === null || termLength === null || requiredDaysStr === null) {
    return { status: "needs_review", reasons, topLabels };
  }

  const effectiveDate = new Date(Number(year), MONTHS.indexOf(monthName), Number(day));
  const receivedDate = new Date(state.cancellation_received_date);
  const termEndDate = currentTermEnd(effectiveDate, Number(termLength), receivedDate);
  const leadTimeDays = daysBetween(receivedDate, termEndDate);
  const requiredNoticeDays = Number(requiredDaysStr);

  const methodOk = methodChoice === null ? false : methodChoice === "yes";
  if (methodChoice === "unclear" || methodChoice === null) {
    return { status: "needs_review", reasons: [...reasons, "notice method could not be confirmed"], topLabels };
  }

  if (noulTrue <= NOUL_LOW) {
    return { status: "needs_review", reasons: [...reasons, "cancellation intent is not clearly stated"], topLabels };
  }
  const contentClear = noulTrue >= NOUL_HIGH;
  if (!contentClear) {
    return { status: "needs_review", reasons, topLabels };
  }

  const timingOk = leadTimeDays >= requiredNoticeDays;
  const sufficient = timingOk && methodOk && contentClear;

  if (!timingOk) reasons.push(`only ${leadTimeDays} days' notice given, ${requiredNoticeDays} required`);
  if (!methodOk) reasons.push("contract does not permit notice by email");

  return {
    status: sufficient ? "notice_sufficient" : "notice_insufficient",
    leadTimeDays,
    requiredNoticeDays,
    termEndDate: termEndDate.toISOString().slice(0, 10),
    methodOk,
    contentClear,
    reasons,
  };
}
