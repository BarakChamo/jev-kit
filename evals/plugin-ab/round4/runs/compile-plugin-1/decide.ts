// Turns answers from questions.json into a moderation action.
// Thresholds are tuned per category on labelled cases (see jev-eval), not guessed.

type NoulAnswer = { noul: number };
type ChoiceAnswer<T extends string> = { choice: T; confidence: number; probabilities: Record<T, number> };

interface PostState {
  post_text: string;
  is_reply: boolean;
  target_type: "individual_named" | "public_figure" | "group" | "none";
  quoted_or_reporting: boolean;
  has_media: boolean;
  media_description: string | null;
  author_prior_strikes: number;
}

interface JevAnswers {
  hate_speech: NoulAnswer;
  targeted_harassment: NoulAnswer;
  violent_threat: NoulAnswer;
  sexual_exploitation: NoulAnswer;
  self_harm_promotion: NoulAnswer;
  doxxing: NoulAnswer;
  spam_or_scam: NoulAnswer;
  regulated_goods: NoulAnswer;
  content_context: ChoiceAnswer<"own_statement" | "counter_speech_or_report" | "unclear">;
  review_flag: ChoiceAnswer<"clear" | "genuinely_ambiguous">;
}

type Category = Exclude<keyof JevAnswers, "sexual_exploitation" | "content_context" | "review_flag">;
type Action = "allow" | "restrict_visibility" | "remove" | "escalate_human";

interface Decision {
  action: Action;
  matchedCategories: string[];
  reasons: string[];
}

// remove: auto-remove above this probability. escalate: route to a human above this probability.
const THRESHOLDS: Record<Category, { remove: number; escalate: number }> = {
  hate_speech: { remove: 0.9, escalate: 0.5 },
  targeted_harassment: { remove: 0.9, escalate: 0.5 },
  violent_threat: { remove: 0.85, escalate: 0.4 },
  self_harm_promotion: { remove: 0.85, escalate: 0.4 },
  doxxing: { remove: 0.9, escalate: 0.5 },
  spam_or_scam: { remove: 0.9, escalate: 0.6 },
  regulated_goods: { remove: 0.9, escalate: 0.5 },
};

export function decide(state: PostState, answers: JevAnswers): Decision {
  // Zero-tolerance: sexual exploitation of a minor / NCII has no counter-speech exception
  // and skips every other gate.
  if (answers.sexual_exploitation.noul >= 0.5) {
    return {
      action: "remove",
      matchedCategories: ["sexual_exploitation"],
      reasons: [`sexual_exploitation p=${answers.sexual_exploitation.noul.toFixed(2)} — zero-tolerance category, routed to specialized review`],
    };
  }

  const matched: string[] = [];
  const reasons: string[] = [];
  let worst: Action = "allow";

  for (const key of Object.keys(THRESHOLDS) as Category[]) {
    const p = answers[key].noul;
    const { remove, escalate } = THRESHOLDS[key];
    if (p >= remove) {
      matched.push(key);
      reasons.push(`${key} p=${p.toFixed(2)} >= remove threshold ${remove}`);
      worst = "remove";
    } else if (p >= escalate) {
      matched.push(key);
      reasons.push(`${key} p=${p.toFixed(2)} in escalate band [${escalate}, ${remove})`);
      if (worst !== "remove") worst = "restrict_visibility";
    }
  }

  // Repeat offenders don't get the benefit of a borderline call.
  if (worst === "restrict_visibility" && state.author_prior_strikes >= 2) {
    worst = "remove";
    reasons.push(`author_prior_strikes=${state.author_prior_strikes} — repeat offender, borderline case escalated to remove`);
  }

  const isCounterSpeech =
    answers.content_context.choice === "counter_speech_or_report" && answers.content_context.confidence >= 0.6;

  // Low confidence, or a flagged genuine ambiguity, must never relax a decision toward "allow" —
  // it can only push a case to a human, never wave it through.
  const forceHumanReview =
    answers.review_flag.choice === "genuinely_ambiguous" ||
    answers.review_flag.confidence < 0.55 ||
    answers.content_context.confidence < 0.5;

  if (worst === "remove") {
    if (isCounterSpeech) {
      reasons.push("content_context=counter_speech_or_report — downgraded from auto-remove to human review");
      return { action: "escalate_human", matchedCategories: matched, reasons };
    }
    return { action: "remove", matchedCategories: matched, reasons };
  }

  if (worst === "restrict_visibility" || forceHumanReview) {
    if (forceHumanReview) reasons.push("review_flag=genuinely_ambiguous or low meta-confidence — routed to a human");
    return { action: "escalate_human", matchedCategories: matched, reasons };
  }

  return { action: "allow", matchedCategories: matched, reasons: ["no category above its escalate threshold"] };
}
