// Turns a Jev response (answers to questions.json) into a moderation decision.
// The questions themselves are policy-generated and can change shape every time the
// policy doc is edited, so this logic reads criteria (e.g. score level order) from
// questions.json at runtime rather than hard-coding it, and only assumes the presence
// of a handful of well-known question ids (self_harm_risk, recommended_action, ...).

import questionsFile from "./questions.json";

type NoulAnswer = { probability: number };
type ScoreAnswer = { level: string; confidence: number };
type ChoiceAnswer = { choice: string; confidence: number; probabilities: Record<string, number> };
type JevAnswer = NoulAnswer | ScoreAnswer | ChoiceAnswer;
export type JevAnswers = Record<string, JevAnswer>;

const QUESTIONS = questionsFile.questions as Record<
  string,
  { type: "noul" | "score" | "choice"; criteria: string[] | Record<string, string> }
>;

const NOUL_VIOLATION_THRESHOLD = 0.85;
const CONFIDENCE_ESCALATION_THRESHOLD = 0.6;

const ACTIONS = ["allow", "label", "remove", "remove_and_suspend"] as const;
type Action = (typeof ACTIONS)[number];
const SEVERITY: Record<Action, number> = { allow: 0, label: 1, remove: 2, remove_and_suspend: 3 };

function scoreLevelIndex(questionId: string, level: string): number {
  const q = QUESTIONS[questionId];
  if (!q || q.type !== "score") throw new Error(`${questionId} is not a score question`);
  const idx = (q.criteria as string[]).indexOf(level);
  if (idx === -1) throw new Error(`unknown level "${level}" for ${questionId}`);
  return idx;
}

export interface Decision {
  action: Action;
  escalateToHuman: boolean;
  reasons: string[];
}

export function decide(answers: JevAnswers): Decision {
  const reasons: string[] = [];
  let escalate = false;

  // Mandatory safety override: any real self-harm signal always reaches a human, regardless
  // of what everything else says. Never fully automate this category.
  const selfHarm = answers.self_harm_risk as ScoreAnswer | undefined;
  if (selfHarm && scoreLevelIndex("self_harm_risk", selfHarm.level) >= scoreLevelIndex("self_harm_risk", "ideation")) {
    escalate = true;
    reasons.push(`self_harm_risk=${selfHarm.level}: routed to human safety queue`);
  }

  // Start from Jev's own holistic recommendation.
  const rec = answers.recommended_action as ChoiceAnswer | undefined;
  let action: Action = (rec?.choice as Action) ?? "allow";
  if (rec) {
    reasons.push(`recommended_action=${rec.choice} (confidence ${rec.confidence.toFixed(2)})`);
    if (rec.confidence < CONFIDENCE_ESCALATION_THRESHOLD) {
      escalate = true;
      reasons.push("low-confidence recommendation: routed to human review");
    }
  } else {
    escalate = true;
    reasons.push("missing recommended_action answer: routed to human review");
  }

  // Defense in depth: if a hard-violation signal disagrees with a lenient recommendation,
  // escalate to a human rather than silently overriding or trusting the disagreement away.
  for (const id of ["incites_violence", "hate_speech", "spam_or_scam"] as const) {
    const a = answers[id] as NoulAnswer | undefined;
    if (a && a.probability >= NOUL_VIOLATION_THRESHOLD && SEVERITY[action] < SEVERITY.remove) {
      escalate = true;
      reasons.push(`${id}=${a.probability.toFixed(2)} conflicts with recommended_action=${action}: routed to human review`);
    }
  }

  return { action, escalateToHuman: escalate, reasons };
}
