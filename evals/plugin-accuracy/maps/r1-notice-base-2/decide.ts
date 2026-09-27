// Combines answers from questions.json into a notice-sufficiency decision.
// Jev handles the fuzzy reading (dates, wording, clause interpretation);
// this file just applies fixed thresholds so the outcome is auditable.

type NoulAnswer = { probability: number };
type ScoreAnswer = { level: string };

interface JevAnswers {
  has_auto_renewal: NoulAnswer;
  notice_timely: NoulAnswer;
  method_compliant: NoulAnswer;
  intent_clear: NoulAnswer;
  clause_ambiguity: ScoreAnswer;
}

const TRUE_THRESHOLD = 0.65;
const FALSE_THRESHOLD = 0.35;

type Tri = "true" | "false" | "uncertain";

function classify(p: number): Tri {
  if (p >= TRUE_THRESHOLD) return "true";
  if (p <= FALSE_THRESHOLD) return "false";
  return "uncertain";
}

export type Outcome = "not_applicable" | "sufficient_notice" | "insufficient_notice" | "uncertain";

export interface Decision {
  outcome: Outcome;
  needsHumanReview: boolean;
  reasons: string[];
  factors: {
    hasAutoRenewal: Tri;
    noticeTimely: Tri;
    methodCompliant: Tri;
    intentClear: Tri;
    clauseAmbiguity: string;
  };
}

export function decide(answers: JevAnswers): Decision {
  const hasAutoRenewal = classify(answers.has_auto_renewal.probability);
  const noticeTimely = classify(answers.notice_timely.probability);
  const methodCompliant = classify(answers.method_compliant.probability);
  const intentClear = classify(answers.intent_clear.probability);
  const clauseAmbiguity = answers.clause_ambiguity.level;

  const factors = { hasAutoRenewal, noticeTimely, methodCompliant, intentClear, clauseAmbiguity };
  const reasons: string[] = [];
  let needsHumanReview = clauseAmbiguity === "highly ambiguous";
  if (clauseAmbiguity === "highly ambiguous") {
    reasons.push("Auto-renewal/notice terms in the contract are highly ambiguous.");
  }

  if (hasAutoRenewal === "false") {
    reasons.push("Contract does not appear to have an auto-renewal clause; notice timing is moot.");
    return { outcome: "not_applicable", needsHumanReview, reasons, factors };
  }
  if (hasAutoRenewal === "uncertain") {
    reasons.push("Uncertain whether the contract auto-renews.");
    needsHumanReview = true;
  }

  const checks: [string, Tri][] = [
    ["Customer's cancellation email does not clearly state intent to cancel/not renew.", intentClear],
    ["Notice was not delivered via the method/recipient the contract requires.", methodCompliant],
    ["Notice was not given by the contract's deadline.", noticeTimely],
  ];

  const failed = checks.filter(([, v]) => v === "false");
  const unsure = checks.filter(([, v]) => v === "uncertain");

  if (failed.length > 0) {
    reasons.push(...failed.map(([msg]) => msg));
    return { outcome: "insufficient_notice", needsHumanReview, reasons, factors };
  }

  if (unsure.length > 0) {
    reasons.push(...unsure.map(([msg]) => `Uncertain: ${msg}`));
    return { outcome: "uncertain", needsHumanReview: true, reasons, factors };
  }

  reasons.push("Auto-renewal applies; intent was clear, notice method was compliant, and notice was timely.");
  return { outcome: "sufficient_notice", needsHumanReview, reasons, factors };
}
