// Turns Jev's answers for one contract into a row for the contract database.
// Gates on the probability of the label of interest (not the `confidence` scalar,
// which the underlying study found under-confident by up to 29 points).
// Low-confidence answers never resolve to a value on their own: they go to
// `needsReview` with the top-2 candidates, for a person (or, in bulk, a
// second-pass LLM) to close out. This is the ~40k/year hot path: cheap,
// mechanical, and it fails safe toward review rather than a wrong DB row.

type NoulAnswer = { noul: number };
type ChoiceAnswer<Opt extends string = string> = {
  choice: Opt;
  confidence: number;
  probabilities: Record<Opt, number>;
};

const NOUL_HIGH = 0.85; // >= this -> true
const NOUL_LOW = 0.15; // <= this -> false
const CHOICE_MIN_PROB = 0.75; // top choice's own probability must clear this

interface Answers {
  governing_law: ChoiceAnswer;
  auto_renewal: NoulAnswer;
  renewal_notice_period_band: ChoiceAnswer;
  termination_for_convenience: NoulAnswer;
  termination_for_convenience_notice_band: ChoiceAnswer;
  liability_cap_present: NoulAnswer;
  liability_cap_amount_band: ChoiceAnswer;
  liability_cap_carveouts_present: NoulAnswer;
  indemnity_present: NoulAnswer;
  indemnity_scope: ChoiceAnswer;
  consequential_damages_waiver: NoulAnswer;
  data_processing_terms_present: NoulAnswer;
  data_processing_regulatory_reference: ChoiceAnswer;
  confidentiality_clause_present: NoulAnswer;
  confidentiality_survival_band: ChoiceAnswer;
  payment_terms_band: ChoiceAnswer;
  price_escalation_clause_present: NoulAnswer;
  assignment_restriction: ChoiceAnswer;
  exclusivity_clause_present: NoulAnswer;
  most_favored_nation_clause_present: NoulAnswer;
  insurance_requirement_present: NoulAnswer;
  audit_rights_present: NoulAnswer;
  force_majeure_clause_present: NoulAnswer;
  dispute_resolution_mechanism: ChoiceAnswer;
  non_compete_or_non_solicit_present: NoulAnswer;
}

type Bool = true | false | "needs_review";
type Cat<Opt extends string> = Opt | "needs_review";

interface ReviewItem {
  field: string;
  reason: "low_probability" | "low_choice_margin";
  top: Array<{ label: string; probability: number }>;
}

interface ContractRow {
  contractId: string;
  governingLaw: Cat<string>;
  autoRenewal: Bool;
  renewalNoticePeriodBand: Cat<string> | "n/a"; // n/a when autoRenewal is false
  terminationForConvenience: Bool;
  terminationForConvenienceNoticeBand: Cat<string> | "n/a"; // n/a when terminationForConvenience is false
  liabilityCapPresent: Bool;
  liabilityCapAmountBand: Cat<string> | "n/a"; // n/a when liabilityCapPresent is false
  liabilityCapHasCarveouts: Bool | "n/a";
  indemnityPresent: Bool;
  indemnityScope: Cat<string> | "n/a";
  consequentialDamagesWaiver: Bool;
  dataProcessingTermsPresent: Bool;
  dataProcessingRegulatoryReference: Cat<string> | "n/a";
  confidentialityClausePresent: Bool;
  confidentialitySurvivalBand: Cat<string> | "n/a";
  paymentTermsBand: Cat<string>;
  priceEscalationClausePresent: Bool;
  assignmentRestriction: Cat<string>;
  exclusivityClausePresent: Bool;
  mostFavoredNationClausePresent: Bool;
  insuranceRequirementPresent: Bool;
  auditRightsPresent: Bool;
  forceMajeureClausePresent: Bool;
  disputeResolutionMechanism: Cat<string>;
  nonCompeteOrNonSolicitPresent: Bool;
  needsReview: ReviewItem[];
}

function decideNoul(field: string, a: NoulAnswer, review: ReviewItem[]): Bool {
  if (a.noul >= NOUL_HIGH) return true;
  if (a.noul <= NOUL_LOW) return false;
  review.push({
    field,
    reason: "low_probability",
    top: [{ label: "true", probability: a.noul }],
  });
  return "needs_review";
}

function decideChoice<Opt extends string>(
  field: string,
  a: ChoiceAnswer<Opt>,
  review: ReviewItem[]
): Cat<Opt> {
  const top = a.probabilities[a.choice];
  if (top >= CHOICE_MIN_PROB) return a.choice;

  const ranked = Object.entries(a.probabilities)
    .sort((x, y) => (y[1] as number) - (x[1] as number))
    .slice(0, 2)
    .map(([label, probability]) => ({ label, probability: probability as number }));
  review.push({ field, reason: "low_choice_margin", top: ranked });
  return "needs_review";
}

