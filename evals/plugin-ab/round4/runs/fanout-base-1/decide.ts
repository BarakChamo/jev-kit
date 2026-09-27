// Turns a raw Jev (System One) answer set into a clean row for the contract
// database, plus a review queue for anything too uncertain to trust unattended.
// Assumes the response envelope mirrors the questions map:
//   { answers: { [questionId]: NoulAnswer | ChoiceAnswer | ScoreAnswer } }

type NoulAnswer = { probability: number };
type ChoiceAnswer = { choice: string; confidence: number; probabilities: Record<string, number> };
type ScoreAnswer = { level: string; confidence?: number };
type JevAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;
type JevResponse = { answers: Record<string, JevAnswer> };

const NOUL_UNCERTAIN_BAND: [number, number] = [0.4, 0.6];
const CHOICE_CONFIDENCE_FLOOR = 0.6;
const SCORE_CONFIDENCE_FLOOR = 0.6;

function isNoul(a: JevAnswer): a is NoulAnswer {
  return typeof (a as NoulAnswer).probability === "number";
}
function isChoice(a: JevAnswer): a is ChoiceAnswer {
  return typeof (a as ChoiceAnswer).choice === "string";
}
function isScore(a: JevAnswer): a is ScoreAnswer {
  return typeof (a as ScoreAnswer).level === "string";
}

export interface ReviewItem {
  field: string;
  reason: string;
}

export interface ContractRecord {
  governing_law: string;
  auto_renewal: boolean;
  renewal_notice_period_band: string;
  liability_cap_present: boolean;
  liability_cap_amount_band: string;
  liability_cap_mutual: boolean;
  indemnity_scope: string;
  dpa_present: boolean;
  termination_for_convenience: boolean;
  termination_notice_band: string;
  payment_terms_band: string;
  consequential_damages_excluded: boolean;
  confidentiality_survival: boolean;
  ip_ownership: string;
  assignment_consent_required: boolean;
  exclusivity_present: boolean;
  non_solicitation_clause: boolean;
  insurance_requirements_present: boolean;
  sla_present: boolean;
  sla_credits_present: boolean;
  audit_rights_present: boolean;
  force_majeure_present: boolean;
  dispute_resolution_method: string;
  warranty_disclaimer_level: string;
  contract_term_length_band: string;
}

// Fields whose value is only meaningful when a gating boolean field is true.
// If the gate is false, the dependent field is forced to its "n/a" value
// instead of trusting whatever Jev guessed for it.
const DEPENDENTS: Record<string, { gate: keyof ContractRecord; whenGateFalse: string }> = {
  renewal_notice_period_band: { gate: "auto_renewal", whenGateFalse: "none_or_na" },
  liability_cap_amount_band: { gate: "liability_cap_present", whenGateFalse: "no_cap" },
  liability_cap_mutual: { gate: "liability_cap_present", whenGateFalse: "false" },
  termination_notice_band: { gate: "termination_for_convenience", whenGateFalse: "none_or_na" },
  sla_credits_present: { gate: "sla_present", whenGateFalse: "false" },
};

function decideNoul(field: string, a: NoulAnswer, review: ReviewItem[]): boolean {
  const [lo, hi] = NOUL_UNCERTAIN_BAND;
  if (a.probability >= lo && a.probability <= hi) {
    review.push({ field, reason: `probability ${a.probability.toFixed(2)} in uncertain band` });
  }
  return a.probability >= 0.5;
}

function decideChoice(field: string, a: ChoiceAnswer, review: ReviewItem[]): string {
  if (a.confidence < CHOICE_CONFIDENCE_FLOOR) {
    review.push({ field, reason: `confidence ${a.confidence.toFixed(2)} below floor` });
  } else {
    const sorted = Object.values(a.probabilities).sort((x, y) => y - x);
    const margin = sorted.length > 1 ? sorted[0] - sorted[1] : 1;
    if (margin < 0.15) {
      review.push({ field, reason: `top two choices within ${margin.toFixed(2)} of each other` });
    }
  }
  return a.choice;
}

function decideScore(field: string, a: ScoreAnswer, review: ReviewItem[]): string {
  if (a.confidence !== undefined && a.confidence < SCORE_CONFIDENCE_FLOOR) {
    review.push({ field, reason: `confidence ${a.confidence.toFixed(2)} below floor` });
  }
  return a.level;
}

export function decide(response: JevResponse): { record: ContractRecord; review: ReviewItem[] } {
  const review: ReviewItem[] = [];
  const raw: Record<string, string> = {};

  for (const [field, answer] of Object.entries(response.answers)) {
    if (isNoul(answer)) raw[field] = String(decideNoul(field, answer, review));
    else if (isChoice(answer)) raw[field] = decideChoice(field, answer, review);
    else if (isScore(answer)) raw[field] = decideScore(field, answer, review);
  }

  for (const [field, { gate, whenGateFalse }] of Object.entries(DEPENDENTS)) {
    if (raw[gate] === "false") raw[field] = whenGateFalse;
  }

  const record = raw as unknown as ContractRecord;
  for (const key of [
    "auto_renewal", "liability_cap_present", "liability_cap_mutual", "dpa_present",
    "termination_for_convenience", "consequential_damages_excluded", "confidentiality_survival",
    "assignment_consent_required", "exclusivity_present", "non_solicitation_clause",
    "insurance_requirements_present", "sla_present", "sla_credits_present",
    "audit_rights_present", "force_majeure_present",
  ] as const) {
    (record as any)[key] = raw[key] === "true";
  }

  return { record, review };
}
