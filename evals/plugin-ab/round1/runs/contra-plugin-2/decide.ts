// Flags retrieved passages that contradict the verified answer key before they reach the generator.
// One scoped `noul` question per passage (see questions.json for the request shape).

interface Passage {
  id: string;
  text: string;
}

interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria: { true: string; false: string };
}

interface SystemOneRequest {
  model: "typesafe-ai/jev";
  state: {
    faq_question: string;
    verified_answer: string;
    passages: Record<string, string>;
  };
  questions: Record<string, NoulQuestion>;
}

// noul answers come back as { [questionId]: probability }
type NoulAnswers = Record<string, number>;

const QUESTION_PREFIX = "contradicts_";

export function buildRequest(
  faqQuestion: string,
  verifiedAnswer: string,
  passages: Passage[],
): SystemOneRequest {
  const questions: Record<string, NoulQuestion> = {};
  for (const p of passages) {
    questions[`${QUESTION_PREFIX}${p.id}`] = {
      type: "noul",
      instructions:
        `Does the text in \`passages.${p.id}\` assert a fact about the answer to ` +
        `\`faq_question\` that conflicts with the fact stated in \`verified_answer\`? ` +
        `Judge only what \`passages.${p.id}\` itself asserts, not what it omits.`,
      criteria: {
        true: `passages.${p.id} states something factually incompatible with verified_answer`,
        false: `passages.${p.id} is consistent with verified_answer, silent on the point, or only paraphrases it`,
      },
    };
  }
  return {
    model: "typesafe-ai/jev",
    state: {
      faq_question: faqQuestion,
      verified_answer: verifiedAnswer,
      passages: Object.fromEntries(passages.map((p) => [p.id, p.text])),
    },
    questions,
  };
}

// Gate thresholds. Low confidence never lets a passage through un-flagged: the
// unsure band is routed to review, not to the generator.
const CONTRADICTS_THRESHOLD = 0.7;
const UNCERTAIN_BAND: [number, number] = [0.3, 0.7];

export type PassageVerdict = "pass" | "review" | "contradicts";

export function decide(answers: NoulAnswers): Record<string, PassageVerdict> {
  const verdicts: Record<string, PassageVerdict> = {};
  for (const [questionId, probability] of Object.entries(answers)) {
    if (!questionId.startsWith(QUESTION_PREFIX)) continue;
    const passageId = questionId.slice(QUESTION_PREFIX.length);
    if (probability >= CONTRADICTS_THRESHOLD) {
      verdicts[passageId] = "contradicts";
    } else if (probability >= UNCERTAIN_BAND[0]) {
      verdicts[passageId] = "review";
    } else {
      verdicts[passageId] = "pass";
    }
  }
  return verdicts;
}

// Filters the passages handed to the generator: only "pass" verdicts go through.
// "contradicts" and "review" are withheld and surfaced separately (e.g. logged,
// or shown to a human) rather than silently dropped.
export function filterForGenerator(
  passages: Passage[],
  verdicts: Record<string, PassageVerdict>,
): { toGenerator: Passage[]; flagged: (Passage & { verdict: PassageVerdict })[] } {
  const toGenerator: Passage[] = [];
  const flagged: (Passage & { verdict: PassageVerdict })[] = [];
  for (const p of passages) {
    const verdict = verdicts[p.id] ?? "review";
    if (verdict === "pass") {
      toGenerator.push(p);
    } else {
      flagged.push({ ...p, verdict });
    }
  }
  return { toGenerator, flagged };
}
