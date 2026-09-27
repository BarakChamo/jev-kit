// Decision logic that runs on the answers to questions.json.
// Jev supplies judgments read from prose (auto-renewal existence, the stated notice
// period bucket, permitted method, clarity of the email). Everything with an explicit
// date or number — the renewal deadline, and whether the email arrived before it —
// is computed here in code, per the "derive vs ask" rule: comparisons of quantities
// should be asked as buckets and compared in code, never asked directly.

type NoulAnswer = { noul: number };
type ChoiceAnswer<T extends string> = {
  choice: T;
  confidence: number;
  probabilities: Record<T, number>;
};

type NoticeBucket =
  | "15" | "30" | "45" | "60" | "90" | "120" | "over_120" | "not_specified";

interface JevAnswers {
  auto_renewal_exists: NoulAnswer;
  notice_period_days: ChoiceAnswer<NoticeBucket>;
  method_allows_email: NoulAnswer;
  cancellation_email_is_clear: NoulAnswer;
}

interface CaseInput {
  cancellation_received_date: string; // ISO date
  renewal_date: string; // ISO date; see deriveRenewalDate() below for how this is obtained
}

// Gate on the probability of the label we care about (rule 8), not the `confidence`
// scalar, which the study found systematically under-confident by up to 29 points.
const TRUE_GATE = 0.7;
const FALSE_GATE = 0.3;

function gate(p: number): "true" | "false" | "uncertain" {
  if (p >= TRUE_GATE) return "true";
  if (p <= FALSE_GATE) return "false";
  return "uncertain";
}

// Midpoint of each bucket, used only to compute the deadline. "not_specified" and
// "over_120" have no safe single value, so they're handled as escalations below
// rather than guessed at.
const BUCKET_DAYS: Record<NoticeBucket, number | null> = {
  "15": 15,
  "30": 30,
  "45": 45,
  "60": 60,
  "90": 90,
  "120": 120,
  over_120: null,
  not_specified: null,
};

type Decision =
  | "NO_AUTO_RENEWAL" // contract doesn't auto-renew; notice is moot
  | "SUFFICIENT_NOTICE" // auto-renewal avoided
  | "INSUFFICIENT_NOTICE" // auto-renewal proceeds
  | "NEEDS_HUMAN_REVIEW";

interface Result {
  decision: Decision;
  reasons: string[];
  topAlternative?: NoticeBucket; // runner-up notice-period label, per rule 9
}

export function decide(input: CaseInput, answers: JevAnswers): Result {
  const reasons: string[] = [];

  const autoRenewal = gate(answers.auto_renewal_exists.noul);
  if (autoRenewal === "false") {
    return { decision: "NO_AUTO_RENEWAL", reasons: ["contract does not auto-renew"] };
  }
  if (autoRenewal === "uncertain") {
    // Low confidence must never relax a decision (rule: cascade/gate rules) — escalate,
    // never default to "sufficient notice".
    return {
      decision: "NEEDS_HUMAN_REVIEW",
      reasons: [`auto-renewal existence uncertain (p=${answers.auto_renewal_exists.noul.toFixed(2)})`],
    };
  }

  const noticeChoice = answers.notice_period_days;
  const requiredDays = BUCKET_DAYS[noticeChoice.choice];
  if (requiredDays === null) {
    return {
      decision: "NEEDS_HUMAN_REVIEW",
      reasons: [`notice period is "${noticeChoice.choice}" — cannot compute a deadline`],
      topAlternative: secondBest(noticeChoice),
    };
  }

  const deadline = new Date(input.renewal_date);
  deadline.setDate(deadline.getDate() - requiredDays);
  const receivedOnTime = new Date(input.cancellation_received_date) <= deadline;
  reasons.push(
    `required ${requiredDays}d notice -> deadline ${deadline.toISOString().slice(0, 10)}; ` +
      `received ${input.cancellation_received_date} -> ${receivedOnTime ? "on time" : "late"}`,
  );

  const methodOk = gate(answers.method_allows_email.noul);
  if (methodOk === "uncertain") {
    return {
      decision: "NEEDS_HUMAN_REVIEW",
      reasons: [...reasons, `whether email is an accepted notice method is uncertain (p=${answers.method_allows_email.noul.toFixed(2)})`],
    };
  }
  if (methodOk === "false") reasons.push("contract does not accept email as a notice method");

  const clearIntent = gate(answers.cancellation_email_is_clear.noul);
  if (clearIntent === "uncertain") {
    return {
      decision: "NEEDS_HUMAN_REVIEW",
      reasons: [...reasons, `clarity of cancellation intent uncertain (p=${answers.cancellation_email_is_clear.noul.toFixed(2)})`],
    };
  }
  if (clearIntent === "false") reasons.push("email does not clearly state cancellation/non-renewal intent");

  const sufficient = receivedOnTime && methodOk === "true" && clearIntent === "true";
  return { decision: sufficient ? "SUFFICIENT_NOTICE" : "INSUFFICIENT_NOTICE", reasons };
}

function secondBest<T extends string>(answer: ChoiceAnswer<T>): T {
  return (Object.entries(answer.probabilities) as [T, number][])
    .filter(([label]) => label !== answer.choice)
    .sort((a, b) => b[1] - a[1])[0][0];
}

// -----------------------------------------------------------------------------
// renewal_date is a date-arithmetic fact, not a judgment call, so it's derived
// deterministically rather than asked of Jev (Jev has no free-text/date answer
// type — only noul, choice and score). In production this would typically already
// be normalized at contract ingestion (a CLM field); this best-effort fallback
// parser covers the common "Effective Date ... Initial Term of N years/months"
// phrasing so the pipeline still runs end-to-end on raw text. Any contract it
// can't parse should route straight to NEEDS_HUMAN_REVIEW rather than guessing.
export function deriveRenewalDate(contractText: string): string | null {
  const effective = contractText.match(
    /Effective Date[,:]?\s*(?:is\s*)?([A-Za-z]+\s+\d{1,2},\s*\d{4}|\d{4}-\d{2}-\d{2})/i,
  );
  const term = contractText.match(/(?:initial\s+)?term\s+of\s+(\w+)\s*\((\d+)\)\s*(year|month)/i);
  if (!effective || !term) return null;

  const start = new Date(effective[1]);
  if (isNaN(start.getTime())) return null;
  const amount = parseInt(term[2], 10);
  const unit = term[3].toLowerCase();
  const end = new Date(start);
  if (unit === "year") end.setFullYear(end.getFullYear() + amount);
  else end.setMonth(end.getMonth() + amount);
  return end.toISOString().slice(0, 10);
}
