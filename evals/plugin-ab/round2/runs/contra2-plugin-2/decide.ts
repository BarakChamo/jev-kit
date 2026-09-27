// Flags stale/wrong retrieved passages before they reach the generator,
// by checking each passage against the CMS canonical answer for the
// FAQ the user's question was matched to.

const STALE_THRESHOLD = 0.7;   // flag as wrong: P(contradicts) at or above this
const ESCALATE_LOW = 0.4;      // below STALE_THRESHOLD but above this: unsure, don't pass through silently

type Passage = { id: string; text: string; source: string; retrieved_at: string };

type MatchedFaq = { id: string; question: string; canonical_answer: string };

type ChoiceAnswer = {
  choice: "consistent" | "contradicts" | "unrelated";
  confidence: number;
  probabilities: Record<"consistent" | "contradicts" | "unrelated", number>;
};

// Builds the request body for an arbitrary set of passages (questions.json
// shows the fixed two-passage instance this produces for p1/p2).
export function buildRequest(userQuestion: string, matchedFaq: MatchedFaq, passages: Passage[]) {
  const questions: Record<string, unknown> = {};
  for (const p of passages) {
    questions[`${p.id}_status`] = {
      type: "choice",
      instructions: `Compare the claim in passages.${p.id}.text to matched_faq.canonical_answer, which is the current, correct answer to matched_faq.question.`,
      criteria: {
        consistent: `passages.${p.id}.text states a fact about the same topic as matched_faq.canonical_answer, and that fact matches matched_faq.canonical_answer`,
        contradicts: `passages.${p.id}.text states a fact about the same topic as matched_faq.canonical_answer, and that fact conflicts with or is superseded by matched_faq.canonical_answer`,
        unrelated: `passages.${p.id}.text does not state a fact that overlaps with matched_faq.canonical_answer, so it cannot be checked against it`,
      },
    };
  }
  return {
    model: "typesafe-ai/jev",
    state: { user_question: userQuestion, matched_faq: matchedFaq, passages },
    questions,
  };
}

export type PassageVerdict = {
  id: string;
  action: "drop" | "review" | "keep";
  contradictsProbability: number;
  topLabels: [string, string]; // for the reviewer, not for another model
};

// Gate on the probability of "contradicts", not the confidence scalar (it's
// under-confident). Low confidence never turns into a pass-through: an
// unsure passage is escalated for human review, never silently kept.
export function decide(answers: Record<string, ChoiceAnswer>, passages: Passage[]): PassageVerdict[] {
  return passages.map((p) => {
    const a = answers[`${p.id}_status`];
    const pContradicts = a.probabilities.contradicts;

    const ranked = (Object.entries(a.probabilities) as [string, number][]).sort((x, y) => y[1] - x[1]);
    const topLabels: [string, string] = [ranked[0][0], ranked[1][0]];

    let action: PassageVerdict["action"];
    if (pContradicts >= STALE_THRESHOLD) {
      action = "drop";
    } else if (pContradicts >= ESCALATE_LOW) {
      action = "review";
    } else {
      action = "keep";
    }

    return { id: p.id, action, contradictsProbability: pContradicts, topLabels };
  });
}
