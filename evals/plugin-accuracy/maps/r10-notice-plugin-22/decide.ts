// Decision logic for questions.json answers. No API calls here — this just
// consumes the {has_auto_renewal, requests_cancellation, allows_email_notice,
// required_notice_window, actual_notice_window} answer object Jev returns.

type NoulAnswer = { noul: number }; // probability the "true" criterion holds

type WindowBucket =
  | "none_or_unspecified"
  | "up_to_30_days"
  | "31_to_60_days"
  | "61_to_90_days"
  | "91_to_120_days"
  | "over_120_days";

type ActualBucket = "not_determinable" | "on_or_after_renewal_date" | Exclude<WindowBucket, "none_or_unspecified">;

type ChoiceAnswer<T extends string> = { choice: T; confidence: number; probabilities: Record<T, number> };

export interface JevAnswers {
  has_auto_renewal: NoulAnswer;
  requests_cancellation: NoulAnswer;
  allows_email_notice: NoulAnswer;
  required_notice_window: ChoiceAnswer<WindowBucket>;
  actual_notice_window: ChoiceAnswer<ActualBucket>;
}

export type Decision =
  | "sufficient_notice"
  | "insufficient_notice"
  | "no_auto_renewal_clause"
  | "not_a_cancellation_request"
  | "needs_human_review";

export interface Result {
  decision: Decision;
  reason: string;
}

// Ranks used only to compare the two bucketed windows against each other.
// "none_or_unspecified" (required side only) means any positive gap suffices.
const RANK: Record<WindowBucket, number> = {
  none_or_unspecified: 0,
  up_to_30_days: 1,
  "31_to_60_days": 2,
  "61_to_90_days": 3,
  "91_to_120_days": 4,
  over_120_days: 5,
};

const PROB_GATE = 0.75; // gate on the label's own probability, not a confidence scalar

function probTrue(a: NoulAnswer): number {
  return a.noul;
}

function topProb<T extends string>(a: ChoiceAnswer<T>): number {
  return a.probabilities[a.choice];
}

export function decide(answers: JevAnswers): Result {
  const autoRenewProb = probTrue(answers.has_auto_renewal);
  if (autoRenewProb <= 1 - PROB_GATE) {
    return { decision: "no_auto_renewal_clause", reason: "contract likely has no auto-renewal to avoid" };
  }
  if (autoRenewProb < PROB_GATE) {
    return { decision: "needs_human_review", reason: "unclear whether the contract auto-renews" };
  }

  const cancelProb = probTrue(answers.requests_cancellation);
  if (cancelProb <= 1 - PROB_GATE) {
    return { decision: "not_a_cancellation_request", reason: "email does not clearly request cancellation or non-renewal" };
  }
  if (cancelProb < PROB_GATE) {
    return { decision: "needs_human_review", reason: "unclear whether the email requests cancellation" };
  }

  const required = answers.required_notice_window;
  const actual = answers.actual_notice_window;

  if (topProb(required) < PROB_GATE || topProb(actual) < PROB_GATE) {
    return { decision: "needs_human_review", reason: "required notice period or renewal date could not be read confidently" };
  }
  if (actual.choice === "not_determinable") {
    return { decision: "needs_human_review", reason: "contract does not state enough to fix a renewal/term-end date" };
  }
  if (actual.choice === "on_or_after_renewal_date") {
    return { decision: "insufficient_notice", reason: "notice was received on or after the renewal date" };
  }

  const reqRank = RANK[required.choice];
  const actRank = RANK[actual.choice];

  if (reqRank === actRank) {
    return {
      decision: "needs_human_review",
      reason: `required and actual notice both fall in the ${required.choice} band; need exact day counts to resolve`,
    };
  }
  if (actRank < reqRank) {
    return { decision: "insufficient_notice", reason: "notice was given later than the contract requires" };
  }

  // Timely. Now check the method was acceptable.
  const emailOkProb = probTrue(answers.allows_email_notice);
  if (emailOkProb <= 1 - PROB_GATE) {
    return { decision: "insufficient_notice", reason: "notice was timely but the contract does not accept email for this notice" };
  }
  if (emailOkProb < PROB_GATE) {
    return { decision: "needs_human_review", reason: "unclear whether the contract accepts email for this notice" };
  }

  return { decision: "sufficient_notice", reason: "notice was timely and given by an accepted method" };
}
