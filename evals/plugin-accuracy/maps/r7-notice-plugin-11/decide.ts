// Decision logic over the answers to questions.json. Does not call the Jev API.

interface NoulAnswer {
  noul: number; // probability that criteria.true holds
}

interface ChoiceAnswer {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

interface JevAnswers {
  auto_renewal_exists: NoulAnswer;
  required_notice_band: ChoiceAnswer;
  is_cancellation_notice: NoulAnswer;
  notice_method_valid: NoulAnswer;
}

interface CaseInput {
  date_received: string; // ISO date, from the email metadata
  current_term_end_date: string; // ISO date, tracked in our system alongside the contract
}

// Lower bound (days) of each required_notice_band label. "no_minimum_specified" means
// any notice given before the renewal date satisfies the contract.
const REQUIRED_BAND_MIN_DAYS: Record<string, number> = {
  no_minimum_specified: 0,
  under_15: 0,
  "15_29": 15,
  "30_59": 30,
  "60_89": 60,
  "90_179": 90,
  "180_plus": 180,
};

const TRUE_THRESHOLD = 0.7; // gate on the probability of the label we care about, not `confidence`
const CHOICE_CONFIDENCE_FLOOR = 0.6;

export type Verdict =
  | "NOT_APPLICABLE" // no auto-renewal clause to avoid
  | "SUFFICIENT_NOTICE"
  | "INSUFFICIENT_NOTICE"
  | "NEEDS_HUMAN_REVIEW";

export interface Decision {
  verdict: Verdict;
  reasons: string[];
  actualLeadDays: number;
}

function daysBetween(fromIso: string, toIso: string): number {
  const ms = Date.parse(toIso) - Date.parse(fromIso);
  return Math.round(ms / 86_400_000);
}

export function decide(input: CaseInput, answers: JevAnswers): Decision {
  const reasons: string[] = [];

  // Low confidence must never relax the decision — it always routes to human review.
  const autoRenewalP = answers.auto_renewal_exists.noul;
  if (autoRenewalP < TRUE_THRESHOLD && autoRenewalP > 1 - TRUE_THRESHOLD) {
    return {
      verdict: "NEEDS_HUMAN_REVIEW",
      reasons: [`auto_renewal_exists is ambiguous (p=${autoRenewalP.toFixed(2)})`],
      actualLeadDays: NaN,
    };
  }
  if (autoRenewalP <= 1 - TRUE_THRESHOLD) {
    return {
      verdict: "NOT_APPLICABLE",
      reasons: ["contract has no automatic renewal clause; notice timing does not apply"],
      actualLeadDays: NaN,
    };
  }

  const isCancellationP = answers.is_cancellation_notice.noul;
  if (isCancellationP < TRUE_THRESHOLD) {
    return {
      verdict: isCancellationP > 1 - TRUE_THRESHOLD ? "NEEDS_HUMAN_REVIEW" : "INSUFFICIENT_NOTICE",
      reasons: [`email does not clearly state cancellation intent (p=${isCancellationP.toFixed(2)})`],
      actualLeadDays: NaN,
    };
  }

  const methodValidP = answers.notice_method_valid.noul;
  if (methodValidP < TRUE_THRESHOLD) {
    reasons.push(`notice method may not satisfy the contract's form requirement (p=${methodValidP.toFixed(2)})`);
    if (methodValidP > 1 - TRUE_THRESHOLD) {
      return { verdict: "NEEDS_HUMAN_REVIEW", reasons, actualLeadDays: NaN };
    }
  }

  const { choice: requiredBand, probabilities } = answers.required_notice_band;
  const topP = probabilities[requiredBand] ?? 0;
  if (topP < CHOICE_CONFIDENCE_FLOOR || !(requiredBand in REQUIRED_BAND_MIN_DAYS)) {
    return {
      verdict: "NEEDS_HUMAN_REVIEW",
      reasons: [`required_notice_band uncertain (${requiredBand} at p=${topP.toFixed(2)})`],
      actualLeadDays: NaN,
    };
  }
  const requiredMinDays = REQUIRED_BAND_MIN_DAYS[requiredBand];

  const actualLeadDays = daysBetween(input.date_received, input.current_term_end_date);
  const timely = actualLeadDays >= requiredMinDays;
  reasons.push(
    `${actualLeadDays} days of actual lead time vs. required minimum of ${requiredMinDays} days (band: ${requiredBand})`,
  );

  if (methodValidP < TRUE_THRESHOLD) {
    // method is confidently invalid (methodValidP <= 1 - TRUE_THRESHOLD) — notice fails regardless of timing
    return { verdict: "INSUFFICIENT_NOTICE", reasons, actualLeadDays };
  }

  return {
    verdict: timely ? "SUFFICIENT_NOTICE" : "INSUFFICIENT_NOTICE",
    reasons,
    actualLeadDays,
  };
}
