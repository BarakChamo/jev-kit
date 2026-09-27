// Decision logic for "did this cancellation give enough notice to avoid auto-renewal?"
// Runs on the answers to questions.json. Does not call Jev itself.

type NoulAnswer = { noul: number }; // probability the "true" criterion holds
type ChoiceAnswer<Opt extends string> = {
  choice: Opt;
  confidence: number;
  probabilities: Record<Opt, number>;
};

type RequiredBucket =
  | "none" | "up_to_15_days" | "16_to_30_days" | "31_to_60_days"
  | "61_to_90_days" | "over_90_days" | "unspecified";

type ActualBucket =
  | "on_or_after" | "up_to_15_days" | "16_to_30_days" | "31_to_60_days"
  | "61_to_90_days" | "over_90_days" | "unknown";

export interface Answers {
  has_auto_renewal: NoulAnswer;
  notice_method_valid: NoulAnswer;
  states_cancellation_intent: NoulAnswer;
  claims_earlier_notice: NoulAnswer;
  required_notice_bucket: ChoiceAnswer<RequiredBucket>;
  actual_notice_bucket: ChoiceAnswer<ActualBucket>;
}

export type Decision =
  | "sufficient_notice"          // avoided auto-renewal
  | "insufficient_notice"        // auto-renewal stands
  | "no_auto_renewal_clause"     // question moot
  | "needs_human_review";        // Jev was unsure, or the case is disputed/ambiguous

export interface Result {
  decision: Decision;
  reasons: string[];
}

// Gate on the probability of the label we care about (rule 8), not the confidence scalar.
const NOUL_GATE = 0.75;
const CHOICE_GATE = 0.75;

// Numeric rank so "was the actual notice period >= the required one" is a plain comparison
// in code (rule 5), not a question we ask Jev.
const RANK: Record<Exclude<RequiredBucket, "none" | "unspecified">, number> = {
  up_to_15_days: 1,
  "16_to_30_days": 2,
  "31_to_60_days": 3,
  "61_to_90_days": 4,
  over_90_days: 5,
};

function isConfidentTrue(a: NoulAnswer): boolean {
  return a.noul >= NOUL_GATE;
}
function isConfidentFalse(a: NoulAnswer): boolean {
  return a.noul <= 1 - NOUL_GATE;
}
function isConfidentChoice<Opt extends string>(a: ChoiceAnswer<Opt>): boolean {
  return a.probabilities[a.choice] >= CHOICE_GATE;
}

export function decide(a: Answers): Result {
  const reasons: string[] = [];

  // Low confidence never relaxes the decision (rule: "Low confidence must never
  // relax a decision") — any unsure signal below routes straight to human review.
  if (!isConfidentTrue(a.has_auto_renewal) && !isConfidentFalse(a.has_auto_renewal)) {
    return { decision: "needs_human_review", reasons: ["unsure whether the contract auto-renews"] };
  }
  if (isConfidentFalse(a.has_auto_renewal)) {
    return { decision: "no_auto_renewal_clause", reasons: ["contract has no auto-renewal clause"] };
  }

  if (isConfidentTrue(a.claims_earlier_notice)) {
    // Detector for a manipulable claim (rule 10): the email's stated date is no longer
    // trustworthy as "the" notice date, so the timing comparison below can't be trusted either.
    return {
      decision: "needs_human_review",
      reasons: ["email claims notice was already given earlier than the received date; verify independently"],
    };
  }

  if (!isConfidentTrue(a.states_cancellation_intent)) {
    reasons.push("email does not clearly state cancellation/non-renewal intent");
    return { decision: "needs_human_review", reasons };
  }

  if (isConfidentFalse(a.notice_method_valid)) {
    return {
      decision: "insufficient_notice",
      reasons: ["contract requires a different, exclusive notice method than email"],
    };
  }
  if (!isConfidentTrue(a.notice_method_valid)) {
    return { decision: "needs_human_review", reasons: ["unsure whether email is a valid notice method"] };
  }

  if (!isConfidentChoice(a.required_notice_bucket) || !isConfidentChoice(a.actual_notice_bucket)) {
    return { decision: "needs_human_review", reasons: ["low confidence reading required or actual notice period"] };
  }

  const required = a.required_notice_bucket.choice;
  const actual = a.actual_notice_bucket.choice;

  if (required === "unspecified" || actual === "unknown") {
    return {
      decision: "needs_human_review",
      reasons: ["could not determine the required notice period or the renewal/term-end date from the contract"],
    };
  }

  if (actual === "on_or_after") {
    return { decision: "insufficient_notice", reasons: ["email received on or after the renewal/term-end date"] };
  }
  if (required === "none") {
    return { decision: "sufficient_notice", reasons: ["contract requires no minimum notice period"] };
  }

  const ok = RANK[actual] >= RANK[required];
  reasons.push(`required: ${required}, actual: ${actual}`);
  return { decision: ok ? "sufficient_notice" : "insufficient_notice", reasons };
}
