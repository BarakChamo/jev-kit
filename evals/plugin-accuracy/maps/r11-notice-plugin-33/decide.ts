// Decision logic for: "did this cancellation give enough notice to avoid auto-renewal?"
// Consumes the answers to questions.json. All date/length arithmetic and the
// on-time comparison happen here in code — Jev only supplies buckets read from text.

interface NoulAnswer {
  noul: number; // P(true)
}

interface ChoiceAnswer<T extends string = string> {
  choice: T;
  confidence: number;
  probabilities: Record<T, number>;
}

interface Answers {
  has_auto_renewal: NoulAnswer;
  start_year: ChoiceAnswer;
  start_month: ChoiceAnswer;
  start_day: ChoiceAnswer;
  initial_term_months: ChoiceAnswer;
  renewal_term_months: ChoiceAnswer;
  notice_period_days: ChoiceAnswer;
  email_method_restricted: NoulAnswer;
  email_requests_cancellation: NoulAnswer;
}

const CONF_THRESHOLD = 0.75; // gate on the answer's own probability, not a global scalar
const NOUL_TRUE = 0.75;
const NOUL_FALSE = 0.25;

const MONTHS: Record<string, number> = {
  January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
  July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
};

function monthsFromBucket(bucket: string): number | null {
  const m = bucket.match(/^(\d+)_months?$/);
  return m ? Number(m[1]) : null; // null covers "other" / "same_as_initial" / "not_stated"
}

function daysFromBucket(bucket: string): number | null {
  const m = bucket.match(/^(\d+)_days$/);
  return m ? Number(m[1]) : null;
}

export type Decision =
  | { outcome: "renewal_avoided"; deadline: string; termEnd: string }
  | { outcome: "insufficient_notice"; reason: string; deadline?: string; termEnd?: string }
  | { outcome: "needs_human_review"; reason: string };

export function decide(a: Answers, receivedDateISO: string): Decision {
  // 1. Low-confidence critical facts always escalate — never relaxed into "allow".
  const criticalChoices: [string, ChoiceAnswer][] = [
    ["start_year", a.start_year],
    ["start_month", a.start_month],
    ["start_day", a.start_day],
    ["initial_term_months", a.initial_term_months],
    ["notice_period_days", a.notice_period_days],
  ];
  for (const [name, ans] of criticalChoices) {
    if (ans.confidence < CONF_THRESHOLD) {
      return { outcome: "needs_human_review", reason: `low confidence reading ${name} (${ans.confidence.toFixed(2)})` };
    }
  }

  // 2. No auto-renewal clause -> nothing to avoid.
  if (a.has_auto_renewal.noul < NOUL_TRUE) {
    if (a.has_auto_renewal.noul > NOUL_FALSE) {
      return { outcome: "needs_human_review", reason: "unclear whether contract auto-renews" };
    }
    return { outcome: "renewal_avoided", deadline: receivedDateISO, termEnd: receivedDateISO };
  }

  // 3. Email content must clearly be a cancellation / non-renewal notice.
  if (a.email_requests_cancellation.noul < NOUL_TRUE) {
    if (a.email_requests_cancellation.noul > NOUL_FALSE) {
      return { outcome: "needs_human_review", reason: "unclear whether the email requests cancellation" };
    }
    return { outcome: "insufficient_notice", reason: "email does not clearly request cancellation/non-renewal" };
  }

  // 4. Notice method must be acceptable.
  if (a.email_method_restricted.noul > NOUL_TRUE) {
    return { outcome: "insufficient_notice", reason: "contract requires a notice method other than email" };
  }
  if (a.email_method_restricted.noul > NOUL_FALSE) {
    return { outcome: "needs_human_review", reason: "unclear whether contract permits notice by email" };
  }

  // 5. Unusable buckets on required fields -> escalate rather than guess.
  const startYear = a.start_year.choice;
  const startMonth = a.start_month.choice;
  const startDay = a.start_day.choice;
  if (startYear === "not_stated" || startYear === "before_2010" || startYear === "after_2028" ||
      startMonth === "not_stated" || startDay === "not_stated") {
    return { outcome: "needs_human_review", reason: "contract start date not readable in the covered range" };
  }
  const initialMonths = monthsFromBucket(a.initial_term_months.choice);
  if (initialMonths === null) {
    return { outcome: "needs_human_review", reason: "initial term length not readable ('other'/'not stated')" };
  }
  const noticeDays = daysFromBucket(a.notice_period_days.choice);
  if (noticeDays === null) {
    return { outcome: "needs_human_review", reason: "notice period not readable ('other'/'not stated')" };
  }
  const renewalBucket = a.renewal_term_months.choice;
  const renewalMonths = renewalBucket === "same_as_initial" ? initialMonths : monthsFromBucket(renewalBucket);
  if (renewalMonths === null) {
    return { outcome: "needs_human_review", reason: "renewal term length not readable ('other')" };
  }

  // 6. Walk term boundaries forward from the start date until we pass the received date;
  //    that boundary is the renewal this cancellation is trying to stop.
  const start = new Date(Date.UTC(Number(startYear), MONTHS[startMonth], Number(startDay)));
  const received = new Date(receivedDateISO + "T00:00:00Z");

  let termEnd = new Date(start);
  termEnd.setUTCMonth(termEnd.getUTCMonth() + initialMonths);
  while (termEnd <= received) {
    termEnd = new Date(termEnd);
    termEnd.setUTCMonth(termEnd.getUTCMonth() + renewalMonths);
  }

  const deadline = new Date(termEnd);
  deadline.setUTCDate(deadline.getUTCDate() - noticeDays);

  const iso = (d: Date) => d.toISOString().slice(0, 10);

  if (received <= deadline) {
    return { outcome: "renewal_avoided", deadline: iso(deadline), termEnd: iso(termEnd) };
  }
  return {
    outcome: "insufficient_notice",
    reason: `received ${receivedDateISO} is after the ${noticeDays}-day deadline`,
    deadline: iso(deadline),
    termEnd: iso(termEnd),
  };
}
