// Turns the answers to questions.json into a notice-sufficiency verdict.
// Timing is decided by comparing two bucketed quantities in code (per Jev's
// comparison rule), never by asking Jev "was notice on time?" directly.

type NoulAnswer = { noul: number };
type ChoiceAnswer<T extends string> = {
  choice: T;
  confidence: number;
  probabilities: Record<T, number>;
};

type RequiredNoticeBucket =
  | "no_notice_required" | "0-15_days" | "16-30_days" | "31-60_days"
  | "61-90_days" | "91-180_days" | "over_180_days" | "unclear";

type AvailableLeadBucket =
  | "already_past_or_same_day" | "0-15_days" | "16-30_days" | "31-60_days"
  | "61-90_days" | "91-180_days" | "over_180_days" | "unclear";

export type JevAnswers = {
  has_auto_renewal: NoulAnswer;
  required_notice_days: ChoiceAnswer<RequiredNoticeBucket>;
  days_from_notice_to_term_end: ChoiceAnswer<AvailableLeadBucket>;
  clear_cancellation_intent: NoulAnswer;
  requires_specific_delivery_method: NoulAnswer;
};

export type Decision =
  | "SUFFICIENT_NOTICE"      // notice avoids auto-renewal
  | "INSUFFICIENT_NOTICE"    // notice is too late; auto-renewal applies
  | "NO_AUTO_RENEWAL_CLAUSE" // nothing to avoid; question is moot
  | "NEEDS_HUMAN_REVIEW";    // ambiguous intent, low confidence, or boundary case

export interface Verdict {
  decision: Decision;
  reasons: string[];
  flags: string[];
}

// [min, max] days, inclusive; Infinity for open-ended buckets.
const REQUIRED_RANGE: Record<RequiredNoticeBucket, [number, number] | null> = {
  no_notice_required: [0, 0],
  "0-15_days": [0, 15],
  "16-30_days": [16, 30],
  "31-60_days": [31, 60],
  "61-90_days": [61, 90],
  "91-180_days": [91, 180],
  over_180_days: [181, Infinity],
  unclear: null,
};

const AVAILABLE_RANGE: Record<AvailableLeadBucket, [number, number] | null> = {
  already_past_or_same_day: [-Infinity, 0],
  "0-15_days": [0, 15],
  "16-30_days": [16, 30],
  "31-60_days": [31, 60],
  "61-90_days": [61, 90],
  "91-180_days": [91, 180],
  over_180_days: [181, Infinity],
  unclear: null,
};

const CONFIDENCE_THRESHOLD = 0.6; // below this, escalate rather than decide
const RENEWAL_PROB_THRESHOLD = 0.5; // gate on the noul's true-probability
const INTENT_PROB_THRESHOLD = 0.5;

export function decide(answers: JevAnswers): Verdict {
  const reasons: string[] = [];
  const flags: string[] = [];

  if (answers.requires_specific_delivery_method.noul > RENEWAL_PROB_THRESHOLD) {
    flags.push(
      "contract may require a specific delivery method/address for notice; " +
        "verify the email satisfies it"
    );
  }

  if (answers.has_auto_renewal.noul < RENEWAL_PROB_THRESHOLD) {
    reasons.push("contract has no automatic renewal clause requiring notice");
    return { decision: "NO_AUTO_RENEWAL_CLAUSE", reasons, flags };
  }

  if (answers.clear_cancellation_intent.noul < INTENT_PROB_THRESHOLD) {
    reasons.push("email does not clearly express intent to cancel/not renew");
    return { decision: "NEEDS_HUMAN_REVIEW", reasons, flags };
  }

  const required = answers.required_notice_days;
  const available = answers.days_from_notice_to_term_end;

  if (
    required.confidence < CONFIDENCE_THRESHOLD ||
    available.confidence < CONFIDENCE_THRESHOLD ||
    required.choice === "unclear" ||
    available.choice === "unclear"
  ) {
    reasons.push("required notice period or term-end date could not be determined confidently");
    return { decision: "NEEDS_HUMAN_REVIEW", reasons, flags };
  }

  const [, requiredMax] = REQUIRED_RANGE[required.choice]!;
  const [availableMin, availableMax] = AVAILABLE_RANGE[available.choice]!;

  // Conservative: only call it sufficient if the days definitely available
  // (lower bound) cover the worst-case required period (upper bound), and
  // only call it insufficient if even the best case falls short.
  if (availableMin >= requiredMax) {
    reasons.push(
      `notice received ${available.choice} before term end, satisfying required ${required.choice}`
    );
    return { decision: "SUFFICIENT_NOTICE", reasons, flags };
  }
  if (availableMax < requiredMax) {
    reasons.push(
      `notice received ${available.choice} before term end, short of required ${required.choice}`
    );
    return { decision: "INSUFFICIENT_NOTICE", reasons, flags };
  }

  reasons.push(
    `bucketed lead time (${available.choice}) and required notice (${required.choice}) overlap at the boundary`
  );
  return { decision: "NEEDS_HUMAN_REVIEW", reasons, flags };
}
