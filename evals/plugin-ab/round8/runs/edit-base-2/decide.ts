// Decision logic for the answers to questions.json. Pure function, no network calls.

type NoulAnswer = { probability: number }; // P(criteria.true)
type ChoiceAnswer<Opt extends string = string> = {
  choice: Opt;
  confidence: number;
  probabilities: Record<Opt, number>;
};

type NoticeWindow =
  | "none" | "1_15_days" | "16_30_days" | "31_60_days"
  | "61_90_days" | "over_90_days" | "unclear";

export interface JevAnswers {
  auto_renewal_clause: NoulAnswer;
  required_notice_window: ChoiceAnswer<NoticeWindow>;
  notice_method_compliant: NoulAnswer;
  sender_is_authorized_contact: NoulAnswer;
  cancellation_intent_clear: NoulAnswer;
  notice_timely: NoulAnswer;
}

export type Verdict =
  | "NOT_APPLICABLE"       // no auto-renewal clause; nothing to avoid
  | "SUFFICIENT_NOTICE"    // customer avoided auto-renewal
  | "INSUFFICIENT_NOTICE"  // customer will auto-renew
  | "NEEDS_HUMAN_REVIEW";  // model too unsure on a gating question

export interface Decision {
  verdict: Verdict;
  confidence: number; // 0-1, distance of the deciding answer(s) from the uncertainty band
  reasons: string[];
  noticeWindow: { window: NoticeWindow; confidence: number };
}

// Above TRUE_THRESHOLD counts as "true"; below FALSE_THRESHOLD counts as "false";
// in between is treated as too uncertain to act on automatically.
const TRUE_THRESHOLD = 0.65;
const FALSE_THRESHOLD = 0.35;

type Tri = "true" | "false" | "uncertain";

function classify(p: number): Tri {
  if (p >= TRUE_THRESHOLD) return "true";
  if (p <= FALSE_THRESHOLD) return "false";
  return "uncertain";
}

// distance from the nearest threshold, scaled to 0-1, as a rough confidence proxy
function certainty(p: number): number {
  const cls = classify(p);
  if (cls === "uncertain") return 0;
  const edge = cls === "true" ? TRUE_THRESHOLD : FALSE_THRESHOLD;
  const span = cls === "true" ? 1 - TRUE_THRESHOLD : FALSE_THRESHOLD;
  return Math.min(1, Math.abs(p - edge) / span);
}

export function decide(a: JevAnswers): Decision {
  const noticeWindow = {
    window: a.required_notice_window.choice,
    confidence: a.required_notice_window.confidence,
  };

  const hasRenewal = classify(a.auto_renewal_clause.probability);
  if (hasRenewal === "false") {
    return {
      verdict: "NOT_APPLICABLE",
      confidence: certainty(a.auto_renewal_clause.probability),
      reasons: ["Contract has no automatic renewal clause; notice timing is moot."],
      noticeWindow,
    };
  }

  // Gating questions that must all be affirmatively "true" for notice to be sufficient.
  const gates: Array<[keyof JevAnswers, string]> = [
    ["notice_timely", "Notice was not received early enough to meet the contract's window."],
    ["cancellation_intent_clear", "The cancellation message does not clearly express intent to cancel."],
    ["notice_method_compliant", "The notice does not satisfy the contract's required delivery method/form."],
    ["sender_is_authorized_contact", "The cancellation was not sent from an address the contract recognizes as an authorized contact."],
  ];

  const failed = gates.filter(([key]) => classify(a[key].probability) === "false");
  const uncertain = gates.filter(([key]) => classify(a[key].probability) === "uncertain");

  if (failed.length > 0) {
    return {
      verdict: "INSUFFICIENT_NOTICE",
      confidence: Math.min(...failed.map(([key]) => certainty(a[key].probability))),
      reasons: failed.map(([, reason]) => reason),
      noticeWindow,
    };
  }

  if (uncertain.length > 0) {
    return {
      verdict: "NEEDS_HUMAN_REVIEW",
      confidence: 0,
      reasons: uncertain.map(([key]) => `Low-confidence answer on "${key}" (p=${a[key].probability.toFixed(2)}); needs human review.`),
      noticeWindow,
    };
  }

  return {
    verdict: "SUFFICIENT_NOTICE",
    confidence: Math.min(...gates.map(([key]) => certainty(a[key].probability))),
    reasons: ["Notice was timely, unambiguous, and met the contract's delivery requirements."],
    noticeWindow,
  };
}
