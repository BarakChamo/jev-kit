// Turns one Jev systemone response (from questions.json) into a DB row for the
// vendor_contracts table, plus a list of fields that need human review.
//
// Jev response shapes (per question type):
//   noul   -> { probability: number }                                   // P(true)
//   choice -> { choice: string, confidence: number, probabilities: Record<string, number> }
//   score  -> { level: string,  confidence: number, probabilities: Record<string, number> }

type NoulAnswer = { probability: number };
type ChoiceAnswer = { choice: string; confidence: number; probabilities: Record<string, number> };
type ScoreAnswer = { level: string; confidence: number; probabilities: Record<string, number> };
type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

interface JevResponse {
  answers: Record<string, Answer>;
}

const NOUL_TRUE_THRESHOLD = 0.5;
const NOUL_REVIEW_BAND: [number, number] = [0.35, 0.65]; // probability inside this band -> flag for review
const CHOICE_REVIEW_CONFIDENCE = 0.6; // choice/score confidence below this -> flag for review

const isNoul = (a: Answer): a is NoulAnswer => typeof (a as NoulAnswer).probability === "number";
const isChoice = (a: Answer): a is ChoiceAnswer => typeof (a as ChoiceAnswer).choice === "string";
const isScore = (a: Answer): a is ScoreAnswer => typeof (a as ScoreAnswer).level === "string";

function noulValue(a: NoulAnswer) {
  const value = a.probability >= NOUL_TRUE_THRESHOLD;
  const needsReview = a.probability > NOUL_REVIEW_BAND[0] && a.probability < NOUL_REVIEW_BAND[1];
  return { value, needsReview, confidence: value ? a.probability : 1 - a.probability };
}

function choiceOrScoreValue(a: ChoiceAnswer | ScoreAnswer) {
  const value = isChoice(a) ? a.choice : (a as ScoreAnswer).level;
  return { value, needsReview: a.confidence < CHOICE_REVIEW_CONFIDENCE, confidence: a.confidence };
}

// Fields that are only meaningful when a corresponding gate field is true/applicable.
// If the gate resolves false, we null the dependent field out rather than trust the
// model's answer to a question that shouldn't have applied.
const DEPENDENCIES: Record<string, string> = {
  liability_cap_amount_band: "liability_cap_present",
  liability_cap_mutual: "liability_cap_present",
  renewal_notice_period_band: "auto_renewal",
  termination_notice_period_band: "termination_for_convenience",
};

export interface ContractRow {
  contract_id: string;
  vendor_name: string;
  [field: string]: unknown;
}

export interface DecideResult {
  row: ContractRow;
  needsReview: string[]; // field names below confidence threshold, for a human QA queue
}

export function decide(state: { contract_id: string; vendor_name: string }, resp: JevResponse): DecideResult {
  const row: ContractRow = { contract_id: state.contract_id, vendor_name: state.vendor_name };
  const needsReview: string[] = [];

  for (const [field, answer] of Object.entries(resp.answers)) {
    let value: unknown;
    let flagged: boolean;

    if (isNoul(answer)) {
      ({ value, needsReview: flagged } = noulValue(answer));
    } else if (isChoice(answer) || isScore(answer)) {
      ({ value, needsReview: flagged } = choiceOrScoreValue(answer));
    } else {
      continue; // unknown shape, skip rather than write garbage
    }

    row[field] = value;
    if (flagged) needsReview.push(field);
  }

  // Null out dependent fields whose gate turned out false/not_applicable.
  for (const [dependent, gate] of Object.entries(DEPENDENCIES)) {
    if (dependent in row && row[gate] === false) {
      row[dependent] = null;
      const i = needsReview.indexOf(dependent);
      if (i !== -1) needsReview.splice(i, 1); // moot now that the gate is false
    }
  }

  return { row, needsReview };
}

// --- batch helper -----------------------------------------------------------
// One call to /systemone answers all 25 questions for one contract in parallel,
// so batching across the ~40k/yr volume just means one call per contract (or a
// small worker pool), not one call per field.

export async function processContract(
  contractId: string,
  vendorName: string,
  contractText: string,
  questions: Record<string, unknown>
): Promise<DecideResult> {
  const res = await fetch("https://ai-gateway.vercel.sh/typesafe/v1/systemone", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "typesafe-ai/jev",
      state: { contract_id: contractId, vendor_name: vendorName, contract_text: contractText },
      questions,
    }),
  });
  if (!res.ok) throw new Error(`systemone request failed: ${res.status} ${await res.text()}`);
  const resp = (await res.json()) as JevResponse;
  return decide({ contract_id: contractId, vendor_name: vendorName }, resp);
}
