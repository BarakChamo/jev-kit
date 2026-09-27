// Turns a Jev (System One) response for questions.json into a row for the contract database,
// with confidence-based review flags so a 40k-contract/year pipeline can auto-file the easy cases
// and route the rest to a human.

type NoulAnswer = { probability: number };
type ChoiceAnswer = { choice: string; confidence: number; probabilities: Record<string, number> };
type ScoreAnswer = { level: string; confidence: number; probabilities: Record<string, number> };

interface JevResponse {
  answers: Record<string, NoulAnswer | ChoiceAnswer | ScoreAnswer>;
}

const CHOICE_CONFIDENCE_THRESHOLD = 0.6;
const NOUL_CONFIDENT_BAND: [number, number] = [0.15, 0.85]; // outside this range counts as confident

const NOUL_FIELDS = [
  "auto_renewal",
  "liability_cap_present",
  "liability_cap_mutual",
  "indemnity_mutual",
  "data_processing_terms_present",
  "data_breach_notification_present",
  "termination_for_convenience",
  "late_payment_penalty_present",
  "assignment_restriction",
  "exclusivity_clause",
  "most_favored_nation_clause",
  "non_compete_clause",
  "warranty_disclaimer_present",
  "force_majeure_clause",
  "audit_rights_present",
] as const;

const CHOICE_FIELDS = ["governing_law", "indemnity_scope", "dispute_resolution_method", "ip_ownership"] as const;

const SCORE_FIELDS = [
  "renewal_notice_period_band",
  "liability_cap_amount_band",
  "termination_notice_period_band",
  "cure_period_band",
  "payment_terms_band",
  "confidentiality_term_band",
] as const;

type NoulField = (typeof NOUL_FIELDS)[number];
type ChoiceField = (typeof CHOICE_FIELDS)[number];
type ScoreField = (typeof SCORE_FIELDS)[number];

interface Field<T> {
  value: T;
  confident: boolean;
}

export interface ContractRow {
  contractId: string;
  vendorName: string;
  fields: Record<NoulField, Field<boolean>> & Record<ChoiceField, Field<string>> & Record<ScoreField, Field<string>>;
  needsManualReview: boolean;
  reviewReasons: string[];
}

function decideNoul(a: NoulAnswer): Field<boolean> {
  const [low, high] = NOUL_CONFIDENT_BAND;
  return { value: a.probability >= 0.5, confident: a.probability <= low || a.probability >= high };
}

function decideChoice(a: ChoiceAnswer | ScoreAnswer, key: "choice" | "level"): Field<string> {
  const value = key === "choice" ? (a as ChoiceAnswer).choice : (a as ScoreAnswer).level;
  return { value, confident: a.confidence >= CHOICE_CONFIDENCE_THRESHOLD };
}

// Bands that carry business risk; adjust as contract-review policy evolves.
const AT_RISK_RENEWAL_NOTICE_BANDS = new Set(["not_specified_or_none", "under_30_days"]);
const AT_RISK_LIABILITY_CAP_BANDS = new Set(["not_specified", "over_3x_fees_or_uncapped"]);
const AT_RISK_INDEMNITY_SCOPES = new Set(["broad_unlimited", "one_sided_customer_favorable"]);

export function decide(response: JevResponse, contractId: string, vendorName: string): ContractRow {
  const answers = response.answers;
  const fields = {} as ContractRow["fields"];
  const reviewReasons: string[] = [];

  for (const f of NOUL_FIELDS) {
    const result = decideNoul(answers[f] as NoulAnswer);
    fields[f] = result;
    if (!result.confident) reviewReasons.push(`low confidence on ${f}`);
  }
  for (const f of CHOICE_FIELDS) {
    const result = decideChoice(answers[f] as ChoiceAnswer, "choice");
    fields[f] = result;
    if (!result.confident) reviewReasons.push(`low confidence on ${f}`);
  }
  for (const f of SCORE_FIELDS) {
    const result = decideChoice(answers[f] as ScoreAnswer, "level");
    fields[f] = result;
    if (!result.confident) reviewReasons.push(`low confidence on ${f}`);
  }

  // Auto-renewal trap: renews automatically with little notice to opt out.
  if (fields.auto_renewal.value && AT_RISK_RENEWAL_NOTICE_BANDS.has(fields.renewal_notice_period_band.value)) {
    reviewReasons.push("auto-renewal with short/no opt-out notice");
  }
  // Liability exposure: no cap, or cap present but not mutual.
  if (!fields.liability_cap_present.value || AT_RISK_LIABILITY_CAP_BANDS.has(fields.liability_cap_amount_band.value)) {
    reviewReasons.push("uncapped or high liability exposure");
  }
  if (fields.liability_cap_present.value && !fields.liability_cap_mutual.value) {
    reviewReasons.push("one-sided liability cap");
  }
  // Indemnity exposure.
  if (AT_RISK_INDEMNITY_SCOPES.has(fields.indemnity_scope.value)) {
    reviewReasons.push("broad or one-sided indemnity scope");
  }
  // Data processing gap: vendor handles data-relevant terms but no DPA/breach clause.
  if (!fields.data_processing_terms_present.value || !fields.data_breach_notification_present.value) {
    reviewReasons.push("missing data processing or breach notification terms");
  }

  return {
    contractId,
    vendorName,
    fields,
    needsManualReview: reviewReasons.length > 0,
    reviewReasons,
  };
}
