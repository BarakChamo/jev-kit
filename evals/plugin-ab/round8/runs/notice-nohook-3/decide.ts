// Decision logic for the answers produced by questions.json.
// Jev supplies bucketed facts (rule: compare quantities in code, not in the model);
// this file does the comparison, the confidence gate, and the abstain routing.

type NoulAnswer = number; // probability that criteria.true holds

interface ChoiceAnswer<T extends string> {
  choice: T;
  confidence: number;
  probabilities: Record<T, number>;
}

type RequiredBand =
  | "less_than_30_days"
  | "30_to_59_days"
  | "60_to_89_days"
  | "90_to_179_days"
  | "180_days_or_more"
  | "not_specified_or_ambiguous";

type GivenBand =
  | "on_or_after_renewal_date"
  | "less_than_30_days_before"
  | "30_to_59_days_before"
  | "60_to_89_days_before"
  | "90_to_179_days_before"
  | "180_days_or_more_before"
  | "renewal_date_not_determinable";

export interface JevAnswers {
  has_auto_renewal: NoulAnswer;
  is_cancellation_notice: NoulAnswer;
  required_notice_band: ChoiceAnswer<RequiredBand>;
  notice_lead_time_band: ChoiceAnswer<GivenBand>;
}

export type Outcome =
  | "sufficient_notice"
  | "insufficient_notice"
  | "no_auto_renewal_clause"
  | "needs_human_review";

export interface Decision {
  outcome: Outcome;
  reasons: string[];
}

// Same day boundaries (30/60/90/180) on both bands, so ranks compare directly.
const REQUIRED_RANK: Record<Exclude<RequiredBand, "not_specified_or_ambiguous">, number> = {
  less_than_30_days: 0,
  "30_to_59_days": 1,
  "60_to_89_days": 2,
  "90_to_179_days": 3,
  "180_days_or_more": 4,
};

const GIVEN_RANK: Record<Exclude<GivenBand, "renewal_date_not_determinable">, number> = {
  on_or_after_renewal_date: -1,
  less_than_30_days_before: 0,
  "30_to_59_days_before": 1,
  "60_to_89_days_before": 2,
  "90_to_179_days_before": 3,
  "180_days_or_more_before": 4,
};

const CONFIDENCE_GATE = 0.6; // below this, an unsure choice escalates rather than decides
const NOUL_GATE = 0.7; // symmetric gate for the noul probability-of-true

function isSure(p: number, gate = NOUL_GATE): "true" | "false" | "unsure" {
  if (p >= gate) return "true";
  if (p <= 1 - gate) return "false";
  return "unsure";
}

export function decide(a: JevAnswers): Decision {
  const reasons: string[] = [];

  const autoRenewal = isSure(a.has_auto_renewal);
  if (autoRenewal === "unsure") {
    return { outcome: "needs_human_review", reasons: ["unclear whether the contract auto-renews"] };
  }
  if (autoRenewal === "false") {
    return { outcome: "no_auto_renewal_clause", reasons: ["contract does not auto-renew; notice is moot"] };
  }

  const isNotice = isSure(a.is_cancellation_notice);
  if (isNotice !== "true") {
    reasons.push(
      isNotice === "unsure"
        ? "email does not clearly state cancellation/non-renewal intent"
        : "email is not a cancellation notice",
    );
    return { outcome: "needs_human_review", reasons };
  }

  // Never auto-decide on an unsure choice -- low confidence escalates, it never relaxes the gate.
  if (a.required_notice_band.confidence < CONFIDENCE_GATE) {
    return { outcome: "needs_human_review", reasons: ["low confidence reading the required notice period"] };
  }
  if (a.notice_lead_time_band.confidence < CONFIDENCE_GATE) {
    return { outcome: "needs_human_review", reasons: ["low confidence placing the notice date against the renewal date"] };
  }

  const required = a.required_notice_band.choice;
  const given = a.notice_lead_time_band.choice;

  if (required === "not_specified_or_ambiguous") {
    return { outcome: "needs_human_review", reasons: ["contract does not state a determinate notice period"] };
  }
  if (given === "renewal_date_not_determinable") {
    return { outcome: "needs_human_review", reasons: ["contract does not state a determinable renewal date"] };
  }

  const requiredRank = REQUIRED_RANK[required];
  const givenRank = GIVEN_RANK[given];

  if (requiredRank === givenRank) {
    // Same coarse band on both sides: the bucketing can't tell who's ahead within it.
    return {
      outcome: "needs_human_review",
      reasons: [`notice lead time (${given}) and required notice (${required}) fall in the same band`],
    };
  }

  if (givenRank > requiredRank) {
    return { outcome: "sufficient_notice", reasons: [`notice given ${given}, required ${required}`] };
  }
  return { outcome: "insufficient_notice", reasons: [`notice given ${given}, required ${required}`] };
}
