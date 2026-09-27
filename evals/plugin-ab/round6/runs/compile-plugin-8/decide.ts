// Consumes the answers to questions.json and turns them into a moderation action.
// Does not call the systemone API itself.
//
// Provenance: questions.json is compiled from the 12-page policy doc by an LLM, offline,
// whenever the policy team edits it (~monthly). That compile step drafts N candidate
// question maps, scores each against a labelled case set (jev-eval), and pins the winner --
// it never recompiles at request time. This file is the fixed runtime logic that consumes
// whatever questions.json currently says; it does not change when the policy does.
//
// Image/video CSAM is out of scope here -- that's hash-matched against known-CSAM databases
// by a dedicated pipeline. cat_csam_solicitation only covers text-based sexualization/
// solicitation of a minor, and any signal on it skips every other rule below.

type Noul = number;

interface Choice<T extends string> {
  choice: T;
  confidence: number;
  probabilities: Record<T, number>;
}

interface Answers {
  cat_csam_solicitation: Noul;
  cat_violence_threat: Noul;
  cat_hate_harassment: Noul;
  cat_harassment_bullying: Noul;
  cat_doxxing: Noul;
  cat_adult_sexual_content: Noul;
  cat_spam_scam: Noul;
  cat_illegal_goods: Noul;
  cat_misinfo_imminent_harm: Noul;
  cat_impersonation: Noul;
  self_harm_context: Choice<
    | "none"
    | "personal_expression_of_distress"
    | "encouragement_or_promotion_to_others"
    | "instructions_or_method_details"
  >;
  context_exception: Choice<
    | "none"
    | "journalistic_or_educational"
    | "counter_speech_condemning"
    | "clearly_marked_satire"
    | "unclear"
  >;
  injection_attempt: Noul;
}

export type Action =
  | "allow"
  | "escalate_review"
  | "remove"
  | "remove_and_escalate_severe";

export interface Decision {
  action: Action;
  reasons: string[];
}

type StandardCategory =
  | "cat_hate_harassment"
  | "cat_harassment_bullying"
  | "cat_doxxing"
  | "cat_adult_sexual_content"
  | "cat_spam_scam"
  | "cat_illegal_goods"
  | "cat_misinfo_imminent_harm"
  | "cat_impersonation";

// severe = a clear hit routes to a specialized queue (legal/trust-and-safety leads), not
// the general human-review queue that "escalate_review" means everywhere else.
const CATEGORY_CONFIG: Record<
  StandardCategory,
  { removeAt: number; escalateAt: number; severe: boolean; exceptionEligible: boolean }
> = {
  cat_hate_harassment: { removeAt: 0.9, escalateAt: 0.4, severe: false, exceptionEligible: true },
  cat_harassment_bullying: { removeAt: 0.9, escalateAt: 0.4, severe: false, exceptionEligible: true },
  cat_doxxing: { removeAt: 0.85, escalateAt: 0.35, severe: false, exceptionEligible: false },
  cat_adult_sexual_content: { removeAt: 0.9, escalateAt: 0.5, severe: false, exceptionEligible: false },
  cat_spam_scam: { removeAt: 0.9, escalateAt: 0.4, severe: false, exceptionEligible: false },
  cat_illegal_goods: { removeAt: 0.85, escalateAt: 0.35, severe: false, exceptionEligible: false },
  cat_misinfo_imminent_harm: { removeAt: 0.85, escalateAt: 0.4, severe: false, exceptionEligible: true },
  cat_impersonation: { removeAt: 0.9, escalateAt: 0.4, severe: false, exceptionEligible: false },
};

// cat_violence_threat is handled separately from the table above: a clear credible threat
// is always severe (dedicated queue, possible law-enforcement referral), never just "remove".
const VIOLENCE_REMOVE_AT = 0.85;
const VIOLENCE_ESCALATE_AT = 0.35;

const CSAM_ESCALATE_AT = 0.05; // any real signal here is worth a specialist's eyes

