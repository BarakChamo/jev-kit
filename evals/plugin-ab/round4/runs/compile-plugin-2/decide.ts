// Turns Jev's answers to questions.json into a moderation action.
// questions.json is compiled offline from the policy doc by an LLM (one pinned
// version per policy edit, scored on labelled cases before it replaces the
// live version — see jev-eval). This file is the only place enforcement
// thresholds live; the policy team edits the doc, not this file or the questions.

type NoulAnswer = { noul: number };

type Answers = {
  violates_hate_speech: NoulAnswer;
  violates_violent_threat: NoulAnswer;
  violates_self_harm_content: NoulAnswer;
  violates_csam: NoulAnswer;
  violates_harassment: NoulAnswer;
  violates_spam: NoulAnswer;
  violates_illegal_goods: NoulAnswer;
  claims_exemption_context: NoulAnswer;
};

type Action = "allow" | "review" | "remove" | "priority_escalation";

type Decision = {
  action: Action;
  reasons: string[]; // category ids that drove the action
};

const REMOVE_AT = 0.9;
const REVIEW_AT = 0.4;
// An exemption claim ("this is satire / a quote / reporting") is a known way
// to talk a classifier down. Don't let it turn a non-trivial signal into a
// clean allow — send it to a person instead.
const REVIEW_AT_WITH_EXEMPTION_CLAIM = 0.15;

const CONTENT_CATEGORIES = [
  "violates_hate_speech",
  "violates_violent_threat",
  "violates_self_harm_content",
  "violates_harassment",
  "violates_spam",
  "violates_illegal_goods",
] as const;

// Zero-tolerance: any non-trivial signal skips straight to a specialized queue,
// never a plain "remove" and never "allow" on low confidence.
const CSAM_ESCALATE_AT = 0.05;

export function decide(answers: Answers): Decision {
  if (answers.violates_csam.noul >= CSAM_ESCALATE_AT) {
    return { action: "priority_escalation", reasons: ["violates_csam"] };
  }

  const exemptionClaimed = answers.claims_exemption_context.noul >= 0.5;
  const reviewFloor = exemptionClaimed ? REVIEW_AT_WITH_EXEMPTION_CLAIM : REVIEW_AT;

  const removed: string[] = [];
  const forReview: string[] = [];

  for (const category of CONTENT_CATEGORIES) {
    const p = answers[category].noul;
    if (p >= REMOVE_AT) removed.push(category);
    else if (p >= reviewFloor) forReview.push(category);
  }

  if (removed.length > 0) return { action: "remove", reasons: removed };
  if (forReview.length > 0) return { action: "review", reasons: forReview };
  return { action: "allow", reasons: [] };
}
