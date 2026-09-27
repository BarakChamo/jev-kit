// Decision logic over the answers to questions.json. Bucket comparison happens here (Jev is
// unreliable at holding one extracted quantity against another; it's fine at naming the band
// a quantity falls in), and low confidence always escalates rather than defaulting to "allow".

type NoulAnswer = { noul: number };
type ChoiceAnswer = { choice: string; confidence: number; probabilities: Record<string, number> };

export interface JevAnswers {
  auto_renewal_clause: NoulAnswer;
  required_notice_band: ChoiceAnswer;
  actual_lead_band: ChoiceAnswer;
  clear_cancellation_intent: NoulAnswer;
  method_compliant: NoulAnswer;
}

export type Verdict =
  | "SUFFICIENT_NOTICE"
  | "INSUFFICIENT_NOTICE"
  | "NOT_APPLICABLE" // no auto-renewal clause to avoid
  | "NEEDS_HUMAN_REVIEW";

export interface Decision {
  verdict: Verdict;
  reasons: string[];
}

const TRUE_THRESHOLD = 0.75;
const FALSE_THRESHOLD = 0.25;
const CHOICE_CONFIDENCE_THRESHOLD = 0.6;

// Shared rank so "required" and "actual" bands compare directly. Sentinels ("unspecified",
// "not_ascertainable") are absent here on purpose: they can't be ranked, only escalated.
const BAND_RANK: Record<string, number> = {
  none: 0,
  "0_or_less": 0,
  "1_15": 1,
  "16_30": 2,
  "31_60": 3,
  "61_90": 4,
  "91_120": 5,
  over_120: 6,
};

function noulIsTrue(a: NoulAnswer): boolean | undefined {
  if (a.noul >= TRUE_THRESHOLD) return true;
  if (a.noul <= FALSE_THRESHOLD) return false;
  return undefined; // uncertain
}

function topProbability(a: ChoiceAnswer): number {
  return a.probabilities[a.choice] ?? a.confidence;
}

export function decide(answers: JevAnswers): Decision {
  const reasons: string[] = [];

  const hasAutoRenewal = noulIsTrue(answers.auto_renewal_clause);
  if (hasAutoRenewal === undefined) {
    return { verdict: "NEEDS_HUMAN_REVIEW", reasons: ["uncertain whether contract auto-renews"] };
  }
  if (hasAutoRenewal === false) {
    return { verdict: "NOT_APPLICABLE", reasons: ["contract has no auto-renewal clause"] };
  }

  if (topProbability(answers.required_notice_band) < CHOICE_CONFIDENCE_THRESHOLD) {
    return { verdict: "NEEDS_HUMAN_REVIEW", reasons: ["low confidence reading required notice period"] };
  }
  if (answers.required_notice_band.choice === "unspecified") {
    return { verdict: "NEEDS_HUMAN_REVIEW", reasons: ["contract doesn't state a specific notice period"] };
  }

  if (topProbability(answers.actual_lead_band) < CHOICE_CONFIDENCE_THRESHOLD) {
    return { verdict: "NEEDS_HUMAN_REVIEW", reasons: ["low confidence reading term-end date / lead time"] };
  }
  if (answers.actual_lead_band.choice === "not_ascertainable") {
    return { verdict: "NEEDS_HUMAN_REVIEW", reasons: ["contract has no ascertainable term-end date"] };
  }

  const intentClear = noulIsTrue(answers.clear_cancellation_intent);
  if (intentClear === undefined) {
    return { verdict: "NEEDS_HUMAN_REVIEW", reasons: ["unclear whether email states intent to cancel"] };
  }
  if (intentClear === false) {
    return { verdict: "INSUFFICIENT_NOTICE", reasons: ["email does not clearly request cancellation/non-renewal"] };
  }

  const methodOk = noulIsTrue(answers.method_compliant);
  if (methodOk === undefined) {
    return { verdict: "NEEDS_HUMAN_REVIEW", reasons: ["unclear whether notice was given in the required manner"] };
  }
  if (methodOk === false) {
    return { verdict: "INSUFFICIENT_NOTICE", reasons: ["notice was not given in the manner the contract requires"] };
  }

  const requiredRank = BAND_RANK[answers.required_notice_band.choice];
  const actualRank = BAND_RANK[answers.actual_lead_band.choice];

  if (actualRank >= requiredRank) {
    return {
      verdict: "SUFFICIENT_NOTICE",
      reasons: [
        `required ${answers.required_notice_band.choice}, actual lead ${answers.actual_lead_band.choice}`,
      ],
    };
  }
  return {
    verdict: "INSUFFICIENT_NOTICE",
    reasons: [
      `required ${answers.required_notice_band.choice}, actual lead ${answers.actual_lead_band.choice}`,
    ],
  };
}