export function decide(contractId: string, answers: Answers): ContractRow {
  const review: ReviewItem[] = [];

  const autoRenewal = decideNoul("auto_renewal", answers.auto_renewal, review);
  const terminationForConvenience = decideNoul(
    "termination_for_convenience",
    answers.termination_for_convenience,
    review
  );
  const liabilityCapPresent = decideNoul(
    "liability_cap_present",
    answers.liability_cap_present,
    review
  );
  const indemnityPresent = decideNoul("indemnity_present", answers.indemnity_present, review);
  const confidentialityClausePresent = decideNoul(
    "confidentiality_clause_present",
    answers.confidentiality_clause_present,
    review
  );

  // Conditional fields: the band was asked unconditionally (rule 3 — no "if" in
  // the question itself), so the presence/absence gate is applied here in code.
  const renewalNoticePeriodBand =
    autoRenewal === true
      ? decideChoice(
          "renewal_notice_period_band",
          answers.renewal_notice_period_band,
          review
        )
      : "n/a";

  const terminationForConvenienceNoticeBand =
    terminationForConvenience === true
      ? decideChoice(
          "termination_for_convenience_notice_band",
          answers.termination_for_convenience_notice_band,
          review
        )
      : "n/a";

  const liabilityCapAmountBand =
    liabilityCapPresent === true
      ? decideChoice("liability_cap_amount_band", answers.liability_cap_amount_band, review)
      : "n/a";

  const liabilityCapHasCarveouts =
    liabilityCapPresent === true
      ? decideNoul(
          "liability_cap_carveouts_present",
          answers.liability_cap_carveouts_present,
          review
        )
      : "n/a";

  const indemnityScope =
    indemnityPresent === true
      ? decideChoice("indemnity_scope", answers.indemnity_scope, review)
      : "n/a";

  const confidentialitySurvivalBand =
    confidentialityClausePresent === true
      ? decideChoice(
          "confidentiality_survival_band",
          answers.confidentiality_survival_band,
          review
        )
      : "n/a";

  return {
    contractId,
    governingLaw: decideChoice("governing_law", answers.governing_law, review),
    autoRenewal,
    renewalNoticePeriodBand,
    terminationForConvenience,
    terminationForConvenienceNoticeBand,
    liabilityCapPresent,
    liabilityCapAmountBand,
    liabilityCapHasCarveouts,
    indemnityPresent,
    indemnityScope,
    consequentialDamagesWaiver: decideNoul(
      "consequential_damages_waiver",
      answers.consequential_damages_waiver,
      review
    ),
    dataProcessingTermsPresent: decideNoul(
      "data_processing_terms_present",
      answers.data_processing_terms_present,
      review
    ),
    dataProcessingRegulatoryReference: decideChoice(
      "data_processing_regulatory_reference",
      answers.data_processing_regulatory_reference,
      review
    ),
    confidentialityClausePresent,
    confidentialitySurvivalBand,
    paymentTermsBand: decideChoice("payment_terms_band", answers.payment_terms_band, review),
    priceEscalationClausePresent: decideNoul(
      "price_escalation_clause_present",
      answers.price_escalation_clause_present,
      review
    ),
    assignmentRestriction: decideChoice(
      "assignment_restriction",
      answers.assignment_restriction,
      review
    ),
    exclusivityClausePresent: decideNoul(
      "exclusivity_clause_present",
      answers.exclusivity_clause_present,
      review
    ),
    mostFavoredNationClausePresent: decideNoul(
      "most_favored_nation_clause_present",
      answers.most_favored_nation_clause_present,
      review
    ),
    insuranceRequirementPresent: decideNoul(
      "insurance_requirement_present",
      answers.insurance_requirement_present,
      review
    ),
    auditRightsPresent: decideNoul("audit_rights_present", answers.audit_rights_present, review),
    forceMajeureClausePresent: decideNoul(
      "force_majeure_clause_present",
      answers.force_majeure_clause_present,
      review
    ),
    disputeResolutionMechanism: decideChoice(
      "dispute_resolution_mechanism",
      answers.dispute_resolution_mechanism,
      review
    ),
    nonCompeteOrNonSolicitPresent: decideNoul(
      "non_compete_or_non_solicit_present",
      answers.non_compete_or_non_solicit_present,
      review
    ),
    needsReview: review,
  };
}
