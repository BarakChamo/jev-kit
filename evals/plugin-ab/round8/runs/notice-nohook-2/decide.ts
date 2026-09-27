// Decision logic for "did the customer give enough notice to avoid auto-renewal?"
// Consumes the answers to the questions in questions.json. Bucket comparison and all
// gating happen here in code — Jev only extracts/judges, never compares two separately
// stated quantities itself.

type NoulAnswer = { noul: number };
type ChoiceAnswer<T extends string> = {
  choice: T;
  confidence: number;
  probabilities: Record<T, number>;
};

type RequiredNoticeBucket =
  | "30_or_fewer" | "31_to_45" | "46_to_60" | "61_to_90" | "91_to_120"
  | "more_than_120" | "not_specified";

type LeadTimeBucket =
  | "30_or_fewer" | "31_to_45" | "46_to_60" | "61_to_90" | "91_to_120"
  | "more_than_120" | "on_or_after_renewal_date" | "cannot_determine";

export interface JevAnswers {
  has_auto_renewal_clause: NoulAnswer;
  is_valid_cancellation_notice: NoulAnswer;
  notice_method_compliant: NoulAnswer;
  required_notice_days: ChoiceAnswer<RequiredNoticeBucket>;
  lead_time_days: ChoiceAnswer<LeadTimeBucket>;
}

export type Decision =
  | "SUFFICIENT_NOTICE"        // notice was timely; renewal should not proceed
  | "INSUFFICIENT_NOTICE"      // notice was late (or never validly given); renewal proceeds
  | "NO_AUTO_RENEWAL_CLAUSE"   // nothing to avoid; question doesn't apply
  | "NOT_A_VALID_NOTICE"       // email doesn't read as a cancellation/non-renewal notice
  | "NEEDS_HUMAN_REVIEW";      // low confidence, or too close to the boundary to call

export interface DecisionResult {
  decision: Decision;
  reasons: string[];
}

// Lower/upper bound in days for each bucket. Both bucket sets share the same
// boundaries so bounds compare directly without re-deriving numbers from text.
const REQUIRED_BOUNDS: Record<Exclude<RequiredNoticeBucket, "not_specified">, [number, number]> = {
  "30_or_fewer": [0, 30],
  "31_to_45": [31, 45],
  "46_to_60": [46, 60],
  "61_to_90": [61, 90],
  "91_to_120": [91, 120],
  more_than_120: [121, Infinity],
};

const LEAD_BOUNDS: Record<Exclude<LeadTimeBucket, "on_or_after_renewal_date" | "cannot_determine">, [number, number]> = {
  "30_or_fewer": [0, 30],
  "31_to_45": [31, 45],
  "46_to_60": [46, 60],
  "61_to_90": [61, 90],
  "91_to_120": [91, 120],
  more_than_120: [121, Infinity],
};

const CONFIDENCE_GATE = 0.65; // below this, a choice answer is too unsure to act on
const NOUL_LOW = 0.35;        // noul in [NOUL_LOW, NOUL_HIGH] is treated as unsure
const NOUL_HIGH = 0.65;

function isUnsureNoul(p: number): boolean {
  return p >= NOUL_LOW && p <= NOUL_HIGH;
}

export function decide(a: JevAnswers): DecisionResult {
  const reasons: string[] = [];

  if (isUnsureNoul(a.has_auto_renewal_clause.noul) || isUnsureNoul(a.is_valid_cancellation_notice.noul)) {
    return { decision: "NEEDS_HUMAN_REVIEW", reasons: ["low confidence on whether an auto-renewal clause or a valid notice exists"] };
  }

  if (a.has_auto_renewal_clause.noul < NOUL_LOW) {
    return { decision: "NO_AUTO_RENEWAL_CLAUSE", reasons: ["contract does not auto-renew"] };
  }

  if (a.is_valid_cancellation_notice.noul < NOUL_LOW) {
    return { decision: "NOT_A_VALID_NOTICE", reasons: ["email does not clearly state intent to cancel/not renew"] };
  }

  if (a.lead_time_days.choice === "cannot_determine" || a.lead_time_days.confidence < CONFIDENCE_GATE) {
    return { decision: "NEEDS_HUMAN_REVIEW", reasons: ["could not reliably determine the applicable renewal date or how far ahead notice was given"] };
  }

  if (a.required_notice_days.choice === "not_specified" || a.required_notice_days.confidence < CONFIDENCE_GATE) {
    return { decision: "NEEDS_HUMAN_REVIEW", reasons: ["contract does not specify a numeric notice period, or extraction was unsure"] };
  }

  if (a.lead_time_days.choice === "on_or_after_renewal_date") {
    reasons.push("notice was received on or after the renewal date");
    return { decision: "INSUFFICIENT_NOTICE", reasons };
  }

  const [reqMin, reqMax] = REQUIRED_BOUNDS[a.required_notice_days.choice];
  const [leadMin, leadMax] = LEAD_BOUNDS[a.lead_time_days.choice];

  if (!a.notice_method_compliant.noul || a.notice_method_compliant.noul < 0.5) {
    reasons.push("notice may not satisfy the contract's method/format requirements (needs review)");
  }

  let decision: Decision;
  if (leadMin >= reqMax) {
    decision = "SUFFICIENT_NOTICE";
    reasons.push(`lead time (${a.lead_time_days.choice}) safely covers required notice (${a.required_notice_days.choice})`);
  } else if (leadMax < reqMin) {
    decision = "INSUFFICIENT_NOTICE";
    reasons.push(`lead time (${a.lead_time_days.choice}) falls short of required notice (${a.required_notice_days.choice})`);
  } else {
    decision = "NEEDS_HUMAN_REVIEW";
    reasons.push(`lead time (${a.lead_time_days.choice}) and required notice (${a.required_notice_days.choice}) are too close to call from buckets alone`);
  }

  // A method-compliance concern never upgrades a decision, but it can downgrade one:
  // uncertain compliance on an otherwise-sufficient notice should go to a human, not auto-pass.
  if (decision === "SUFFICIENT_NOTICE" && a.notice_method_compliant.noul < 0.5) {
    decision = "NEEDS_HUMAN_REVIEW";
  }

  return { decision, reasons };
}
