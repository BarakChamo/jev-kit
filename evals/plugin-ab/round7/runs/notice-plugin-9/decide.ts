// Decision logic for questions.json. Runs on the `answers` returned by the Jev
// systemone call for one (contract, cancellation) case.

type NoulAnswer = number; // probability that the "true" criterion holds

interface ChoiceAnswer<T extends string> {
  choice: T;
  confidence: number;
  probabilities: Record<T, number>;
}

type RequiredBucket =
  | "0_to_14_days"
  | "15_to_29_days"
  | "30_to_59_days"
  | "60_to_89_days"
  | "90_to_179_days"
  | "180_plus_days"
  | "not_specified";

type ActualBucket =
  | "after_deadline"
  | "0_to_14_days"
  | "15_to_29_days"
  | "30_to_59_days"
  | "60_to_89_days"
  | "90_to_179_days"
  | "180_plus_days";

export interface JevAnswers {
  clear_intent_to_cancel: NoulAnswer;
  auto_renewal_clause: NoulAnswer;
  deadline_determinable: NoulAnswer;
  required_notice_bucket: ChoiceAnswer<RequiredBucket>;
  actual_notice_bucket: ChoiceAnswer<ActualBucket>;
  notice_method_compliant: NoulAnswer;
}

export type Decision =
  | "NO_AUTO_RENEWAL_CLAUSE" // contract doesn't confidently auto-renew; notice timing is moot
  | "NOTICE_SUFFICIENT" // customer gave enough notice, in the right way, to avoid renewal
  | "NOTICE_INSUFFICIENT" // customer's notice was late and/or didn't meet method requirements
  | "NEEDS_HUMAN_REVIEW"; // any input Jev wasn't confident about

export interface DecisionResult {
  decision: Decision;
  reasons: string[];
}

// Tune these against labelled cases (jev-eval), not by inspection.
const TRUE_T = 0.65;
const FALSE_T = 0.35;
const CHOICE_T = 0.55;

// Shared ordinal scale so a required bucket and an actual bucket can be
// compared by index instead of by re-deriving day counts.
const BUCKET_ORDER: ActualBucket[] = [
  "after_deadline",
  "0_to_14_days",
  "15_to_29_days",
  "30_to_59_days",
  "60_to_89_days",
  "90_to_179_days",
  "180_plus_days",
];

function bucketIndex(b: ActualBucket | RequiredBucket): number {
  return BUCKET_ORDER.indexOf(b as ActualBucket);
}

// Never let a low-confidence read relax a decision to "sufficient" — it
// always routes to NEEDS_HUMAN_REVIEW instead.
export function decide(a: JevAnswers): DecisionResult {
  const reasons: string[] = [];

  if (!(a.clear_intent_to_cancel >= TRUE_T)) {
    reasons.push(
      `clear_intent_to_cancel=${a.clear_intent_to_cancel.toFixed(2)}: not confidently a cancellation notice`
    );
    return { decision: "NEEDS_HUMAN_REVIEW", reasons };
  }

  if (a.auto_renewal_clause <= FALSE_T) {
    reasons.push("no confidently-detected auto-renewal clause; notice timing does not apply");
    return { decision: "NO_AUTO_RENEWAL_CLAUSE", reasons };
  }
  if (!(a.auto_renewal_clause >= TRUE_T)) {
    reasons.push(`auto_renewal_clause=${a.auto_renewal_clause.toFixed(2)}: ambiguous`);
    return { decision: "NEEDS_HUMAN_REVIEW", reasons };
  }

  if (!(a.deadline_determinable >= TRUE_T)) {
    reasons.push("renewal/notice deadline not clearly computable from the contract text");
    return { decision: "NEEDS_HUMAN_REVIEW", reasons };
  }

  const req = a.required_notice_bucket;
  const act = a.actual_notice_bucket;

  if (req.choice === "not_specified" || req.probabilities[req.choice] < CHOICE_T) {
    reasons.push("required notice period not confidently determined");
    return { decision: "NEEDS_HUMAN_REVIEW", reasons };
  }
  if (act.probabilities[act.choice] < CHOICE_T) {
    reasons.push("actual notice timing not confidently determined");
    return { decision: "NEEDS_HUMAN_REVIEW", reasons };
  }

  reasons.push(`required=${req.choice}, actual=${act.choice}`);
  const timely = bucketIndex(act.choice) >= bucketIndex(req.choice as ActualBucket);

  if (a.notice_method_compliant > FALSE_T && !(a.notice_method_compliant >= TRUE_T)) {
    reasons.push(`notice_method_compliant=${a.notice_method_compliant.toFixed(2)}: ambiguous`);
    return { decision: "NEEDS_HUMAN_REVIEW", reasons };
  }
  const methodOk = a.notice_method_compliant >= TRUE_T;
  if (!methodOk) reasons.push("notice does not confidently meet the contract's method/channel requirement");

  return {
    decision: timely && methodOk ? "NOTICE_SUFFICIENT" : "NOTICE_INSUFFICIENT",
    reasons,
  };
}
