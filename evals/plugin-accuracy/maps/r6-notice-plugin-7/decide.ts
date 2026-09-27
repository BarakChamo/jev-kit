// Decision logic for questions.json. Takes the Jev answers for one
// (contract, cancellation email) pair and decides whether the customer
// gave enough notice to avoid automatic renewal.

type NoulAnswer = { noul: number };
type ChoiceAnswer<T extends string> = {
  choice: T;
  confidence: number;
  probabilities: Record<T, number>;
};
type ScoreAnswer<T extends string> = {
  score: T;
  confidence: number;
  legend: T[];
  probabilities: Record<T, number>;
};

type DayBucket =
  | "under_15"
  | "15_29"
  | "30_59"
  | "60_89"
  | "90_179"
  | "180_plus";
type RequiredBucket = DayBucket | "not_specified";
type ActualBucket = DayBucket | "on_or_after_deadline";

// Same ordering used in questions.json's criteria; index = more notice.
const BUCKET_ORDER: DayBucket[] = [
  "under_15",
  "15_29",
  "30_59",
  "60_89",
  "90_179",
  "180_plus",
];

export interface JevAnswers {
  autorenewal_clause_present: NoulAnswer;
  clause_clarity: ScoreAnswer<"unclear" | "partial" | "clear">;
  required_notice_days: ChoiceAnswer<RequiredBucket>;
  actual_notice_days: ChoiceAnswer<ActualBucket>;
  notice_method_satisfied: NoulAnswer;
}

export type Verdict =
  | "notice_sufficient" // enough notice given, renewal is avoided
  | "notice_insufficient" // notice was late and/or wrong method, renewal proceeds
  | "no_autorenewal_clause" // nothing to avoid; not applicable
  | "needs_human_review"; // Jev is unsure or the contract is ambiguous

export interface Decision {
  verdict: Verdict;
  reasons: string[];
}

// True/false gate on a noul probability. Values in between are "unsure":
// per the skill's rules, unsure must never relax a decision.
const TRUE_ABOVE = 0.7;
const FALSE_BELOW = 0.3;
function gateBool(a: NoulAnswer): "true" | "false" | "unsure" {
  if (a.noul >= TRUE_ABOVE) return "true";
  if (a.noul <= FALSE_BELOW) return "false";
  return "unsure";
}

export function decide(answers: JevAnswers): Decision {
  const reasons: string[] = [];

  const hasAutorenewal = gateBool(answers.autorenewal_clause_present);
  if (hasAutorenewal === "false") {
    return {
      verdict: "no_autorenewal_clause",
      reasons: ["Contract has no automatic renewal clause requiring notice."],
    };
  }
  if (hasAutorenewal === "unsure") {
    return {
      verdict: "needs_human_review",
      reasons: [
        `Unclear whether the contract auto-renews (p=${answers.autorenewal_clause_present.noul.toFixed(2)}).`,
      ],
    };
  }

  if (answers.clause_clarity.score === "unclear") {
    return {
      verdict: "needs_human_review",
      reasons: [
        "Contract does not clearly state the renewal date and/or required notice period.",
      ],
    };
  }
  if (answers.clause_clarity.score === "partial") {
    reasons.push(
      "Contract states the renewal date or notice period, but not both, without interpretation.",
    );
  }

  const required = answers.required_notice_days.choice;
  if (required === "not_specified") {
    return {
      verdict: "needs_human_review",
      reasons: [...reasons, "Required notice period could not be determined."],
    };
  }

  const actual = answers.actual_notice_days.choice;
  if (actual === "on_or_after_deadline") {
    return {
      verdict: "notice_insufficient",
      reasons: [
        ...reasons,
        "Cancellation was received on or after the renewal/term-end date, or that date could not be pinned down.",
      ],
    };
  }

  const requiredIdx = BUCKET_ORDER.indexOf(required);
  const actualIdx = BUCKET_ORDER.indexOf(actual);
  const timingSufficient = actualIdx >= requiredIdx;
  reasons.push(
    `Required notice bucket "${required}" vs actual notice bucket "${actual}".`,
  );

  const methodOk = gateBool(answers.notice_method_satisfied);
  if (methodOk === "unsure") {
    return {
      verdict: "needs_human_review",
      reasons: [
        ...reasons,
        `Unclear whether the email satisfies the contract's required notice method (p=${answers.notice_method_satisfied.noul.toFixed(2)}).`,
      ],
    };
  }
  if (methodOk === "false") {
    reasons.push("Email does not satisfy the contract's required notice method.");
  }

  const sufficient = timingSufficient && methodOk === "true";
  return {
    verdict: sufficient ? "notice_sufficient" : "notice_insufficient",
    reasons,
  };
}
