// Flags retrieved passages that contradict the verified answer key, before they reach the generator.

interface Passage {
  id: string;
  text: string;
}

interface FaqState {
  faq_question: string;
  verified_answer: string;
  passages: Passage[];
}

// Jev response shapes per question type.
interface ChoiceAnswer {
  choice: "supports" | "contradicts" | "unrelated";
  confidence: number; // 0-1
  probabilities: Record<string, number>;
}
interface NoulAnswer {
  probability: number; // P(true)
}

type Answers = Record<string, ChoiceAnswer | NoulAnswer>;

// Builds the {questions} map for questions.json given an arbitrary set of passages.
// One "choice" question (support/contradict/unrelated) and one "noul" severity
// question per passage, so a passage only needs to trip one of the two to be flagged.
function buildQuestions(state: FaqState) {
  const questions: Record<string, unknown> = {};
  state.passages.forEach((p, i) => {
    questions[p.id] = {
      type: "choice",
      instructions: `state.faq_question is an FAQ question with verified correct answer state.verified_answer. Compare it against the passage state.passages[${i}].text (id '${p.id}'). Classify the relationship of the passage to the verified answer.`,
      criteria: {
        supports: "Passage states or implies the same fact as the verified answer, no conflicting numbers or claims.",
        contradicts: "Passage states a fact that conflicts with the verified answer (e.g. different number, opposite claim).",
        unrelated: "Passage does not address the question the verified answer is about.",
      },
    };
    questions[`${p.id}_severity`] = {
      type: "noul",
      instructions: `Is passage state.passages[${i}].text ('${p.id}') factually incompatible with state.verified_answer, such that a reader relying on the passage would reach a wrong conclusion about state.faq_question?`,
      criteria: {
        true: "The passage's claim cannot both be true and the verified answer be true.",
        false: "The passage is consistent with, silent on, or a harmless rephrasing of the verified answer.",
      },
    };
  });
  return questions;
}

interface FlaggedPassage {
  id: string;
  text: string;
  reason: "choice" | "severity" | "both";
  score: number; // max signal strength, for ranking/triage
}

const CHOICE_CONFIDENCE_THRESHOLD = 0.6;
const SEVERITY_PROB_THRESHOLD = 0.6;

// Combines both signals per passage: flag if the choice model called it a
// contradiction with enough confidence, OR the severity noul thinks it's
// incompatible — catches disagreement between the two independent checks.
function decide(state: FaqState, answers: Answers): FlaggedPassage[] {
  const flagged: FlaggedPassage[] = [];

  for (const p of state.passages) {
    const choiceAns = answers[p.id] as ChoiceAnswer | undefined;
    const severityAns = answers[`${p.id}_severity`] as NoulAnswer | undefined;

    const byChoice =
      !!choiceAns &&
      choiceAns.choice === "contradicts" &&
      choiceAns.confidence >= CHOICE_CONFIDENCE_THRESHOLD;
    const bySeverity = !!severityAns && severityAns.probability >= SEVERITY_PROB_THRESHOLD;

    if (!byChoice && !bySeverity) continue;

    flagged.push({
      id: p.id,
      text: p.text,
      reason: byChoice && bySeverity ? "both" : byChoice ? "choice" : "severity",
      score: Math.max(choiceAns?.confidence ?? 0, severityAns?.probability ?? 0),
    });
  }

  return flagged.sort((a, b) => b.score - a.score);
}

export { buildQuestions, decide, FaqState, Passage, Answers, FlaggedPassage };
