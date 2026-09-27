// Decision logic for questions.json. Jev is asked only for facts that must be read from
// prose (renewal clause, notice-period bucket, permitted method, clarity of the email,
// a manipulation claim). Dates and the day-count comparison are done here in code.

type Noul = { noul: number };
type Choice<K extends string> = { choice: K; confidence: number; probabilities: Record<K, number> };

type NoticePeriodBucket =
  | "none" | "lt15" | "d15_29" | "d30_44" | "d45_59"
  | "d60_89" | "d90_119" | "d120_179" | "d180_364" | "d365plus" | "unclear";

export interface JevAnswers {
  auto_renews: Noul;
  notice_period_required: Choice<NoticePeriodBucket>;
  notice_method_permits_email: Noul;
  is_clear_cancellation: Noul;
  claims_prior_agreement: Noul;
}

export interface CaseInput {
  contractText: string;
  cancellationEmailText: string;
  emailReceivedDate: string; // ISO date
  currentTermEndDate: string; // ISO date; the renewal date this notice would need to beat
}

export type Decision =
  | { outcome: "sufficient_notice"; reasons: string[] }
  | { outcome: "insufficient_notice"; reasons: string[] }
  | { outcome: "escalate"; reasons: string[] };

const TRUE_GATE = 0.8;
const FALSE_GATE = 0.2;

// [minDays, maxDays] before term end that the bucket covers, inclusive.
const BUCKET_RANGE: Record<NoticePeriodBucket, [number, number]> = {
  none: [0, 0],
  lt15: [1, 14],
  d15_29: [15, 29],
  d30_44: [30, 44],
  d45_59: [45, 59],
  d60_89: [60, 89],
  d90_119: [90, 119],
  d120_179: [120, 179],
  d180_364: [180, 364],
  d365plus: [365, Infinity],
  unclear: [NaN, NaN],
};

function daysBetween(fromISO: string, toISO: string): number {
  const MS_PER_DAY = 86_400_000;
  return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / MS_PER_DAY);
}

export function decideNoticeSufficiency(input: CaseInput, a: JevAnswers): Decision {
  const reasons: string[] = [];
  const actualDaysNotice = daysBetween(input.emailReceivedDate, input.currentTermEndDate);

  // Low confidence never relaxes the decision - it always escalates instead.
  if (a.auto_renews.noul > FALSE_GATE && a.auto_renews.noul < TRUE_GATE) {
    return { outcome: "escalate", reasons: ["unsure whether the contract auto-renews"] };
  }
  if (a.auto_renews.noul <= FALSE_GATE) {
    return { outcome: "sufficient_notice", reasons: ["contract does not auto-renew; no notice was required"] };
  }
  reasons.push("contract auto-renews unless timely notice is given");

  if (a.is_clear_cancellation.noul < TRUE_GATE) {
    return { outcome: "escalate", reasons: [...reasons, "email does not clearly state cancellation/non-renewal"] };
  }

  if (a.claims_prior_agreement.noul > FALSE_GATE) {
    // Not itself disqualifying, but a claim of an out-of-band waiver needs a human to verify.
    return { outcome: "escalate", reasons: [...reasons, "email claims a prior waiver/approval that must be verified"] };
  }

  if (a.notice_method_permits_email.noul > FALSE_GATE && a.notice_method_permits_email.noul < TRUE_GATE) {
    return { outcome: "escalate", reasons: [...reasons, "unsure whether email is a permitted notice method"] };
  }
  if (a.notice_method_permits_email.noul <= FALSE_GATE) {
    return { outcome: "insufficient_notice", reasons: [...reasons, "contract does not accept email as a notice method"] };
  }
  reasons.push("email is a permitted notice method");

  const bucket = a.notice_period_required.choice;
  if (bucket === "unclear" || a.notice_period_required.confidence < TRUE_GATE) {
    return { outcome: "escalate", reasons: [...reasons, "required notice period could not be determined"] };
  }
  if (bucket === "none") {
    return { outcome: "sufficient_notice", reasons: [...reasons, "contract requires no advance notice"] };
  }

  const [minDays, maxDays] = BUCKET_RANGE[bucket];
  reasons.push(`contract requires ${minDays}-${isFinite(maxDays) ? maxDays : "365+"} days notice`);
  reasons.push(`customer gave ${actualDaysNotice} days notice`);

  if (actualDaysNotice > maxDays) {
    return { outcome: "sufficient_notice", reasons };
  }
  if (actualDaysNotice < minDays) {
    return { outcome: "insufficient_notice", reasons };
  }
  // actualDaysNotice falls inside the same bucket as the requirement: the exact required
  // value within [minDays, maxDays] is unknown, so this case can't be called automatically.
  return { outcome: "escalate", reasons: [...reasons, "notice given falls in the same range as the requirement; too close to call"] };
}
