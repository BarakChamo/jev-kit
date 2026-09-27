// Turns the answers to questions.json into a per-cancellation notice decision.
// Bucket labels are shared between required_notice_days and days_until_renewal so the
// comparison in code (rule: "compare quantities in code, ask for them as buckets") is just
// a lookup of each bucket's representative day count.

type NoulAnswer = { noul: number };
type ChoiceAnswer<Opt extends string> = {
  choice: Opt;
  confidence: number;
  probabilities: Record<Opt, number>;
};

type DayBucket =
  | "0_days" | "1_7_days" | "8_14_days" | "15_30_days" | "31_45_days"
  | "46_60_days" | "61_90_days" | "91_180_days" | "over_180_days" | "undeterminable";

export interface JevAnswers {
  is_cancellation_notice: NoulAnswer;
  has_auto_renewal_clause: NoulAnswer;
  notice_method_valid: NoulAnswer;
  required_notice_days: ChoiceAnswer<DayBucket>;
  days_until_renewal: ChoiceAnswer<DayBucket>;
}

// Representative day count per bucket (lower bound, except "over_180" and "undeterminable").
const BUCKET_DAYS: Record<Exclude<DayBucket, "undeterminable">, number> = {
  "0_days": 0,
  "1_7_days": 1,
  "8_14_days": 8,
  "15_30_days": 15,
  "31_45_days": 31,
  "46_60_days": 46,
  "61_90_days": 61,
  "91_180_days": 91,
  "over_180_days": 181,
};

// Below this, treat a noul/choice answer as "unsure" and escalate rather than decide.
const CONFIDENCE_GATE = 0.75;
// If required vs. actual notice land within one bucket-width of each other, the buckets
// are too coarse to call it — escalate instead of guessing which side of the line it's on.
const CLOSE_CALL_DAYS = 15;

export type Decision =
  | { outcome: "sufficient_notice" | "insufficient_notice"; requiredDays: number; actualDays: number }
  | { outcome: "no_renewal_clause" }
  | { outcome: "invalid_notice_method" }
  | { outcome: "not_a_cancellation" }
  | { outcome: "needs_human_review"; reason: string };

export function decide(a: JevAnswers): Decision {
  if (a.is_cancellation_notice.noul < CONFIDENCE_GATE) {
    return { outcome: "not_a_cancellation" };
  }

  if (a.has_auto_renewal_clause.noul < 1 - CONFIDENCE_GATE) {
    return { outcome: "no_renewal_clause" };
  }
  if (a.has_auto_renewal_clause.noul < CONFIDENCE_GATE) {
    return { outcome: "needs_human_review", reason: "unclear whether an auto-renewal clause applies" };
  }

  if (a.required_notice_days.confidence < CONFIDENCE_GATE
    || a.days_until_renewal.confidence < CONFIDENCE_GATE
    || a.required_notice_days.choice === "undeterminable"
    || a.days_until_renewal.choice === "undeterminable") {
    return { outcome: "needs_human_review", reason: "notice period or renewal date could not be pinned down" };
  }

  if (a.notice_method_valid.noul < 1 - CONFIDENCE_GATE) {
    return { outcome: "invalid_notice_method" };
  }
  if (a.notice_method_valid.noul < CONFIDENCE_GATE) {
    return { outcome: "needs_human_review", reason: "unclear whether email satisfies the contract's required notice method" };
  }

  const requiredDays = BUCKET_DAYS[a.required_notice_days.choice];
  const actualDays = BUCKET_DAYS[a.days_until_renewal.choice];

  if (Math.abs(actualDays - requiredDays) <= CLOSE_CALL_DAYS) {
    return { outcome: "needs_human_review", reason: `required (${requiredDays}d) and actual (${actualDays}d) notice are too close to call` };
  }

  return actualDays >= requiredDays
    ? { outcome: "sufficient_notice", requiredDays, actualDays }
    : { outcome: "insufficient_notice", requiredDays, actualDays };
}
