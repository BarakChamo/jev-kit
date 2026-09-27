// Turns a Jev answer set (matching questions.json) into a moderation decision.
// Thresholds are the only thing policy/trust-ops should need to tune between doc revisions.

type NoulAnswer = { probability: number };
type ScoreAnswer = { level: "none" | "low" | "moderate" | "high" | "severe" };
type ChoiceAnswer = {
  choice: "allow" | "reduce_reach" | "remove" | "remove_and_ban" | "escalate_human_review";
  confidence: number;
  probabilities: Record<string, number>;
};

export interface JevAnswers {
  hate_speech: NoulAnswer;
  harassment: NoulAnswer;
  violent_threats: NoulAnswer;
  csae: NoulAnswer;
  sexual_content: NoulAnswer;
  self_harm: NoulAnswer;
  spam_scam: NoulAnswer;
  regulated_illegal: NoulAnswer;
  severity: ScoreAnswer;
  recommended_action: ChoiceAnswer;
}

export type Action = "allow" | "reduce_reach" | "escalate_human_review" | "remove" | "remove_and_escalate";

export interface Decision {
  action: Action;
  triggeredCategories: string[];
  maxProbability: number;
  severity: ScoreAnswer["level"];
}

const CATEGORIES = [
  "hate_speech",
  "harassment",
  "violent_threats",
  "sexual_content",
  "self_harm",
  "spam_scam",
  "regulated_illegal",
] as const;

const SEVERITY_ORDER: ScoreAnswer["level"][] = ["none", "low", "moderate", "high", "severe"];

// Tunable per deploy; keep out of the LLM-generated questions.json so a policy-doc
// refresh never silently changes enforcement thresholds.
const THRESHOLDS = {
  csaeEscalate: 0.05, // zero tolerance: any real signal goes straight to specialized review
  remove: 0.85,
  review: 0.5,
};

export function decide(answers: JevAnswers): Decision {
  // CSAE is zero-tolerance and bypasses the normal scoring path entirely.
  if (answers.csae.probability >= THRESHOLDS.csaeEscalate) {
    return {
      action: "remove_and_escalate",
      triggeredCategories: ["csae"],
      maxProbability: answers.csae.probability,
      severity: answers.severity.level,
    };
  }

  const triggered = CATEGORIES.filter((c) => answers[c].probability >= THRESHOLDS.review);
  const maxProbability = Math.max(...CATEGORIES.map((c) => answers[c].probability));
  const severityRank = SEVERITY_ORDER.indexOf(answers.severity.level);

  let action: Action;
  if (maxProbability >= THRESHOLDS.remove || severityRank >= SEVERITY_ORDER.indexOf("severe")) {
    action = "remove";
  } else if (triggered.length > 0 || severityRank >= SEVERITY_ORDER.indexOf("moderate")) {
    action = "escalate_human_review";
  } else if (answers.recommended_action.choice === "reduce_reach" && answers.recommended_action.confidence >= 0.6) {
    action = "reduce_reach";
  } else {
    action = "allow";
  }

  // The model's own recommendation can only push toward stricter handling than the
  // numeric signals alone suggest, never downgrade a decision the thresholds already made.
  if (action === "allow" && answers.recommended_action.choice !== "allow" && answers.recommended_action.confidence >= 0.7) {
    action = "escalate_human_review";
  }

  return { action, triggeredCategories: triggered, maxProbability, severity: answers.severity.level };
}
