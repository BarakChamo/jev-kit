// Decision logic for: "did the customer give enough notice to avoid auto-renewal?"
// Consumes the answers to questions.json. Comparison and combination happen here in code
// (rule: Jev buckets quantities, code compares them) — Jev never sees the two numbers together.

type NoulAnswer = { noul: number }; // probability the "true" criterion holds
type ChoiceAnswer<Opt extends string> = {
  choice: Opt;
  confidence: number;
  probabilities: Record<Opt, number>;
};

type NoticeDaysBucket =
  | "none" | "1_15" | "16_30" | "31_45" | "46_60" | "61_90" | "91_120" | "121_plus" | "unclear";
type TermEndBucket =
  | "already_ended" | "0_15" | "16_30" | "31_45" | "46_60" | "61_90" | "91_120" | "121_plus" | "unclear";

export type SystemOneAnswers = {
  has_auto_renewal: NoulAnswer;
  required_notice_days: ChoiceAnswer<NoticeDaysBucket>;
  term_end_relative_to_email: ChoiceAnswer<TermEndBucket>;
  notice_method_valid: NoulAnswer;
};

export type Decision =
  | { outcome: "NO_AUTO_RENEWAL"; reason: string }
  | { outcome: "SUFFICIENT_NOTICE"; probability: number; reason: string }
  | { outcome: "INSUFFICIENT_NOTICE"; probability: number; reason: string }
  | { outcome: "NEEDS_HUMAN_REVIEW"; probability: number | null; reason: string };

// Representative day-value for each bucket (midpoint of the range), used only to combine
// two independent Jev distributions into one sufficiency probability.
const NOTICE_DAYS_MIDPOINT: Record<Exclude<NoticeDaysBucket, "unclear">, number> = {
  none: 0, "1_15": 8, "16_30": 23, "31_45": 38, "46_60": 53, "61_90": 75, "91_120": 105, "121_plus": 150,
};
const TERM_END_MIDPOINT: Record<Exclude<TermEndBucket, "unclear">, number> = {
  already_ended: -30, "0_15": 8, "16_30": 23, "31_45": 38, "46_60": 53, "61_90": 75, "91_120": 105, "121_plus": 150,
};

const AUTO_RENEWAL_APPLIES_MIN = 0.7; // below this, treat as "no auto-renewal clause"
const AUTO_RENEWAL_NOT_APPLIES_MAX = 0.3;
const SUFFICIENT_THRESHOLD = 0.8;
const INSUFFICIENT_THRESHOLD = 0.2;
const MAX_UNCLEAR_MASS = 0.3; // above this, the buckets are too uncertain to decide automatically

/**
 * P(term end is at least as many days after email_received_date as the required notice period),
 * i.e. P(notice was timely), computed by pairing the two independent Jev distributions.
 * Renormalized over the probability mass that isn't "unclear" on either side.
 */
function timingSufficiencyProbability(
  required: ChoiceAnswer<NoticeDaysBucket>,
  termEnd: ChoiceAnswer<TermEndBucket>
): { probability: number | null; unclearMass: number } {
  const unclearMass =
    (required.probabilities.unclear ?? 0) + (termEnd.probabilities.unclear ?? 0)
    - (required.probabilities.unclear ?? 0) * (termEnd.probabilities.unclear ?? 0);

  let sufficientMass = 0;
  let totalMass = 0;
  for (const [rBucket, rProb] of Object.entries(required.probabilities) as [NoticeDaysBucket, number][]) {
    if (rBucket === "unclear" || rProb <= 0) continue;
    for (const [tBucket, tProb] of Object.entries(termEnd.probabilities) as [TermEndBucket, number][]) {
      if (tBucket === "unclear" || tProb <= 0) continue;
      const jointMass = rProb * tProb;
      totalMass += jointMass;
      const requiredDays = NOTICE_DAYS_MIDPOINT[rBucket];
      const termEndDays = TERM_END_MIDPOINT[tBucket];
      if (termEndDays >= requiredDays) sufficientMass += jointMass;
    }
  }

  return { probability: totalMass > 0 ? sufficientMass / totalMass : null, unclearMass };
}

export function decideNoticeSufficiency(answers: SystemOneAnswers): Decision {
  const autoRenewalProb = answers.has_auto_renewal.noul;

  if (autoRenewalProb <= AUTO_RENEWAL_NOT_APPLIES_MAX) {
    return {
      outcome: "NO_AUTO_RENEWAL",
      reason: "Contract does not appear to auto-renew; no notice deadline applies.",
    };
  }
  if (autoRenewalProb < AUTO_RENEWAL_APPLIES_MIN) {
    return {
      outcome: "NEEDS_HUMAN_REVIEW",
      probability: null,
      reason: `Whether the contract auto-renews at all is unclear (p=${autoRenewalProb.toFixed(2)}).`,
    };
  }

  const { probability: timingProb, unclearMass } = timingSufficiencyProbability(
    answers.required_notice_days,
    answers.term_end_relative_to_email
  );

  if (timingProb === null || unclearMass > MAX_UNCLEAR_MASS) {
    return {
      outcome: "NEEDS_HUMAN_REVIEW",
      probability: timingProb,
      reason: "Required notice period or current term end date cannot be reliably read from the contract.",
    };
  }

  // Short conjunction of two reliable, independent facts — safe to combine in code (not ask Jev).
  const methodProb = answers.notice_method_valid.noul;
  const overallProb = timingProb * methodProb;

  if (overallProb >= SUFFICIENT_THRESHOLD) {
    return {
      outcome: "SUFFICIENT_NOTICE",
      probability: overallProb,
      reason: "Notice was timely and satisfies the contract's method/recipient requirements.",
    };
  }
  if (overallProb <= INSUFFICIENT_THRESHOLD) {
    return {
      outcome: "INSUFFICIENT_NOTICE",
      probability: overallProb,
      reason: timingProb <= INSUFFICIENT_THRESHOLD
        ? "Notice was not given far enough before the term end date."
        : "Notice was timely but does not satisfy the contract's required method/recipient.",
    };
  }
  return {
    outcome: "NEEDS_HUMAN_REVIEW",
    probability: overallProb,
    reason: `Borderline case (p=${overallProb.toFixed(2)}); route to a human before applying the auto-renewal charge.`,
  };
}
