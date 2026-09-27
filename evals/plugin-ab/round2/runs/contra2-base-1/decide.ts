// Staleness check for RAG passages, via Jev (POST /typesafe/v1/systemone).
// Each passage was matched to an FAQ; the CMS holds that FAQ's canonical
// current answer. We ask one "noul" question per passage: does it
// contradict/supersede the canonical answer? Then threshold the probability.

export interface Passage {
  id: string;
  text: string;
  faq_id: string;
  faq_question: string;
  canonical_answer: string;
}

export interface JevState {
  passages: Passage[];
}

type NoulQuestion = {
  type: "noul";
  instructions: string;
  criteria: { true: string; false: string };
};

// Build the {"model", "state", "questions"} request body for a given set of passages.
export function buildRequest(passages: Passage[]) {
  const questions: Record<string, NoulQuestion> = {};
  for (const p of passages) {
    questions[`stale_${p.id}`] = {
      type: "noul",
      instructions:
        `A retrieved passage was matched to an FAQ question. Compare the passage's ` +
        `factual claims to the canonical current answer maintained by the support ` +
        `team, which is ground truth today.\n\n` +
        `FAQ question: "${p.faq_question}"\n` +
        `Canonical current answer: "${p.canonical_answer}"\n` +
        `Retrieved passage: "${p.text}"\n\n` +
        `Does the passage assert a fact (number, policy, feature, price, deadline, ` +
        `etc.) that contradicts or has been superseded by the canonical answer? ` +
        `Ignore differences in wording, tone, or extra non-conflicting detail.`,
      criteria: {
        true: "The passage states a fact that conflicts with or is outdated relative to the canonical current answer.",
        false: "The passage is factually consistent with the canonical current answer.",
      },
    };
  }
  return {
    model: "typesafe-ai/jev",
    state: { passages } satisfies JevState,
    questions,
  };
}

// Jev's response shape for a "noul" question.
export interface NoulAnswer {
  probability: number;
}

export type Verdict = "stale" | "review" | "ok";

export interface Decision {
  passage_id: string;
  probability: number;
  verdict: Verdict;
}

const STALE_THRESHOLD = 0.6; // >= this: confidently stale, drop/flag before the generator
const REVIEW_THRESHOLD = 0.4; // [this, STALE): ambiguous, flag for human review

export function decide(
  passages: Passage[],
  answers: Record<string, NoulAnswer>
): Decision[] {
  return passages.map((p) => {
    const answer = answers[`stale_${p.id}`];
    if (!answer) {
      throw new Error(`missing Jev answer for passage ${p.id}`);
    }
    const probability = answer.probability;
    const verdict: Verdict =
      probability >= STALE_THRESHOLD
        ? "stale"
        : probability >= REVIEW_THRESHOLD
        ? "review"
        : "ok";
    return { passage_id: p.id, probability, verdict };
  });
}

// Passages to keep sending to the generator: drop confidently stale ones.
export function filterForGeneration(
  passages: Passage[],
  decisions: Decision[]
): Passage[] {
  const staleIds = new Set(
    decisions.filter((d) => d.verdict === "stale").map((d) => d.passage_id)
  );
  return passages.filter((p) => !staleIds.has(p.id));
}
