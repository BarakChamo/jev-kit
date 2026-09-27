// Decision logic for the answers produced by questions.json.
// Jev supplies the reading-comprehension judgments (buckets, true/false probabilities);
// all comparison and thresholding happens here, per the bucketed-comparison pattern
// (never ask Jev "was notice on time?" directly).

type NoulAnswer = { noul: number };
type ChoiceAnswer<C extends string> = {
  choice: C;
  confidence: number;
  probabilities: Record<C, number>;
};

type DayBucket =
  | "none"
  | "under_30"
  | "30_to_59"
  | "60_to_89"
  | "90_to_119"
  | "120_plus"
  | "unclear";

type AvailableBucket =
  | "already_renewed_or_passed"
  | "under_30"
  | "30_to_59"
  | "60_to_89"
  | "90_to_119"
  | "120_plus"
  | "unclear";

export interface Answers {
  auto_renewal_present: NoulAnswer;
  notice_period_days: ChoiceAnswer<DayBucket>;
  days_until_renewal_at_receipt: ChoiceAnswer<AvailableBucket>;
  cancellation_intent_clear: NoulAnswer;
  email_method_permitted: NoulAnswer;
}

export type Decision =
  | "SUFFICIENT_NOTICE" // customer avoided renewal
  | "INSUFFICIENT_NOTICE" // renewal proceeds
  | "NO_AUTO_RENEWAL" // nothing to avoid
  | "NEEDS_REVIEW";

export interface Result {
  decision: Decision;
  reasons: string[];
}

const CONFIDENT_TRUE = 0.65;
const CONFIDENT_FALSE = 0.35;

// Lower-bound day count for each bucket. Using the lower bound in both the
// required and the available comparison means a same-bucket case is a tie,
// not a false pass — handled as a review case below rather than trusted here.
const BUCKET_DAYS: Record<DayBucket | AvailableBucket, number | null> = {
  already_renewed_or_passed: -1,
  none: 0,
  under_30: 0,
  "30_to_59": 30,
  "60_to_89": 60,
  "90_to_119": 90,
  "120_plus": 120,
  unclear: null,
};

function topTwo<C extends string>(answer: ChoiceAnswer<C>): string {
  const entries = Object.entries(answer.probabilities) as [C, number][];
  entries.sort((a, b) => b[1] - a[1]);
  return entries
    .slice(0, 2)
    .map(([label, p]) => `${label} (${p.toFixed(2)})`)
    .join(", ");
}

export function decide(a: Answers): Result {
  const reasons: string[] = [];
  const review: string[] = [];

  // 1. Is there an auto-renewal to avoid at all?
  const pAutoRenew = a.auto_renewal_present.noul;
  if (pAutoRenew <= CONFIDENT_FALSE) {
    return {
      decision: "NO_AUTO_RENEWAL",
      reasons: [`contract likely has no auto-renewal clause (p=${pAutoRenew.toFixed(2)})`],
    };
  }
  if (pAutoRenew < CONFIDENT_TRUE) {
    review.push(`auto_renewal_present is ambiguous (p=${pAutoRenew.toFixed(2)})`);
  }

  // 2. Does the email actually give notice of cancellation/non-renewal?
  const pIntent = a.cancellation_intent_clear.noul;
  if (pIntent <= CONFIDENT_FALSE) {
    return {
      decision: "INSUFFICIENT_NOTICE",
      reasons: [`email does not clearly state cancellation/non-renewal intent (p=${pIntent.toFixed(2)})`],
    };
  }
  if (pIntent < CONFIDENT_TRUE) {
    review.push(`cancellation_intent_clear is ambiguous (p=${pIntent.toFixed(2)})`);
  }

  // 3. Is email a permitted notice method under the contract?
  const pMethod = a.email_method_permitted.noul;
  if (pMethod <= CONFIDENT_FALSE) {
    return {
      decision: "INSUFFICIENT_NOTICE",
      reasons: [`contract requires a different, exclusive notice method (p=${pMethod.toFixed(2)})`],
    };
  }
  if (pMethod < CONFIDENT_TRUE) {
    review.push(`email_method_permitted is ambiguous (p=${pMethod.toFixed(2)})`);
  }

  // 4. Timing: compare required notice length against time actually available,
  // both read as buckets, compared here rather than asked directly.
  const requiredBucket = a.notice_period_days.choice;
  const availableBucket = a.days_until_renewal_at_receipt.choice;
  const requiredDays = BUCKET_DAYS[requiredBucket];
  const availableDays = BUCKET_DAYS[availableBucket];

  if (requiredDays === null) {
    review.push(`notice_period_days unclear: top choices ${topTwo(a.notice_period_days)}`);
  }
  if (availableDays === null) {
    review.push(`days_until_renewal_at_receipt unclear: top choices ${topTwo(a.days_until_renewal_at_receipt)}`);
  }

  let timingSufficient: boolean | null = null;
  if (requiredDays !== null && availableDays !== null) {
    if (requiredBucket === availableBucket) {
      // Same bucket: the lower-bound comparison can't tell them apart.
      review.push(`required and available notice both fall in bucket "${requiredBucket}" — too close to call from buckets alone`);
    } else {
      timingSufficient = availableDays >= requiredDays;
      reasons.push(
        `required ${requiredBucket} (>=${requiredDays}d), available ${availableBucket} (>=${availableDays}d) -> ${
          timingSufficient ? "on time" : "late"
        }`
      );
    }
  }

  if (a.notice_period_days.confidence < CONFIDENT_TRUE) {
    review.push(`low confidence on notice_period_days: top choices ${topTwo(a.notice_period_days)}`);
  }
  if (a.days_until_renewal_at_receipt.confidence < CONFIDENT_TRUE) {
    review.push(`low confidence on days_until_renewal_at_receipt: top choices ${topTwo(a.days_until_renewal_at_receipt)}`);
  }

  if (review.length > 0) {
    return { decision: "NEEDS_REVIEW", reasons: review };
  }

  if (timingSufficient === false) {
    return { decision: "INSUFFICIENT_NOTICE", reasons };
  }
  return { decision: "SUFFICIENT_NOTICE", reasons };
}
