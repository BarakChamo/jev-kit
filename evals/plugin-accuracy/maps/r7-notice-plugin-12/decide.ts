// Decision logic for questions.json.
//
// `current_term_end_date` is assumed to already be known (e.g. from billing/CRM),
// not extracted from contract_text: Jev's typed questions can bucket a stated
// notice PERIOD reliably, but pulling an arbitrary absolute calendar date out of
// free text isn't a good fit for noul/choice/score, so that fact is supplied as
// a plain input alongside received_date rather than asked as a question.

type NoulAnswer = { noul: number };
type ChoiceAnswer<T extends string> = {
  choice: T;
  confidence: number;
  probabilities: Record<T, number>;
};

type NoticePeriod =
  | "15_days" | "30_days" | "45_days" | "60_days"
  | "90_days" | "120_days" | "180_days" | "not_specified";
type NoticeUnit = "calendar_days" | "business_days" | "not_specified";

export interface Answers {
  auto_renewal_present: NoulAnswer;
  notice_period: ChoiceAnswer<NoticePeriod>;
  notice_period_unit: ChoiceAnswer<NoticeUnit>;
  email_channel_allowed: NoulAnswer;
  email_content_sufficient: NoulAnswer;
}

export interface CancellationCase {
  received_date: string; // ISO yyyy-mm-dd
  current_term_end_date: string; // ISO yyyy-mm-dd, known from billing/CRM
}

export type Decision =
  | { verdict: "no_auto_renewal_clause" }
  | { verdict: "sufficient_notice"; deadline: string }
  | { verdict: "insufficient_notice"; deadline: string; reason: string }
  | { verdict: "needs_human_review"; reason: string };

// Gate on the probability of the label we care about (rule 8), not the confidence scalar.
const NOUL_HIGH = 0.85;
const NOUL_LOW = 0.15;
const CHOICE_MIN_PROB = 0.7;

const NOTICE_DAYS: Record<NoticePeriod, number | null> = {
  "15_days": 15, "30_days": 30, "45_days": 45, "60_days": 60,
  "90_days": 90, "120_days": 120, "180_days": 180, not_specified: null,
};

function noulState(p: number): "true" | "false" | "uncertain" {
  if (p >= NOUL_HIGH) return "true";
  if (p <= NOUL_LOW) return "false";
  return "uncertain";
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function decide(a: Answers, c: CancellationCase): Decision {
  const autoRenewal = noulState(a.auto_renewal_present.noul);
  if (autoRenewal === "false") return { verdict: "no_auto_renewal_clause" };
  if (autoRenewal === "uncertain") {
    return { verdict: "needs_human_review", reason: "unclear whether the contract auto-renews at all" };
  }

  // Comparison of two quantities (required notice vs. time actually given) is
  // done here in code (rule 5), not asked of Jev as a single "was it on time?" question.
  if (a.notice_period.probabilities[a.notice_period.choice] < CHOICE_MIN_PROB) {
    return { verdict: "needs_human_review", reason: "required notice period is unclear from the contract" };
  }
  const requiredDays = NOTICE_DAYS[a.notice_period.choice];
  if (requiredDays === null) {
    return { verdict: "needs_human_review", reason: "contract does not state a notice period" };
  }

  let effectiveDays = requiredDays;
  if (a.notice_period_unit.choice === "business_days") {
    effectiveDays = Math.ceil((requiredDays * 7) / 5); // approx business -> calendar days
  }

  const deadline = addDaysIso(c.current_term_end_date, -effectiveDays);
  const onTime = c.received_date <= deadline; // ISO strings sort lexicographically

  const channelOk = noulState(a.email_channel_allowed.noul);
  const contentOk = noulState(a.email_content_sufficient.noul);
  if (channelOk === "uncertain" || contentOk === "uncertain") {
    return { verdict: "needs_human_review", reason: "unclear whether the email itself counts as valid notice" };
  }

  if (!onTime) {
    return { verdict: "insufficient_notice", deadline, reason: "received after the notice deadline" };
  }
  if (channelOk === "false") {
    return { verdict: "insufficient_notice", deadline, reason: "email is not a permitted notice channel under the contract" };
  }
  if (contentOk === "false") {
    return { verdict: "insufficient_notice", deadline, reason: "email does not clearly state cancellation/non-renewal" };
  }
  return { verdict: "sufficient_notice", deadline };
}
