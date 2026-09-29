// SLA first-response breach checker built on Jev.
//
// Design: Jev is asked only for the semantic reading of the ticket log
// (which entry is a genuine support-agent reply, what priority the ticket
// opened with, whether the policy deviates from the two standard rules this
// map assumes). All dates, business-hour arithmetic and policy numbers are
// read/parsed and computed in code, never asked of Jev as a comparison.

const PRIORITIES = ["Urgent", "High", "Normal", "Low"];

function splitLogLines(ticket_log) {
  return String(ticket_log || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractTimestamp(line) {
  const m = /(\d{4})-(\d{2})-(\d{2})[^\d]{1,4}(\d{1,2}):(\d{2})/.exec(line || "");
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
}

function canonicalTier(label) {
  const l = label.toLowerCase();
  return PRIORITIES.find((p) => l.includes(p.toLowerCase())) || null;
}

function parsePolicy(policy_text) {
  const text = String(policy_text || "");
  const result = { bStart: null, bEnd: null, bDays: null, holidays: new Set(), targets: {} };

  const hoursMatch = /(\d{1,2}):(\d{2})\s*(?:to|-|–)\s*(\d{1,2}):(\d{2})\s*UTC/i.exec(text);
  if (hoursMatch) {
    result.bStart = +hoursMatch[1];
    result.bEnd = +hoursMatch[3];
  }

  const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const wdRe = new RegExp(`(${weekdayNames.join("|")})\\s*(?:to|-|–)\\s*(${weekdayNames.join("|")})`, "i");
  const wdMatch = wdRe.exec(text);
  if (wdMatch) {
    const startIdx = weekdayNames.findIndex((w) => w.toLowerCase() === wdMatch[1].toLowerCase());
    const endIdx = weekdayNames.findIndex((w) => w.toLowerCase() === wdMatch[2].toLowerCase());
    const days = new Set();
    if (startIdx <= endIdx) {
      for (let i = startIdx; i <= endIdx; i++) days.add(i);
    } else {
      for (let i = startIdx; i <= 6; i++) days.add(i);
      for (let i = 0; i <= endIdx; i++) days.add(i);
    }
    result.bDays = days;
  }

  const holidaySection = /holidays?:\s*([^\n]*)/i.exec(text);
  const holidaySource = holidaySection ? holidaySection[1] : text;
  const dateRe = /\d{4}-\d{2}-\d{2}/g;
  let dm;
  while ((dm = dateRe.exec(holidaySource))) result.holidays.add(dm[0]);

  const targetRe = /([A-Za-z][A-Za-z/ ]*?)\s*:\s*within\s+([\d.]+)\s*(business\s+)?(hour|hours|day|days|minute|minutes)([^\n.]*)/gi;
  let tm;
  while ((tm = targetRe.exec(text))) {
    const labels = tm[1]
      .split(/,|\band\b/i)
      .map((s) => s.trim())
      .filter(Boolean);
    const amount = parseFloat(tm[2]);
    const businessFlag = !!tm[3];
    const unitRaw = tm[4].toLowerCase();
    const unit = unitRaw.startsWith("hour") ? "hour" : unitRaw.startsWith("day") ? "day" : "minute";
    const trailing = tm[5] || "";
    const calendarPhrase = /around the clock|all days,? ?all hours|24\/7|24x7/i.test(trailing + tm[0]);
    const calendar = calendarPhrase;
    const ambiguous = !(businessFlag || calendarPhrase);
    for (const raw of labels) {
      const tier = canonicalTier(raw);
      if (tier) result.targets[tier] = { amount, unit, calendar, ambiguous };
    }
  }

  return result;
}

function targetToHours(target, policy) {
  if (target.unit === "hour") return target.amount;
  if (target.unit === "minute") return target.amount / 60;
  // day
  if (target.calendar) return target.amount * 24;
  if (policy.bStart == null || policy.bEnd == null) return null;
  return target.amount * (policy.bEnd - policy.bStart);
}

function computeBusinessHoursElapsed(start, end, bStart, bEnd, bDays, holidays) {
  if (end <= start) return 0;
  let total = 0;
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cursor <= endDay) {
    const weekday = cursor.getUTCDay();
    const dateStr = cursor.toISOString().slice(0, 10);
    if (bDays.has(weekday) && !holidays.has(dateStr)) {
      const winStart = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(), bStart, 0));
      const winEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(), bEnd, 0));
      const overlapStart = winStart < start ? start : winStart;
      const overlapEnd = winEnd > end ? end : winEnd;
      if (overlapEnd > overlapStart) total += (overlapEnd - overlapStart) / 3600000;
    }
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return total;
}

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    ticket_log: input.ticket_log,
    log_entries: splitLogLines(input.ticket_log),
  };
}

