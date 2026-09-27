// Turns raw Jev answers (from questions.json) into the 25 contract-database fields.
// Gates on the probability of the label we care about (not the `confidence` scalar —
// it under-reports by up to 29 points; the distribution is the calibrated signal).

type NoulAnswer = { noul: number };
type ChoiceAnswer = { choice: string; confidence: number; probabilities: Record<string, number> };

type Answers = {
  governing_law: ChoiceAnswer;
  auto_renewal_clause_present: NoulAnswer;
  renewal_notice_period_band: ChoiceAnswer;
  termination_for_convenience: ChoiceAnswer;
  liability_cap_present: NoulAnswer;
  liability_cap_basis: ChoiceAnswer;
  liability_cap_fee_multiple_band: ChoiceAnswer;
  liability_cap_fixed_amount_band: ChoiceAnswer;
  liability_cap_carveouts_present: NoulAnswer;
  indemnity_scope: ChoiceAnswer;
  data_processing_terms_present: NoulAnswer;
  confidentiality_survival_present: NoulAnswer;
  assignment_change_of_control_consent_required: ChoiceAnswer;
  ip_ownership_deliverables: ChoiceAnswer;
  insurance_requirement_present: NoulAnswer;
  sla_service_credits_present: NoulAnswer;
  exclusivity_present: NoulAnswer;
  most_favored_nation_present: NoulAnswer;
  audit_rights_present: NoulAnswer;
  force_majeure_present: NoulAnswer;
  dispute_resolution_mechanism: ChoiceAnswer;
  venue_named: NoulAnswer;
  payment_terms_band: ChoiceAnswer;
  late_payment_penalty_present: NoulAnswer;
  price_increase_mechanism: ChoiceAnswer;
  warranty_disclaimer_scope: ChoiceAnswer;
};

type Status = "confident" | "needs_review";
type Field<T> = { value: T; probability: number; status: Status };

// Below the low threshold and above the high threshold both count as "confident" for a
// noul (it's confidently false or confidently true); only the middle band is unsure.
const NOUL_HIGH = 0.75;
const NOUL_LOW = 0.25;
// Per-field override for the top choice probability required to trust it outright.
// Fields that drive automated downstream action (renewal/termination triage) get a
// higher bar than descriptive fields (venue, warranty framing).
const CHOICE_THRESHOLD: Partial<Record<keyof Answers, number>> = {
  governing_law: 0.6,
  termination_for_convenience: 0.7,
  liability_cap_basis: 0.7,
  renewal_notice_period_band: 0.7,
  indemnity_scope: 0.65,
  payment_terms_band: 0.6,
};
const DEFAULT_CHOICE_THRESHOLD = 0.6;

function fromNoul(a: NoulAnswer): Field<boolean> {
  if (a.noul >= NOUL_HIGH) return { value: true, probability: a.noul, status: "confident" };
  if (a.noul <= NOUL_LOW) return { value: false, probability: a.noul, status: "confident" };
  return { value: a.noul >= 0.5, probability: a.noul, status: "needs_review" };
}

function fromChoice<T extends string>(key: keyof Answers, a: ChoiceAnswer): Field<T> {
  const threshold = CHOICE_THRESHOLD[key] ?? DEFAULT_CHOICE_THRESHOLD;
  const p = a.probabilities[a.choice] ?? a.confidence;
  return {
    value: a.choice as T,
    probability: p,
    status: p >= threshold ? "confident" : "needs_review",
  };
}

export type ContractRecord = {
  governing_law: Field<string>;
  auto_renewal: Field<boolean>;
  renewal_notice_period_band: Field<string>;
  termination_for_convenience: Field<string>;
  liability_cap_present: Field<boolean>;
  liability_cap_basis: Field<string>;
  liability_cap_amount_band: Field<string>;
  liability_cap_carveouts_present: Field<boolean>;
  indemnity_scope: Field<string>;
  data_processing_terms_present: Field<boolean>;
  confidentiality_survival_present: Field<boolean>;
  assignment_change_of_control_consent_required: Field<string>;
  ip_ownership_deliverables: Field<string>;
  insurance_requirement_present: Field<boolean>;
  sla_service_credits_present: Field<boolean>;
  exclusivity_present: Field<boolean>;
  most_favored_nation_present: Field<boolean>;
  audit_rights_present: Field<boolean>;
  force_majeure_present: Field<boolean>;
  dispute_resolution_mechanism: Field<string>;
  venue_named: Field<boolean>;
  payment_terms_band: Field<string>;
  late_payment_penalty_present: Field<boolean>;
  price_increase_mechanism: Field<string>;
  warranty_disclaimer_scope: Field<string>;
  needs_human_review: boolean;
  review_reasons: string[];
};

