// Turns one Jev answer set (from questions.json) into a moderation action.
//
// Architecture note: the *question map* is compiled offline from the current policy
// doc by an LLM, scored against a labelled case set, and pinned as questions.json —
// never recompiled at request time. Only when policy team edits the 12-pager does
// someone re-run the compiler, re-score the draft, and swap the pinned file. This
// file is the only place thresholds and actions are decided; Jev only answers facts.

type Noul = { noul: number } // probability the "true" criterion holds
type Choice<T extends string> = { choice: T; confidence: number; probabilities: Record<T, number> }

export interface Answers {
  hate_speech: Noul
  credible_violence_threat: Noul
  targeted_harassment: Noul
  adult_sexual_content: Noul
  minor_sexual_content: Noul
  self_harm_promotion: Noul
  regulated_goods_illegal_activity: Noul
  scam_fraud: Noul
  doxxing: Noul
  reviewer_manipulation: Noul
  context_sufficiency: Choice<'sufficient' | 'insufficient'>
}

type Category = Exclude<keyof Answers, 'context_sufficiency' | 'reviewer_manipulation'>

export type Action =
  | { kind: 'allow' }
  | { kind: 'remove'; reason: Category }
  | { kind: 'remove_and_report'; reason: 'minor_sexual_content' }
  | { kind: 'remove_show_resources'; reason: 'self_harm_promotion' }
  | { kind: 'escalate_human'; reason: string }

// Policy call, not Jev's: probability of "true" needed to remove outright, and the
// lower probability that still puts it in the unsure band for a human queue.
// Tune against labelled cases (jev-eval) before shipping, and whenever the policy
// doc's wording for a category changes.
const GATES: Record<Category, { remove: number; escalate: number }> = {
  minor_sexual_content: { remove: 0.3, escalate: 0.1 }, // zero-tolerance: false negatives are unacceptable
  credible_violence_threat: { remove: 0.8, escalate: 0.4 },
  self_harm_promotion: { remove: 0.8, escalate: 0.4 },
  hate_speech: { remove: 0.85, escalate: 0.5 },
  regulated_goods_illegal_activity: { remove: 0.85, escalate: 0.5 },
  doxxing: { remove: 0.85, escalate: 0.5 },
  targeted_harassment: { remove: 0.85, escalate: 0.5 },
  adult_sexual_content: { remove: 0.85, escalate: 0.5 },
  scam_fraud: { remove: 0.85, escalate: 0.5 },
}

const REVIEWER_MANIPULATION_ESCALATE = 0.3 // detector: on its own it never removes, only escalates
const CONTEXT_CONFIDENCE_FLOOR = 0.6

export function decide(answers: Answers): Action {
  // Unsure or manipulated reads never get treated as "allow" — they escalate.
  if (
    answers.context_sufficiency.choice === 'insufficient' ||
    answers.context_sufficiency.confidence < CONTEXT_CONFIDENCE_FLOOR
  ) {
    return { kind: 'escalate_human', reason: 'context_sufficiency' }
  }
  if (answers.reviewer_manipulation.noul >= REVIEWER_MANIPULATION_ESCALATE) {
    return { kind: 'escalate_human', reason: 'reviewer_manipulation' }
  }

  // Zero-tolerance category, checked first, with its own report path.
  if (answers.minor_sexual_content.noul >= GATES.minor_sexual_content.remove) {
    return { kind: 'remove_and_report', reason: 'minor_sexual_content' }
  }
  if (answers.minor_sexual_content.noul >= GATES.minor_sexual_content.escalate) {
    return { kind: 'escalate_human', reason: 'minor_sexual_content' }
  }

  if (answers.self_harm_promotion.noul >= GATES.self_harm_promotion.remove) {
    return { kind: 'remove_show_resources', reason: 'self_harm_promotion' }
  }

  const standard: Category[] = [
    'credible_violence_threat',
    'hate_speech',
    'regulated_goods_illegal_activity',
    'doxxing',
    'targeted_harassment',
    'adult_sexual_content',
    'scam_fraud',
  ]
  for (const cat of standard) {
    if (answers[cat].noul >= GATES[cat].remove) return { kind: 'remove', reason: cat }
  }
  for (const cat of [...standard, 'self_harm_promotion'] as Category[]) {
    if (answers[cat].noul >= GATES[cat].escalate) return { kind: 'escalate_human', reason: cat }
  }

  return { kind: 'allow' }
}