export function questions(input) {
  const entries = splitLogLines(input.ticket_log);
  const replyCriteria = {};
  entries.forEach((e, i) => {
    replyCriteria[String(i)] = `log_entries[${i}] is that reply: "${e}"`;
  });
  replyCriteria.none = "no entry in log_entries is a genuine reply from a support agent";

  return {
    opening_is_first: {
      type: "noul",
      instructions:
        "Does `log_entries[0]` describe the ticket being opened (created), stating the priority it was given at that time?",
      criteria: {
        true: "log_entries[0] is the ticket-open event with a stated priority",
        false: "log_entries[0] is something else, or no priority is stated there",
      },
    },
    priority: {
      type: "choice",
      instructions:
        "What priority does `log_entries[0]` state the ticket had when it was originally opened? Ignore any priority change mentioned later in `log_entries`.",
      criteria: {
        Urgent: "log_entries[0] states the ticket was opened as Urgent priority",
        High: "log_entries[0] states the ticket was opened as High priority",
        Normal: "log_entries[0] states the ticket was opened as Normal priority",
        Low: "log_entries[0] states the ticket was opened as Low priority",
      },
    },
    reply_entry: {
      type: "choice",
      instructions:
        "Reading `log_entries` in order, which entry is the FIRST one that is a genuine reply from a human support agent to the customer? Do not pick a customer's own message, and do not pick an automatic/system-generated acknowledgement — only a personal reply from a support agent counts.",
      criteria: replyCriteria,
    },
    has_agent_reply: {
      type: "noul",
      instructions:
        "In `log_entries`, is there at least one message from a human support agent (not an automatic system message, not a message from the customer) sent after the ticket was opened?",
      criteria: {
        true: "at least one genuine support-agent reply exists in log_entries",
        false: "no genuine support-agent reply exists in log_entries",
      },
    },
    priority_governs_exception: {
      type: "noul",
      instructions:
        "Does `policy_text` say that something other than the priority the ticket had when it was opened determines which first-response target applies (for example, a priority it was later changed to)?",
      criteria: {
        true: "policy_text states such an exception to opening-priority governing",
        false: "policy_text has no such exception; the opening priority governs, as usual",
      },
    },
    auto_ack_counts_exception: {
      type: "noul",
      instructions:
        "Does `policy_text` say that an automatic acknowledgement or a message from the customer can count as the ticket's first response?",
      criteria: {
        true: "policy_text states such an exception",
        false: "policy_text has no such exception; only a support agent's reply counts, as usual",
      },
    },
  };
}

function topProb(ans) {
  if (!ans || !ans.probabilities) return ans && typeof ans.confidence === "number" ? ans.confidence : 0;
  return Math.max(...Object.values(ans.probabilities));
}

const GATE_OPEN = 0.7;
const GATE_PRIORITY = 0.6;
const GATE_REPLY = 0.6;
const GATE_EXCEPTION = 0.4;

export function decide(answers, input) {
  const policy = parsePolicy(input.policy_text);
  const entries = splitLogLines(input.ticket_log);

  if ((answers.priority_governs_exception?.noul ?? 0) > GATE_EXCEPTION) return { breached: "abstain" };
  if ((answers.auto_ack_counts_exception?.noul ?? 0) > GATE_EXCEPTION) return { breached: "abstain" };

  if ((answers.opening_is_first?.noul ?? 0) < GATE_OPEN) return { breached: "abstain" };
  const openLine = entries[0];
  const openDate = openLine ? extractTimestamp(openLine) : null;
  if (!openDate) return { breached: "abstain" };

  const priorityAns = answers.priority;
  if (!priorityAns || topProb(priorityAns) < GATE_PRIORITY) return { breached: "abstain" };
  const tier = priorityAns.choice;

  const replyAns = answers.reply_entry;
  if (!replyAns || topProb(replyAns) < GATE_REPLY) return { breached: "abstain" };

  const hasReplyNoul = answers.has_agent_reply?.noul ?? 0.5;
  const pickedNone = replyAns.choice === "none";
  if (pickedNone && hasReplyNoul >= 0.6) return { breached: "abstain" };
  if (!pickedNone && hasReplyNoul <= 0.3) return { breached: "abstain" };
  if (pickedNone) return { breached: "abstain" }; // no first response yet; can't compute without "now"

  const replyIdx = parseInt(replyAns.choice, 10);
  const replyLine = entries[replyIdx];
  const replyDate = replyLine ? extractTimestamp(replyLine) : null;
  if (!replyDate) return { breached: "abstain" };

  const target = policy.targets[tier];
  if (!target || target.ambiguous) return { breached: "abstain" };

  let elapsedHours, targetHours;
  if (target.calendar) {
    elapsedHours = (replyDate - openDate) / 3600000;
    targetHours = targetToHours(target, policy);
  } else {
    if (policy.bStart == null || policy.bEnd == null || !policy.bDays) return { breached: "abstain" };
    elapsedHours = computeBusinessHoursElapsed(openDate, replyDate, policy.bStart, policy.bEnd, policy.bDays, policy.holidays);
    targetHours = targetToHours(target, policy);
  }
  if (targetHours == null) return { breached: "abstain" };

  const breached = elapsedHours > targetHours + 1e-9;
  return { breached: breached ? "yes" : "no" };
}
