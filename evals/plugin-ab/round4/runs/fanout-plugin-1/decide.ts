// Turns one systemone response (per questions.json) into one row of the 25-field
// contract database. Pure function, no I/O — call it once per contract after the API returns.

type NoulAnswer = { noul: number };
type ChoiceAnswer = { choice: string; confidence: number; probabilities: Record<string, number> };
type ScoreAnswer = { score: string; confidence: number; legend: string[]; probabilities: Record<string, number> };
type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;
export type Answers = Record<string, Answer>;

// Gate on the probability of the label we care about, not the SDK's `confidence` scalar
// (rule 8: the scalar was under-confident by up to 29pts; the distribution tracks reality).
const NOUL_HIGH = 0.85;
const NOUL_LOW = 0.15;
const CHOICE_MIN = 0.7;

type Trilean = "true" | "false" | "uncertain";

function gateNoul(a: NoulAnswer): Trilean {
  if (a.noul >= NOUL_HIGH) return "true";
  if (a.noul <= NOUL_LOW) return "false";
  return "uncertain";
}

// Returns the winning label plus, for the review queue, the runner-up — the true label is the
// runner-up 67-100% of the time an unconfident top pick is wrong (rule 8/9).
function gateChoice(a: ChoiceAnswer): { value: string; confident: boolean; top2: [string, string] } {
  const ranked = Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]);
  const value = ranked[0][0];
  const confident = ranked[0][1] >= CHOICE_MIN;
  const top2: [string, string] = [ranked[0][0], ranked[1]?.[0] ?? ranked[0][0]];
  return { value, confident, top2 };
}

function gateScore(a: ScoreAnswer): { value: string; confident: boolean } {
  const top = Math.max(...Object.values(a.probabilities));
  return { value: a.score, confident: top >= CHOICE_MIN };
}

// liability_cap_amount_band is one DB column but three Jev questions: which form the cap takes,
// and the fixed-amount / fee-multiple band for whichever form applies. Combining them is a fact
// code can settle completely once the type is known (rule 12) — never ask Jev to pick one band
// across two different units.
function deriveLiabilityCapBand(
  type: ChoiceAnswer,
  fixedBand: ChoiceAnswer,
  multipleBand: ChoiceAnswer
): { band: string; confident: boolean } {
  const t = gateChoice(type);
  switch (t.value) {
    case "unlimited_no_cap":
      return { band: "unlimited", confident: t.confident };
    case "not_addressed":
      return { band: "not_addressed", confident: t.confident };
    case "fixed_dollar_amount": {
      const b = gateChoice(fixedBand);
      return { band: `amount:${b.value}`, confident: t.confident && b.confident };
    }
    case "multiple_of_fees_paid": {
      const b = gateChoice(multipleBand);
      return { band: `fee_multiple:${b.value}`, confident: t.confident && b.confident };
    }
    default:
      return { band: "not_addressed", confident: false };
  }
}

export interface ContractRecord {
  contract_id: string;
  governing_law: string;
  auto_renewal_present: Trilean;
  renewal_notice_period_band: string;
  termination_for_convenience_present: Trilean;
  termination_for_convenience_notice_band: string;
  liability_cap_present: Trilean;
  liability_cap_amount_band: string;
  indemnity_present: Trilean;
  indemnity_scope: string;
  limitation_of_liability_excludes_indemnity: Trilean;
  data_processing_terms_present: Trilean;
  gdpr_referenced: Trilean;
  confidentiality_present: Trilean;
  confidentiality_survival_band: string;
  payment_terms_band: string;
  late_payment_interest_present: Trilean;
  assignment_consent_required: Trilean;
  change_of_control_termination_right: Trilean;
  insurance_requirement_present: Trilean;
  warranty_disclaimer_present: Trilean;
  force_majeure_present: Trilean;
  dispute_resolution_method: string;
  audit_rights_present: Trilean;
  needs_human_review: boolean;
  low_confidence_fields: string[];
}

export function decide(contract_id: string, answers: Answers): ContractRecord {
  const noul = (id: string) => answers[id] as NoulAnswer;
  const choice = (id: string) => answers[id] as ChoiceAnswer;
  const score = (id: string) => answers[id] as ScoreAnswer;

  const low: string[] = [];
  const trackNoul = (id: string) => {
    const g = gateNoul(noul(id));
    if (g === "uncertain") low.push(id);
    return g;
  };
  const trackChoice = (id: string) => {
    const g = gateChoice(choice(id));
    if (!g.confident) low.push(id);
    return g.value;
  };
  const trackScore = (id: string) => {
    const g = gateScore(score(id));
    if (!g.confident) low.push(id);
    return g.value;
  };

  const capBand = deriveLiabilityCapBand(
    choice("liability_cap_type"),
    choice("liability_cap_fixed_amount_band"),
    choice("liability_cap_fee_multiple_band")
  );
  if (!capBand.confident) low.push("liability_cap_amount_band");

  const record: ContractRecord = {
    contract_id,
    governing_law: trackChoice("governing_law"),
    auto_renewal_present: trackNoul("auto_renewal_present"),
    renewal_notice_period_band: trackChoice("renewal_notice_period_band"),
    termination_for_convenience_present: trackNoul("termination_for_convenience_present"),
    termination_for_convenience_notice_band: trackChoice("termination_for_convenience_notice_band"),
    liability_cap_present: trackNoul("liability_cap_present"),
    liability_cap_amount_band: capBand.band,
    indemnity_present: trackNoul("indemnity_present"),
    indemnity_scope: trackChoice("indemnity_scope"),
    limitation_of_liability_excludes_indemnity: trackNoul("limitation_of_liability_excludes_indemnity"),
    data_processing_terms_present: trackNoul("data_processing_terms_present"),
    gdpr_referenced: trackNoul("gdpr_referenced"),
    confidentiality_present: trackNoul("confidentiality_present"),
    confidentiality_survival_band: trackChoice("confidentiality_survival_band"),
    payment_terms_band: trackScore("payment_terms_band"),
    late_payment_interest_present: trackNoul("late_payment_interest_present"),
    assignment_consent_required: trackNoul("assignment_consent_required"),
    change_of_control_termination_right: trackNoul("change_of_control_termination_right"),
    insurance_requirement_present: trackNoul("insurance_requirement_present"),
    warranty_disclaimer_present: trackNoul("warranty_disclaimer_present"),
    force_majeure_present: trackNoul("force_majeure_present"),
    dispute_resolution_method: trackChoice("dispute_resolution_method"),
    audit_rights_present: trackNoul("audit_rights_present"),
    needs_human_review: false,
    low_confidence_fields: low,
  };

  // A trilean "uncertain" always means review, never a silent default (low confidence must
  // never relax toward an answer). Surfacing the runner-up label is left to the review UI,
  // which can re-derive it from `low_confidence_fields` + the raw choice probabilities.
  record.needs_human_review = low.length > 0;
  return record;
}
