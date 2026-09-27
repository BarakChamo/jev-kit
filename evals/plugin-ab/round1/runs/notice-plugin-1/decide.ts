// Decision logic for questions.json's answers. Bucket comparison and gating happen
// here in code, per jev-questions rules 5/6/8/9 — Jev only extracts facts and judgments.

type Noul = { noul: number };
type Choice<T extends string> = { choice: T; confidence: number; probabilities: Record<T, number> };

type RequiredDays = "15" | "30" | "45" | "60" | "90" | "120" | "180" | "other" | "not_specified";
type RenewalBucket =
  | "less_than_15" | "15_to_29" | "30_to_44" | "45_to_59" | "60_to_89"
  | "90_to_119" | "120_to_179" | "180_or_more" | "already_past" | "cannot_determine";

export interface JevAnswers {
  has_autorenewal: Noul;
  notice_days_required: Choice<RequiredDays>;
  days_until_next_renewal: Choice<RenewalBucket>;
  notice_method_satisfied: Noul;
  cancellation_intent_clear: Noul;
}

export type Decision =
  | { outcome: "not_applicable"; reason: string }
  | { outcome: "renewal_avoided"; reason: string }
  | { outcome: "renewal_not_avoided"; reason: string }
  | { outcome: "needs_human_review"; reason: string };

const GATE = 0.75; // probability/confidence threshold below which we escalate instead of deciding

// Gate a noul's true-probability into a confident label or "unsure". Low
// confidence never relaxes toward the permissive outcome (rule 8/9): it always
// routes to the stricter branch or to a human, never silently to "sufficient".
function gateNoul(p: number): "true" | "false" | "unsure" {
  if (p >= GATE) return "true";
  if (p <= 1 - GATE) return "false";
  return "unsure";
}

// Lower bound of days-until-renewal implied by each bucket. Chosen so every
// required-notice threshold (15/30/45/60/90/120/180) falls exactly on a bucket
// edge, so "available >= required" never needs to be decided inside a bucket.
const RENEWAL_LOWER_BOUND: Record<Exclude<RenewalBucket, "already_past" | "cannot_determine">, number> = {
  less_than_15: 0,
  "15_to_29": 15,
  "30_to_44": 30,
  "45_to_59": 45,
  "60_to_89": 60,
  "90_to_119": 90,
  "120_to_179": 120,
  "180_or_more": 180,
};

export function decide(a: JevAnswers): Decision {
  const autorenewal = gateNoul(a.has_autorenewal.noul);
  if (autorenewal === "unsure") {
    return { outcome: "needs_human_review", reason: "Unclear whether the contract auto-renews." };
  }
  if (autorenewal === "false") {
    return { outcome: "not_applicable", reason: "Contract has no auto-renewal clause; nothing to avoid." };
  }

  const intent = gateNoul(a.cancellation_intent_clear.noul);
  if (intent === "unsure") {
    return { outcome: "needs_human_review", reason: "Cancellation intent in the email is ambiguous." };
  }
  if (intent === "false") {
    return { outcome: "renewal_not_avoided", reason: "Email does not clearly express intent to cancel." };
  }

  const method = gateNoul(a.notice_method_satisfied.noul);
  if (method === "unsure") {
    return { outcome: "needs_human_review", reason: "Unclear whether the email satisfies the required notice method." };
  }
  if (method === "false") {
    return { outcome: "renewal_not_avoided", reason: "Email does not satisfy the contract's required notice method." };
  }

  const renewal = a.days_until_next_renewal;
  const required = a.notice_days_required;

  if (renewal.confidence < GATE || required.confidence < GATE) {
    return { outcome: "needs_human_review", reason: "Low confidence extracting the renewal date or notice period." };
  }
  if (renewal.choice === "cannot_determine" || required.choice === "other") {
    return { outcome: "needs_human_review", reason: "Renewal date or notice period could not be read cleanly from the contract." };
  }
  if (renewal.choice === "already_past") {
    return { outcome: "renewal_not_avoided", reason: "Notice arrived after the renewal date had already passed." };
  }

  const requiredDays = required.choice === "not_specified" ? 0 : Number(required.choice);
  const availableDays = RENEWAL_LOWER_BOUND[renewal.choice];

  return availableDays >= requiredDays
    ? { outcome: "renewal_avoided", reason: `Notice given ${availableDays}+ days before renewal, meeting the ${requiredDays}-day requirement.` }
    : { outcome: "renewal_not_avoided", reason: `Notice given only ${renewal.choice.replace(/_/g, " ")} before renewal, short of the ${requiredDays}-day requirement.` };
}
