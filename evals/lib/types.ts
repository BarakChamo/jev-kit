/** TypeSafe System One question/answer shapes, as documented at docs.typesafe.ai/api. */

export type NoulQuestion = {
  type: 'noul';
  instructions: string;
  criteria?: { true?: string; false?: string };
};

export type ChoiceQuestion = {
  type: 'choice';
  instructions: string;
  /** option name -> rubric description (null when the name says enough) */
  criteria: Record<string, string | null>;
};

export type ScoreQuestion = {
  type: 'score';
  instructions: string;
  /** ordered level descriptions, lowest first, at least two */
  criteria: string[];
};

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type Questions = Record<string, Question>;

export type NoulAnswer = { type: 'noul'; noul: number };
export type ChoiceAnswer = {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};
export type ScoreAnswer = {
  type: 'score';
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
};

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export type State = string | Record<string, unknown> | unknown[];

/** What every model call in this repo reports back, so arms stay comparable. */
export type CallMeta = {
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  /** USD as the gateway billed it (can be 0 while a model is promotional) */
  costUsd: number;
  /** USD at the model's published list price — the number the economics argument rests on */
  listCostUsd: number;
};
