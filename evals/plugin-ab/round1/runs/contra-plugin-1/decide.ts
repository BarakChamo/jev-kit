// Contradiction screen: for each retrieved passage, flag it if it conflicts with the
// verified answer key before the passage reaches the generator.

interface Passage {
  id: string;
  source: string;
  text: string;
}

interface State {
  faq_question: string;
  verified_answer: string;
  passages: Passage[];
}

type NoulAnswer = { noul: number }; // probability that "true" holds
type Answers = Record<string, NoulAnswer>;

// Build one scoped noul question per passage. Widening the passage list is free
// (independent questions, one request) — do not ask one crowded question over all passages.
function buildQuestions(state: State) {
  const questions: Record<string, unknown> = {};
  state.passages.forEach((p, i) => {
    questions[`contradicts_${p.id}`] = {
      type: "noul",
      instructions:
        `Does the claim in passages[${i}].text (id ${p.id}) state something about the same ` +
        `aspect of faq_question that conflicts with the fact stated in verified_answer?`,
      criteria: {
        true: `passages[${i}].text asserts a fact incompatible with verified_answer`,
        false:
          `passages[${i}].text agrees with verified_answer, elaborates on it without conflict, ` +
          `or does not address the same aspect`,
      },
    };
  });
  return questions;
}

// Gate on the contradiction probability, not a confidence scalar (rule 8). Low-confidence
// (mid-band) cases never fall through to "pass" — they escalate to review instead (rule on
// "low confidence must never relax a decision").
const FLAG_THRESHOLD = 0.7; // >= this: confident contradiction, block from generator
const CLEAR_THRESHOLD = 0.3; // <= this: confident no contradiction, pass through

type Verdict = "CONTRADICTS" | "UNCERTAIN" | "CLEAR";

interface PassageVerdict {
  passage: Passage;
  probability: number;
  verdict: Verdict;
}

function verdictFor(probability: number): Verdict {
  if (probability >= FLAG_THRESHOLD) return "CONTRADICTS";
  if (probability <= CLEAR_THRESHOLD) return "CLEAR";
  return "UNCERTAIN";
}

// Screen the retrieved passages before they reach the generator. UNCERTAIN passages are
// withheld along with CONTRADICTS ones — an ambiguous signal is not a green light.
function screen(state: State, answers: Answers) {
  const verdicts: PassageVerdict[] = state.passages.map((p) => {
    const probability = answers[`contradicts_${p.id}`].noul;
    return { passage: p, probability, verdict: verdictFor(probability) };
  });

  const safeForGenerator = verdicts
    .filter((v) => v.verdict === "CLEAR")
    .map((v) => v.passage);

  const flagged = verdicts.filter((v) => v.verdict !== "CLEAR");

  return { safeForGenerator, flagged, verdicts };
}
