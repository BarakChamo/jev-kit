// Flags retrieved passages that contradict the CMS's canonical FAQ answer
// before they're handed to the generator.

interface Faq {
  id: string;
  question: string;
  canonicalAnswer: string;
  lastUpdated: string;
}

interface Passage {
  id: string;
  text: string;
  source: string;
  retrievedAt: string;
}

type Choice = "consistent" | "stale" | "unrelated";

interface ChoiceAnswer {
  choice: Choice;
  confidence: number;
  probabilities: Record<Choice, number>;
}

const CRITERIA = {
  consistent:
    "The passage states the same fact as the canonical answer (no material difference in numbers/policy).",
  stale:
    "The passage states a fact that contradicts the canonical answer (e.g. a different number, limit, or policy for the same topic).",
  unrelated:
    "The passage does not address the specific fact given in the canonical answer, so it cannot be judged consistent or contradictory.",
};

export function buildRequest(faq: Faq, passages: Passage[]) {
  const questions: Record<string, unknown> = {};
  for (const p of passages) {
    questions[p.id] = {
      type: "choice",
      instructions:
        `state.faq.canonicalAnswer is the current, correct answer to state.faq.question per the CMS. ` +
        `Compare it to the passage with id "${p.id}" in state.passages. Judge whether that passage's ` +
        `claim about the same fact matches the canonical answer.`,
      criteria: CRITERIA,
    };
  }
  return {
    model: "typesafe-ai/jev",
    state: { faq, passages },
    questions,
  };
}

export interface Verdict {
  passage: Passage;
  choice: Choice;
  confidence: number;
  keep: boolean;
  reason?: string;
}

// Below this confidence a "stale" call isn't reliable enough to silently
// drop the passage, but it's still risky enough to keep it out of the
// generator's context and surface it for a human to check.
const STALE_CONFIDENCE_THRESHOLD = 0.6;

export function decide(
  passages: Passage[],
  answers: Record<string, ChoiceAnswer>,
): Verdict[] {
  return passages.map((passage) => {
    const answer = answers[passage.id];
    if (!answer) {
      throw new Error(`No answer returned for passage ${passage.id}`);
    }
    const { choice, confidence } = answer;

    if (choice === "consistent" || choice === "unrelated") {
      return { passage, choice, confidence, keep: true };
    }

    // choice === "stale"
    const reason =
      confidence >= STALE_CONFIDENCE_THRESHOLD
        ? "Contradicts the CMS canonical answer; excluded and flagged for review."
        : "Possibly contradicts the CMS canonical answer (low confidence); excluded and flagged for review.";
    return { passage, choice, confidence, keep: false, reason };
  });
}

export function filterPassages(verdicts: Verdict[]): Passage[] {
  return verdicts.filter((v) => v.keep).map((v) => v.passage);
}

export function flaggedForReview(verdicts: Verdict[]): Verdict[] {
  return verdicts.filter((v) => !v.keep);
}
