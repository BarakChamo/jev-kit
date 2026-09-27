// Logic layer for the auto-renewal notice decision.
// Jev supplies the interpretive judgments (questions.json); this file does the
// deterministic date math and final ruling.

interface Facts {
  cancellationReceivedDate: string; // ISO date, e.g. "2026-08-01"
  currentTermEndDate: string; // ISO date the current term would auto-renew on
}

interface NoulAnswer {
  probability: number;
}

interface ChoiceAnswer<T extends string = string> {
  choice: T;
  confidence: number;
  probabilities: Record<T, number>;
}

interface JevAnswers {
  autoRenewal: NoulAnswer;
  requiredNoticeDays: ChoiceAnswer<"15" | "30" | "45" | "60" | "90" | "unspecified">;
  noticeMethodCompliant: NoulAnswer;
  cancellationIntentClear: NoulAnswer;
}

export type Decision =
  | "NO_AUTO_RENEWAL_CLAUSE" // nothing to avoid; notice is moot
  | "RENEWAL_AVOIDED" // valid, on-time notice
  | "RENEWAL_NOT_AVOIDED" // valid notice, but too late
  | "INVALID_NOTICE" // wrong method and/or intent unclear, regardless of timing
  | "NEEDS_REVIEW"; // contract doesn't state a notice period; can't compute a deadline

export interface DecisionResult {
  decision: Decision;
  noticeDeadline: string | null;
  daysLate: number | null;
  confidence: number;
  reasons: string[];
}

const TRUE_THRESHOLD = 0.5;

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

export function decide(facts: Facts, answers: JevAnswers): DecisionResult {
  const reasons: string[] = [];

  if (answers.autoRenewal.probability < TRUE_THRESHOLD) {
    return {
      decision: "NO_AUTO_RENEWAL_CLAUSE",
      noticeDeadline: null,
      daysLate: null,
      confidence: 1 - answers.autoRenewal.probability,
      reasons: ["Contract does not appear to auto-renew; no notice is required."],
    };
  }

  const methodOk = answers.noticeMethodCompliant.probability >= TRUE_THRESHOLD;
  const intentOk = answers.cancellationIntentClear.probability >= TRUE_THRESHOLD;
  if (!methodOk) reasons.push("Cancellation was not sent via a contractually compliant method.");
  if (!intentOk) reasons.push("Cancellation email does not clearly express intent to cancel/not renew.");

  if (answers.requiredNoticeDays.choice === "unspecified") {
    return {
      decision: "NEEDS_REVIEW",
      noticeDeadline: null,
      daysLate: null,
      confidence: answers.requiredNoticeDays.confidence,
      reasons: [...reasons, "Contract does not state a notice period; deadline cannot be computed automatically."],
    };
  }

  const noticeDays = Number(answers.requiredNoticeDays.choice);
  const termEnd = new Date(facts.currentTermEndDate);
  const deadline = new Date(termEnd);
  deadline.setDate(deadline.getDate() - noticeDays);
  const received = new Date(facts.cancellationReceivedDate);

  const daysLate = Math.max(0, daysBetween(received, deadline));
  const onTime = received.getTime() <= deadline.getTime();
  if (!onTime) reasons.push(`Notice received ${daysLate} day(s) after the ${noticeDays}-day deadline.`);

  const confidence = Math.min(
    answers.autoRenewal.probability,
    answers.requiredNoticeDays.confidence,
    answers.noticeMethodCompliant.probability >= TRUE_THRESHOLD
      ? answers.noticeMethodCompliant.probability
      : 1 - answers.noticeMethodCompliant.probability,
    answers.cancellationIntentClear.probability >= TRUE_THRESHOLD
      ? answers.cancellationIntentClear.probability
      : 1 - answers.cancellationIntentClear.probability
  );

  const decision: Decision =
    !methodOk || !intentOk ? "INVALID_NOTICE" : onTime ? "RENEWAL_AVOIDED" : "RENEWAL_NOT_AVOIDED";

  return {
    decision,
    noticeDeadline: deadline.toISOString().slice(0, 10),
    daysLate: onTime ? 0 : daysLate,
    confidence,
    reasons,
  };
}
