// Decision logic that consumes answers to the questions in questions.json
// (one Jev call per contract+cancellation pair) and decides whether the
// customer gave enough notice to avoid automatic renewal.

interface NoulAnswer {
  probability: number; // P(true) per the question's criteria
}

interface ChoiceAnswer {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

interface JevAnswers {
  auto_renewal_clause: NoulAnswer;
  required_notice_days: ChoiceAnswer;
  valid_cancellation_notice: NoulAnswer;
  notice_timely: NoulAnswer;
}

interface CaseInput {
  contractId: string;
  cancellationId: string;
  currentTermEnd: string; // "YYYY-MM-DD"
  dateReceived: string; // "YYYY-MM-DD"
  answers: JevAnswers;
}

export type Decision =
  | "no_auto_renewal" // contract doesn't auto-renew; notice question moot
  | "invalid_notice_renewal_proceeds" // notice wasn't a valid cancellation
  | "notice_sufficient" // timely notice, auto-renewal avoided
  | "notice_insufficient" // late notice, auto-renewal proceeds
  | "needs_review"; // low confidence or conflicting signals

export interface CaseResult {
  contractId: string;
  cancellationId: string;
  decision: Decision;
  reasons: string[];
}

const TRUE_THRESHOLD = 0.7;
const FALSE_THRESHOLD = 0.3;

type Verdict = "true" | "false" | "uncertain";

function classify(probability: number): Verdict {
  if (probability >= TRUE_THRESHOLD) return "true";
  if (probability <= FALSE_THRESHOLD) return "false";
  return "uncertain";
}

const NOTICE_DAYS_BY_BUCKET: Record<string, number | null> = {
  "15_days": 15,
  "30_days": 30,
  "45_days": 45,
  "60_days": 60,
  "90_days": 90,
  "120_days": 120,
  other_or_unspecified: null,
};

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

export function decide(input: CaseInput): CaseResult {
  const { answers } = input;
  const reasons: string[] = [];

  const autoRenewal = classify(answers.auto_renewal_clause.probability);
  if (autoRenewal === "false") {
    return {
      contractId: input.contractId,
      cancellationId: input.cancellationId,
      decision: "no_auto_renewal",
      reasons: ["Contract has no automatic renewal clause; notice is not required."],
    };
  }
  if (autoRenewal === "uncertain") {
    reasons.push(
      `Uncertain whether contract auto-renews (p=${answers.auto_renewal_clause.probability.toFixed(2)}).`
    );
  }

  const validNotice = classify(answers.valid_cancellation_notice.probability);
  if (validNotice === "false") {
    return {
      contractId: input.contractId,
      cancellationId: input.cancellationId,
      decision: "invalid_notice_renewal_proceeds",
      reasons: ["Email does not qualify as valid cancellation notice under the contract's form requirements."],
    };
  }
  if (validNotice === "uncertain") {
    reasons.push(
      `Uncertain whether the email is a valid cancellation notice (p=${answers.valid_cancellation_notice.probability.toFixed(2)}).`
    );
  }

  // Deterministic check: bucketed notice-period days vs. actual dates.
  const bucketDays = NOTICE_DAYS_BY_BUCKET[answers.required_notice_days.choice];
  let deterministicTimely: boolean | null = null;
  if (bucketDays != null) {
    const termEnd = new Date(input.currentTermEnd);
    const received = new Date(input.dateReceived);
    const daysBeforeTermEnd = daysBetween(termEnd, received);
    deterministicTimely = daysBeforeTermEnd >= bucketDays;
    reasons.push(
      `Deterministic check: ${daysBeforeTermEnd} days of notice given, ${bucketDays} required (bucket "${answers.required_notice_days.choice}").`
    );
  } else {
    reasons.push("Required notice period could not be resolved to a concrete day count; relying on Jev's direct assessment.");
  }

  const jevTimely = classify(answers.notice_timely.probability);

  if (deterministicTimely !== null) {
    const jevAgrees = jevTimely === "uncertain" || (jevTimely === "true") === deterministicTimely;
    if (!jevAgrees) {
      reasons.push(
        `Deterministic date check (${deterministicTimely ? "timely" : "late"}) disagrees with Jev's own assessment (p=${answers.notice_timely.probability.toFixed(2)}).`
      );
      return { contractId: input.contractId, cancellationId: input.cancellationId, decision: "needs_review", reasons };
    }
    return {
      contractId: input.contractId,
      cancellationId: input.cancellationId,
      decision: deterministicTimely ? "notice_sufficient" : "notice_insufficient",
      reasons,
    };
  }

  if (jevTimely === "uncertain" || autoRenewal === "uncertain" || validNotice === "uncertain") {
    reasons.push("Insufficient confidence to decide without human review.");
    return { contractId: input.contractId, cancellationId: input.cancellationId, decision: "needs_review", reasons };
  }

  reasons.push(`Relying on Jev's direct timeliness assessment (p=${answers.notice_timely.probability.toFixed(2)}).`);
  return {
    contractId: input.contractId,
    cancellationId: input.cancellationId,
    decision: jevTimely === "true" ? "notice_sufficient" : "notice_insufficient",
    reasons,
  };
}
