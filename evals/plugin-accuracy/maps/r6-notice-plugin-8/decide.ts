// Turns answers from questions.json into a notice-sufficiency decision.
// Gate on the probability of the label we care about (rule 8), never on
// the top-choice confidence scalar alone, and never let low confidence
// relax toward "sufficient" -- unsure always routes to human review.

type NoulAnswer = { noul: number };
type ChoiceAnswer<Opt extends string> = {
  choice: Opt;
  confidence: number;
  probabilities: Record<Opt, number>;
};

type RequiredNoticeDays =
  | "not_specified" | "0_15" | "16_30" | "31_60" | "61_90" | "91_180" | "over_180";
type NoticeTimeliness = "on_time" | "late" | "not_applicable" | "unclear";

interface JevAnswers {
  has_auto_renewal: NoulAnswer;
  required_notice_days: ChoiceAnswer<RequiredNoticeDays>;
  notice_timeliness: ChoiceAnswer<NoticeTimeliness>;
  clear_cancellation_intent: NoulAnswer;
}

type Verdict =
  | "notice_sufficient"       // auto-renewal is avoided
  | "notice_insufficient"     // contract will auto-renew
  | "not_applicable"          // no auto-renewal clause / nothing currently pending
  | "needs_human_review";     // any signal was ambiguous or under-confident

interface Decision {
  verdict: Verdict;
  reasons: string[];
  requiredNoticeDays: RequiredNoticeDays;
}

const HIGH = 0.8; // "confident yes"
const LOW = 0.2;  // "confident no"
const LABEL_GATE = 0.75; // min probability on the winning notice_timeliness label

export function decide(answers: JevAnswers): Decision {
  const reasons: string[] = [];
  const requiredNoticeDays = answers.required_notice_days.choice;

  const autoRenewalProb = answers.has_auto_renewal.noul;
  if (autoRenewalProb <= LOW) {
    return { verdict: "not_applicable", reasons: ["no active auto-renewal clause"], requiredNoticeDays };
  }
  if (autoRenewalProb < HIGH) {
    return {
      verdict: "needs_human_review",
      reasons: [`auto-renewal applicability unclear (p=${autoRenewalProb.toFixed(2)})`],
      requiredNoticeDays,
    };
  }

  const intentProb = answers.clear_cancellation_intent.noul;
  if (intentProb < HIGH) {
    return {
      verdict: "needs_human_review",
      reasons: [`cancellation intent not clearly stated (p=${intentProb.toFixed(2)})`],
      requiredNoticeDays,
    };
  }

  const timeliness = answers.notice_timeliness;
  const topProb = timeliness.probabilities[timeliness.choice];

  if (topProb < LABEL_GATE) {
    return {
      verdict: "needs_human_review",
      reasons: [`notice timing not confidently determined (top=${timeliness.choice} p=${topProb.toFixed(2)})`],
      requiredNoticeDays,
    };
  }

  switch (timeliness.choice) {
    case "on_time":
      reasons.push("notice received on or before the contractual deadline");
      return { verdict: "notice_sufficient", reasons, requiredNoticeDays };
    case "late":
      reasons.push("notice received after the contractual deadline");
      return { verdict: "notice_insufficient", reasons, requiredNoticeDays };
    case "not_applicable":
      reasons.push("no renewal currently pending under the contract");
      return { verdict: "not_applicable", reasons, requiredNoticeDays };
    case "unclear":
      reasons.push("contract does not clearly state the notice deadline");
      return { verdict: "needs_human_review", reasons, requiredNoticeDays };
  }
}
