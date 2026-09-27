// Flags RAG-retrieved passages that contradict the verified FAQ answer key,
// using Jev (System One) "noul" (probability) questions — one per passage.

export interface Passage {
  id: string;
  text: string;
  source?: string;
}

export interface State {
  faq_question: string;
  verified_answer: string;
  passages: Passage[];
}

interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria: { true: string; false: string };
}

export interface JevRequest {
  model: "typesafe-ai/jev";
  state: State;
  questions: Record<string, NoulQuestion>;
}

export interface NoulAnswer {
  probability: number;
}

export type AnswersMap = Record<string, NoulAnswer>;

// Above this probability that a passage contradicts the verified answer, drop it.
export const CONTRADICTION_THRESHOLD = 0.5;

export function buildRequest(state: State): JevRequest {
  const questions: Record<string, NoulQuestion> = {};
  for (const p of state.passages) {
    questions[p.id] = {
      type: "noul",
      instructions:
        `state.passages contains a passage with id '${p.id}'. Compare its claim to ` +
        `state.verified_answer, the verified answer to state.faq_question. Does passage ` +
        `${p.id} assert something that directly conflicts with the verified answer? ` +
        `Being silent, partial, or adding unrelated detail is NOT a contradiction.`,
      criteria: {
        true: `Passage ${p.id} makes a claim that directly conflicts with the verified answer.`,
        false: `Passage ${p.id} is consistent with, silent on, or merely less detailed than the verified answer.`,
      },
    };
  }
  return { model: "typesafe-ai/jev", state, questions };
}

export interface DecideResult {
  safe: Passage[];
  flagged: (Passage & { contradictionProbability: number })[];
}

// Splits retrieved passages into ones safe to pass to the generator and ones
// flagged as contradicting the verified answer key.
export function decide(state: State, answers: AnswersMap): DecideResult {
  const safe: DecideResult["safe"] = [];
  const flagged: DecideResult["flagged"] = [];

  for (const passage of state.passages) {
    const probability = answers[passage.id]?.probability ?? 0;
    if (probability >= CONTRADICTION_THRESHOLD) {
      flagged.push({ ...passage, contradictionProbability: probability });
    } else {
      safe.push(passage);
    }
  }

  return { safe, flagged };
}