export function decide(a: Answers): Decision {
  const reasons: string[] = [];

  // 1. Zero-tolerance category first, bypasses everything else including exceptions.
  if (a.cat_csam_solicitation >= CSAM_ESCALATE_AT) {
    return {
      action: "remove_and_escalate_severe",
      reasons: [`cat_csam_solicitation=${a.cat_csam_solicitation.toFixed(2)}`],
    };
  }

  // 2. Self-harm is its own branch: action depends on *kind*, not just presence.
  const selfHarm = a.self_harm_context;
  if (selfHarm.confidence >= 0.5) {
    if (
      selfHarm.choice === "encouragement_or_promotion_to_others" ||
      selfHarm.choice === "instructions_or_method_details"
    ) {
      return {
        action: "remove_and_escalate_severe",
        reasons: [`self_harm_context=${selfHarm.choice} (${selfHarm.confidence.toFixed(2)})`],
      };
    }
    if (selfHarm.choice === "personal_expression_of_distress") {
      // Never remove someone's own expression of distress; a person should see it and
      // the surface layer should offer crisis resources. Never silently allow either.
      reasons.push(`self_harm_context=personal_expression_of_distress`);
      return { action: "escalate_review", reasons };
    }
  } else if (selfHarm.choice !== "none") {
    // Low-confidence read on a sensitive category: don't guess, send it to a person.
    reasons.push(`self_harm_context low confidence (${selfHarm.confidence.toFixed(2)})`);
    return { action: "escalate_review", reasons };
  }

  // 3. Manipulation detector: never let it relax a decision, only ever tighten one.
  const injected = a.injection_attempt >= 0.5;
  if (injected) reasons.push("injection_attempt detected");

  // 4. Context exception: only downgrades severity by one tier, only for eligible
  // categories, only at decent confidence, and never when an injection attempt is present
  // (an author asking the reviewer to wave the post through is not entitled to the benefit
  // of the "this is satire" claim in the same post).
  const exception = a.context_exception;
  const exceptionApplies =
    !injected && exception.choice !== "none" && exception.choice !== "unclear" && exception.confidence >= 0.6;
  if (exceptionApplies) reasons.push(`context_exception=${exception.choice} (${exception.confidence.toFixed(2)})`);

  // 5. Violence/threat.
  let worst: Action = "allow";
  if (a.cat_violence_threat >= VIOLENCE_REMOVE_AT) {
    worst = "remove_and_escalate_severe";
    reasons.push(`cat_violence_threat=${a.cat_violence_threat.toFixed(2)}`);
  } else if (a.cat_violence_threat >= VIOLENCE_ESCALATE_AT) {
    worst = "escalate_review";
    reasons.push(`cat_violence_threat=${a.cat_violence_threat.toFixed(2)} (uncertain)`);
  }

  // 6. Standard categories.
  for (const [key, cfg] of Object.entries(CATEGORY_CONFIG) as [StandardCategory, typeof CATEGORY_CONFIG[StandardCategory]][]) {
    const p = a[key];
    let tier: Action | null = null;
    if (p >= cfg.removeAt) {
      tier = cfg.exceptionEligible && exceptionApplies ? "escalate_review" : "remove";
      reasons.push(`${key}=${p.toFixed(2)}${cfg.exceptionEligible && exceptionApplies ? " (downgraded by exception)" : ""}`);
    } else if (p >= cfg.escalateAt) {
      tier = "escalate_review";
      reasons.push(`${key}=${p.toFixed(2)} (uncertain)`);
    }
    if (tier && severityRank(tier) > severityRank(worst)) worst = tier;
  }

  // Injection attempts alone never trigger removal, but they should never resolve to a
  // clean "allow" either -- flag for the abuse-pattern queue.
  if (injected && worst === "allow") {
    reasons.push("allowing but flagged for abuse-pattern review");
    return { action: "escalate_review", reasons };
  }

  return { action: worst, reasons };
}

function severityRank(action: Action): number {
  return { allow: 0, escalate_review: 1, remove: 2, remove_and_escalate_severe: 3 }[action];
}
