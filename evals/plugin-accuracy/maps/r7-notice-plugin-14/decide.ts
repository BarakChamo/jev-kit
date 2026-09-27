// Decision logic for questions.json. Jev only returns typed answers (noul / choice / score) —
// all comparisons, thresholds and action selection happen here, not in the questions.

type NoulAnswer = { noul: number };
type ChoiceAnswer<K extends string> = {
  choice: K;
  confidence: number;
  probabilities: Record<K, number>;
};

type Band =
  | "renewal_already_passed"
  | "under_7"
  | "d7_13"
  | "d14_29"
  | "d30_44"
  | "d45_59"
  | "d60_89"
  | "d90_179"
  | "d180_plus"
  | "unclear";

type RequiredBand = Exclude<Band, "renewal_already_passed">;
type LeadBand = Band; // includes renewal_already_passed and unclear

export interface JevAnswers {
  has_auto_renewal: NoulAnswer;
  clear_cancellation_intent: NoulAnswer;
  method_restricted: NoulAnswer;
  required_notice_band: ChoiceAnswer<RequiredBand>;
  lead_time_band: ChoiceAnswer<LeadBand>;
}

export type Decision =
  | "not_applicable" // no auto-renewal clause
  | "sufficient_notice"
  | "insufficient_notice"
  | "needs_human_review";

export interface DecisionResult {
  decision: Decision;
  probSufficientNotice: number; // P(lead_time_band >= required_notice_band), from independent distributions
  reasons: string[];
}

// Ordinal order of the numeric bands shared by required_notice_band and lead_time_band.
// "renewal_already_passed" sorts below every required band (always insufficient).
const NUMERIC_ORDER: RequiredBand[] = [
  "under_7",
  "d7_13",
  "d14_29",
  "d30_44",
  "d45_59",
  "d60_89",
  "d90_179",
  "d180_plus",
];

const HIGH = 0.8;
const LOW = 0.2;
const CONFIDENT_FLAG = 0.7; // threshold for the noul flags below

function isNumericBand(b: Band): b is RequiredBand {
  return NUMERIC_ORDER.includes(b as RequiredBand);
}

// P(lead >= required), treating the two choice answers as independent distributions
// (the API answers each question independently, so this is a valid joint probability).
function probSufficient(
  required: ChoiceAnswer<RequiredBand>,
  lead: ChoiceAnswer<LeadBand>
): number {
  let p = 0;
  for (const [leadBand, leadP] of Object.entries(lead.probabilities) as [LeadBand, number][]) {
    if (!isNumericBand(leadBand)) continue; // "renewal_already_passed" / "unclear" never count as sufficient
    const leadIdx = NUMERIC_ORDER.indexOf(leadBand);
    for (const [reqBand, reqP] of Object.entries(required.probabilities) as [
      RequiredBand,
      number
    ][]) {
      if (!isNumericBand(reqBand)) continue; // "unclear" required band contributes no mass either way
      const reqIdx = NUMERIC_ORDER.indexOf(reqBand);
      if (leadIdx >= reqIdx) p += leadP * reqP;
    }
  }
  return p;
}

export function decide(a: JevAnswers): DecisionResult {
  const reasons: string[] = [];

  if (a.has_auto_renewal.noul < 1 - CONFIDENT_FLAG) {
    return {
      decision: "not_applicable",
      probSufficientNotice: 1,
      reasons: ["contract has no auto-renewal clause"],
    };
  }
  if (a.has_auto_renewal.noul < CONFIDENT_FLAG) {
    reasons.push("uncertain whether the contract auto-renews");
  }

  if (a.required_notice_band.probabilities.unclear > 0.3) {
    reasons.push("required notice period could not be pinned down from the contract");
  }
  if (a.lead_time_band.probabilities.unclear > 0.3) {
    reasons.push("could not place the cancellation date relative to the renewal date");
  }
  if (a.lead_time_band.choice === "renewal_already_passed") {
    reasons.push("renewal/term-end date appears to have already passed when notice was received");
  }

  if (a.clear_cancellation_intent.noul < CONFIDENT_FLAG) {
    reasons.push("email does not clearly state intent to cancel / not renew");
  }
  if (a.method_restricted.noul > CONFIDENT_FLAG) {
    reasons.push("contract may require a delivery method a plain email does not satisfy");
  }

  const pSufficient = probSufficient(a.required_notice_band, a.lead_time_band);

  // Low confidence never relaxes the decision: anything uncertain or flagged goes to review.
  const uncertain =
    reasons.length > 0 || (pSufficient > LOW && pSufficient < HIGH);

  let decision: Decision;
  if (uncertain) {
    decision = "needs_human_review";
  } else if (pSufficient >= HIGH) {
    decision = "sufficient_notice";
  } else {
    decision = "insufficient_notice";
  }

  return { decision, probSufficientNotice: pSufficient, reasons };
}
