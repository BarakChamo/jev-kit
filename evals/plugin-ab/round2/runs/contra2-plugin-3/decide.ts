// Flags retrieved passages that contradict the CMS's current canonical FAQ answer,
// before they reach the generator. questions.json shows the request shape for one
// example FAQ; buildQuestions() generates the real per-passage questions at runtime,
// since the passage count and ids vary per query.

type Passage = { id: string; text: string };

type ChoiceAnswer = {
  choice: "contradicts" | "consistent" | "unrelated";
  confidence: number;
  probabilities: Record<"contradicts" | "consistent" | "unrelated", number>;
};

const CONTRADICTS_THRESHOLD = 0.7; // gate on the label probability, not `confidence`
const CONSISTENT_THRESHOLD = 0.7;

export function buildQuestions(faqQuestion: string, canonicalAnswer: string, passages: Passage[]) {
  const questions: Record<string, unknown> = {};
  for (const p of passages) {
    questions[`status_${p.id}`] = {
      type: "choice",
      instructions:
        `Compare passages.${p.id}.text against canonical_answer, which is the support team's ` +
        `current, authoritative answer to faq_question. Does passages.${p.id}.text state a fact ` +
        `about the same topic that conflicts with canonical_answer, does it agree with ` +
        `canonical_answer, or does it not address the fact(s) in canonical_answer at all?`,
      criteria: {
        contradicts:
          `passages.${p.id}.text makes a claim about the same fact as canonical_answer that ` +
          `conflicts with it (e.g. a different limit, price, feature availability, or policy)`,
        consistent:
          `passages.${p.id}.text agrees with canonical_answer, or states a subset of it, with ` +
          `no conflicting claim`,
        unrelated: `passages.${p.id}.text does not address the specific fact(s) stated in canonical_answer`,
      },
    };
  }
  return {
    model: "typesafe-ai/jev",
    state: { faq_question: faqQuestion, canonical_answer: canonicalAnswer, passages },
    questions,
  };
}

export type PassageVerdict = {
  id: string;
  action: "keep" | "drop_stale" | "needs_review";
  choice: ChoiceAnswer["choice"];
  probability: number; // probability of the returned choice
};

// Low confidence never relaxes toward "keep" — ambiguous cases are excluded and
// routed to a human, same as a confirmed contradiction, per the passage's answer.
export function decide(answers: Record<string, ChoiceAnswer>, passages: Passage[]): PassageVerdict[] {
  return passages.map((p) => {
    const a = answers[`status_${p.id}`];
    const pTop = a.probabilities[a.choice];

    let action: PassageVerdict["action"];
    if (a.choice === "contradicts" && pTop >= CONTRADICTS_THRESHOLD) {
      action = "drop_stale";
    } else if ((a.choice === "consistent" || a.choice === "unrelated") && pTop >= CONSISTENT_THRESHOLD) {
      action = "keep"; // unrelated passages aren't wrong, just not on-topic for this fact
    } else {
      action = "needs_review"; // ambiguous — exclude from the generator, flag for a human
    }

    return { id: p.id, action, choice: a.choice, probability: a.probabilities[a.choice] };
  });
}

export function filterForGenerator(verdicts: PassageVerdict[], passages: Passage[]): Passage[] {
  const keep = new Set(verdicts.filter((v) => v.action === "keep").map((v) => v.id));
  return passages.filter((p) => keep.has(p.id));
}
