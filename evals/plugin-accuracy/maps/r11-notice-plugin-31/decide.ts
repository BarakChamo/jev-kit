// Decision logic for: did a cancellation email give enough notice to avoid
// automatic renewal? All date/number arithmetic runs here, never in Jev —
// Jev only reads facts out of the contract and email text (see questions.json).

type NoulAnswer = number; // P(true)

interface ChoiceAnswer {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface JevAnswers {
  has_auto_renewal: NoulAnswer;
  email_allowed: NoulAnswer;
  email_states_cancellation: NoulAnswer;
  start_year: ChoiceAnswer;
  start_month: ChoiceAnswer;
  start_day: ChoiceAnswer;
  term_length: ChoiceAnswer;
  notice_period: ChoiceAnswer;
}

export type Outcome =
  | "NOTICE_TIMELY" // renewal avoided
  | "NOTICE_LATE" // renewal not avoided
  | "INVALID_METHOD" // contract requires a different notice method than email
  | "NO_AUTO_RENEWAL" // contract doesn't auto-renew; nothing to avoid
  | "NEEDS_HUMAN_REVIEW"; // some fact wasn't read confidently enough to decide

export interface Decision {
  outcome: Outcome;
  reasons: string[];
  detail?: {
    termStart: string;
    termEnd: string;
    deadline: string;
    receivedDate: string;
    daysBeforeDeadline: number; // negative if late
  };
}

// Tune this via jev-eval against labelled cases before trusting it.
const CONF_THRESHOLD = 0.75;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const TERM_MONTHS: Record<string, number | null> = {
  "1 month": 1, "3 months": 3, "6 months": 6,
  "1 year": 12, "2 years": 24, "3 years": 36,
  "other or unclear": null,
};

const NOTICE_DAYS: Record<string, number | null> = {
  "15 days": 15, "30 days": 30, "45 days": 45,
  "60 days": 60, "90 days": 90, "120 days": 120,
  "other or unclear": null,
};

// Per-label gate: is Jev confident the label is true, confident it's false, or unsure?
// Gates on the probability mass, never on the raw `confidence` scalar (it runs
// systematically under-confident) — see jev-questions rule 8.
function noulVerdict(p: number): "true" | "false" | "unsure" {
  if (p >= CONF_THRESHOLD) return "true";
  if (p <= 1 - CONF_THRESHOLD) return "false";
  return "unsure";
}

function top2(probabilities: Record<string, number>): [string, number][] {
  return Object.entries(probabilities).sort((a, b) => b[1] - a[1]).slice(0, 2);
}

// A choice answer is only usable if Jev put enough mass on its top pick.
// Below threshold: hand the reviewer its top two labels (never re-ask a model).
function resolveChoice(
  answer: ChoiceAnswer,
  fieldLabel: string,
  reasons: string[],
): string | null {
  const p = answer.probabilities[answer.choice] ?? answer.confidence;
  if (p < CONF_THRESHOLD) {
    const [a, b] = top2(answer.probabilities);
    reasons.push(
      `${fieldLabel} unclear: top guesses ${a[0]} (${a[1].toFixed(2)}) vs ${b[0]} (${b[1].toFixed(2)})`,
    );
    return null;
  }
  return answer.choice;
}

function addMonthsUTC(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function decideNotice(receivedDateStr: string, answers: JevAnswers): Decision {
  const reasons: string[] = [];
  const receivedDate = new Date(`${receivedDateStr}T00:00:00Z`);

  const autoRenewal = noulVerdict(answers.has_auto_renewal);
  if (autoRenewal === "false") {
    return { outcome: "NO_AUTO_RENEWAL", reasons: ["contract has no automatic-renewal clause"] };
  }
  if (autoRenewal === "unsure") {
    reasons.push("unclear whether the contract auto-renews at all");
  }

  const intent = noulVerdict(answers.email_states_cancellation);
  if (intent === "false") {
    reasons.push("email does not clearly state an intent to cancel or not renew");
  } else if (intent === "unsure") {
    reasons.push("unclear whether the email states an intent to cancel or not renew");
  }

  const method = noulVerdict(answers.email_allowed);
  if (method === "unsure") {
    reasons.push("unclear whether the contract permits notice by email");
  }

  const yearStr = resolveChoice(answers.start_year, "term start year", reasons);
  const monthStr = resolveChoice(answers.start_month, "term start month", reasons);
  const dayStr = resolveChoice(answers.start_day, "term start day", reasons);
  const termLengthStr = resolveChoice(answers.term_length, "term length", reasons);
  const noticePeriodStr = resolveChoice(answers.notice_period, "notice period", reasons);

  // Any unresolved fact, or an explicit "other or unclear" bucket, means the
  // contract's math can't be computed reliably — a person decides, not a guess.
  const termMonths = termLengthStr ? TERM_MONTHS[termLengthStr] : null;
  const noticeDays = noticePeriodStr ? NOTICE_DAYS[noticePeriodStr] : null;
  if (termLengthStr === "other or unclear") reasons.push("contract's term length is non-standard or unstated");
  if (noticePeriodStr === "other or unclear") reasons.push("contract's notice period is non-standard or unstated");

  if (
    intent !== "true" ||
    autoRenewal === "unsure" ||
    method === "unsure" ||
    !yearStr || !monthStr || !dayStr ||
    termMonths == null || noticeDays == null
  ) {
    return { outcome: "NEEDS_HUMAN_REVIEW", reasons };
  }

  const termStart = new Date(
    Date.UTC(Number(yearStr), MONTHS.indexOf(monthStr), Number(dayStr)),
  );

  // Walk renewal cycles to find the boundary this notice would affect: the
  // first term end on or after the date the notice was received.
  let termEnd = addMonthsUTC(termStart, termMonths);
  let cycles = 1;
  while (termEnd.getTime() < receivedDate.getTime() && cycles < 1000) {
    cycles += 1;
    termEnd = addMonthsUTC(termStart, termMonths * cycles);
  }

  const deadline = new Date(termEnd.getTime() - noticeDays * DAY_MS);
  const daysBeforeDeadline = Math.round((deadline.getTime() - receivedDate.getTime()) / DAY_MS);
  const timely = receivedDate.getTime() <= deadline.getTime();

  const detail = {
    termStart: termStart.toISOString().slice(0, 10),
    termEnd: termEnd.toISOString().slice(0, 10),
    deadline: deadline.toISOString().slice(0, 10),
    receivedDate: receivedDateStr,
    daysBeforeDeadline,
  };

  if (method === "false") {
    return {
      outcome: "INVALID_METHOD",
      reasons: [...reasons, "contract requires a notice method other than email"],
      detail,
    };
  }

  return {
    outcome: timely ? "NOTICE_TIMELY" : "NOTICE_LATE",
    reasons,
    detail,
  };
}
