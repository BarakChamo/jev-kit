// Decision logic over the answers from questions.json. No network calls here —
// this just consumes the Jev response shape for the "systemone" request in that file.

type NoulAnswer = { noul: number };
type ChoiceAnswer<Opt extends string> = {
  choice: Opt;
  confidence: number;
  probabilities: Record<Opt, number>;
};

type DayBucket =
  | "under_15" | "d15_29" | "d30_44" | "d45_59" | "d60_74" | "d75_89"
  | "d90_119" | "d120_149" | "d150_179" | "d180_239" | "d240_plus";

// Ordered low -> high. Index = rank used for the notice-vs-required comparison.
const BUCKET_ORDER: DayBucket[] = [
  "under_15", "d15_29", "d30_44", "d45_59", "d60_74", "d75_89",
  "d90_119", "d120_149", "d150_179", "d180_239", "d240_plus",
];

type Answers = {
  auto_renewal: NoulAnswer;
  renewal_notice_required: ChoiceAnswer<DayBucket | "not_specified">;
  actual_notice_lead: ChoiceAnswer<DayBucket | "on_or_after">;
  cancellation_clarity: ChoiceAnswer<"clear_cancellation" | "ambiguous" | "not_a_cancellation">;
  delivery_method_ok: NoulAnswer;
};

const TRUE_THRESHOLD = 0.7;
const FALSE_THRESHOLD = 0.3;
const CLARITY_CONFIDENCE_MIN = 0.6;

export type Decision =
  | "NO_AUTO_RENEWAL_CLAUSE"       // nothing to avoid
  | "SUFFICIENT_NOTICE"
  | "INSUFFICIENT_NOTICE"
  | "BORDERLINE_NEEDS_REVIEW"      // required/actual land in the same bucket
  | "AMBIGUOUS_CANCELLATION_TEXT"  // email itself doesn't clearly cancel
  | "UNCERTAIN_NEEDS_REVIEW";      // low-confidence gate tripped

export interface Result {
  decision: Decision;
  reasons: string[];
  flags: { delivery_method_risk: boolean };
}

export function decideNoticeSufficiency(a: Answers): Result {
  const reasons: string[] = [];
  const flags = { delivery_method_risk: false };

  // Low-confidence gate never relaxes toward "sufficient" — it only escalates.
  if (a.cancellation_clarity.confidence < CLARITY_CONFIDENCE_MIN) {
    return {
      decision: "UNCERTAIN_NEEDS_REVIEW",
      reasons: [`cancellation_clarity confidence ${a.cancellation_clarity.confidence.toFixed(2)} below ${CLARITY_CONFIDENCE_MIN}`],
      flags,
    };
  }

  if (a.cancellation_clarity.choice !== "clear_cancellation") {
    reasons.push(`cancellation_clarity=${a.cancellation_clarity.choice}`);
    return { decision: "AMBIGUOUS_CANCELLATION_TEXT", reasons, flags };
  }

  if (a.auto_renewal.noul < FALSE_THRESHOLD) {
    reasons.push(`auto_renewal probability ${a.auto_renewal.noul.toFixed(2)} — no auto-renewal clause found`);
    return { decision: "NO_AUTO_RENEWAL_CLAUSE", reasons, flags };
  }
  if (a.auto_renewal.noul < TRUE_THRESHOLD) {
    return {
      decision: "UNCERTAIN_NEEDS_REVIEW",
      reasons: [`auto_renewal probability ${a.auto_renewal.noul.toFixed(2)} is inconclusive`],
      flags,
    };
  }

  if (a.delivery_method_ok.noul >= TRUE_THRESHOLD) {
    flags.delivery_method_risk = true;
    reasons.push(`delivery_method_ok probability ${a.delivery_method_ok.noul.toFixed(2)} — contract may require a delivery method this email doesn't satisfy`);
  }

  if (a.renewal_notice_required.choice === "not_specified") {
    return {
      decision: "UNCERTAIN_NEEDS_REVIEW",
      reasons: [...reasons, "renewal_notice_required could not be determined from the contract"],
      flags,
    };
  }

  const requiredRank = BUCKET_ORDER.indexOf(a.renewal_notice_required.choice);
  const actualRank =
    a.actual_notice_lead.choice === "on_or_after"
      ? -1
      : BUCKET_ORDER.indexOf(a.actual_notice_lead.choice);

  reasons.push(
    `required=${a.renewal_notice_required.choice} (conf ${a.renewal_notice_required.confidence.toFixed(2)}), ` +
    `actual=${a.actual_notice_lead.choice} (conf ${a.actual_notice_lead.confidence.toFixed(2)})`
  );

  if (actualRank > requiredRank) {
    return { decision: "SUFFICIENT_NOTICE", reasons, flags };
  }
  if (actualRank < requiredRank) {
    return { decision: "INSUFFICIENT_NOTICE", reasons, flags };
  }
  // Same bucket: the day-count granularity can't tell them apart from the required threshold.
  return { decision: "BORDERLINE_NEEDS_REVIEW", reasons, flags };
}