export function decide(a: Answers): ContractRecord {
  const autoRenewal = fromNoul(a.auto_renewal_clause_present);
  const capPresent = fromNoul(a.liability_cap_present);
  const capBasis = fromChoice<string>("liability_cap_basis", a.liability_cap_basis);
  const renewalNotice = fromChoice<string>("renewal_notice_period_band", a.renewal_notice_period_band);

  // Code picks which of the two band questions is authoritative, rather than asking
  // Jev to merge fixed-amount and fee-multiple into one answer itself.
  let capAmountBand: Field<string>;
  if (capBasis.value === "fixed_dollar_amount") {
    capAmountBand = fromChoice<string>("liability_cap_fixed_amount_band", a.liability_cap_fixed_amount_band);
  } else if (capBasis.value === "multiple_of_fees") {
    capAmountBand = fromChoice<string>("liability_cap_fee_multiple_band", a.liability_cap_fee_multiple_band);
  } else {
    capAmountBand = { value: "not_applicable", probability: capBasis.probability, status: capBasis.status };
  }

  const reasons: string[] = [];

  // Consistency checks: two questions describing the same fact should agree. A
  // confident mismatch is a signal the extraction is wrong somewhere, not something
  // to silently paper over by picking one side.
  if (
    autoRenewal.status === "confident" &&
    autoRenewal.value === false &&
    renewalNotice.value !== "no_auto_renewal_or_not_stated"
  ) {
    reasons.push("auto_renewal_present=false but renewal_notice_period_band assumes a renewal clause");
  }
  if (
    capPresent.status === "confident" &&
    capPresent.value === false &&
    capBasis.value !== "no_cap_stated"
  ) {
    reasons.push("liability_cap_present=false but liability_cap_basis assumes a cap exists");
  }

  const fields: Array<Field<unknown>> = [
    autoRenewal,
    renewalNotice,
    capPresent,
    capBasis,
    capAmountBand,
  ];
  const record: ContractRecord = {
    governing_law: fromChoice("governing_law", a.governing_law),
    auto_renewal: autoRenewal,
    renewal_notice_period_band: renewalNotice,
    termination_for_convenience: fromChoice("termination_for_convenience", a.termination_for_convenience),
    liability_cap_present: capPresent,
    liability_cap_basis: capBasis,
    liability_cap_amount_band: capAmountBand,
    liability_cap_carveouts_present: fromNoul(a.liability_cap_carveouts_present),
    indemnity_scope: fromChoice("indemnity_scope", a.indemnity_scope),
    data_processing_terms_present: fromNoul(a.data_processing_terms_present),
    confidentiality_survival_present: fromNoul(a.confidentiality_survival_present),
    assignment_change_of_control_consent_required: fromChoice(
      "assignment_change_of_control_consent_required",
      a.assignment_change_of_control_consent_required
    ),
    ip_ownership_deliverables: fromChoice("ip_ownership_deliverables", a.ip_ownership_deliverables),
    insurance_requirement_present: fromNoul(a.insurance_requirement_present),
    sla_service_credits_present: fromNoul(a.sla_service_credits_present),
    exclusivity_present: fromNoul(a.exclusivity_present),
    most_favored_nation_present: fromNoul(a.most_favored_nation_present),
    audit_rights_present: fromNoul(a.audit_rights_present),
    force_majeure_present: fromNoul(a.force_majeure_present),
    dispute_resolution_mechanism: fromChoice("dispute_resolution_mechanism", a.dispute_resolution_mechanism),
    venue_named: fromNoul(a.venue_named),
    payment_terms_band: fromChoice("payment_terms_band", a.payment_terms_band),
    late_payment_penalty_present: fromNoul(a.late_payment_penalty_present),
    price_increase_mechanism: fromChoice("price_increase_mechanism", a.price_increase_mechanism),
    warranty_disclaimer_scope: fromChoice("warranty_disclaimer_scope", a.warranty_disclaimer_scope),
    needs_human_review: false,
    review_reasons: reasons,
  };

  // Low confidence never gets silently accepted: any unsure field, or any consistency
  // conflict, routes the whole record to a reviewer rather than relaxing the value.
  const allFields = Object.values(record).filter(
    (v): v is Field<unknown> => typeof v === "object" && v !== null && "status" in v
  );
  record.needs_human_review = reasons.length > 0 || allFields.some((f) => f.status === "needs_review");

  return record;
}
