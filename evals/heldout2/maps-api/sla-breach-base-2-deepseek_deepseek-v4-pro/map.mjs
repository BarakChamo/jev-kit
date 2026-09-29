const TIMESTAMP_RE = /^\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?) UTC/;

function parseUTCDateTime(text) {
  const m = text.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))? UTC/);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
}

function parseHolidays(policyText) {
  const holidays = new Set();
  const re = /\b(\d{4}-\d{2}-\d{2})\b/g;
  let m;
  while ((m = re.exec(policyText))) {
    holidays.add(m[1]);
  }
  return holidays;
}

function formatDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function isBusiness(date, holidays) {
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = date.getUTCHours();
  if (hour < 9 || hour >= 17) return false;
  if (holidays.has(formatDateKey(date))) return false;
  return true;
}

function nextBusinessStart(date, holidays) {
  let d = new Date(date.getTime());
  d.setUTCHours(9, 0, 0, 0);
  while (d.getTime() <= date.getTime() || !isBusiness(d, holidays)) {
    d = new Date(Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate() + 1,
      9, 0, 0
    ));
  }
  return d;
}

function addBusinessHours(start, nHours, holidays) {
  let current = new Date(start.getTime());
  let remainingMs = nHours * 3600000;

  while (remainingMs > 0) {
    if (isBusiness(current, holidays)) {
      const endMs = Date.UTC(
        current.getUTCFullYear(),
        current.getUTCMonth(),
        current.getUTCDate(),
        17, 0, 0
      );
      const leftMs = endMs - current.getTime();

      if (remainingMs <= leftMs) {
        current = new Date(current.getTime() + remainingMs);
        remainingMs = 0;
      } else {
        remainingMs -= leftMs;
        current = nextBusinessStart(current, holidays);
      }
    } else {
      current = nextBusinessStart(current, holidays);
    }
  }

  return current;
}

function computeDue(priority, opened, holidays) {
  if (priority === "urgent") {
    return new Date(opened.getTime() + 3600000);
  }
  if (priority === "high") {
    return addBusinessHours(opened, 4, holidays);
  }
  if (priority === "normal" || priority === "low") {
    return addBusinessHours(opened, 16, holidays);
  }
  return null;
}

function isOpenedLine(line) {
  return /\b(?:ticket\s+(?:was\s+)?opened|opened by)\b/i.test(line);
}

function extractPriorityFromLine(line) {
  const m = line.match(/\bpriority\b.{0,30}?\b(urgent|high|normal|low)\b/i);
  return m ? m[1].toLowerCase() : null;
}

function extractPriorityFromLog(input) {
  const log = String(input.ticket_log || "");
  const lines = log.split(/\r?\n/);

  for (const line of lines) {
    if (isOpenedLine(line)) {
      const priority = extractPriorityFromLine(line);
      if (priority) return priority;
    }
  }

  const firstTimestampLine = lines.find((line) =>
    /^\s*\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(line)
  );
  return firstTimestampLine ? extractPriorityFromLine(firstTimestampLine) : null;
}

function isAgentReplyLine(line) {
  const hasReply = /\b(?:repl(?:y|ied|ies)|response|respond(?:s|ed)?)\b/i.test(line);
  if (!hasReply) return false;

  if (/\b(?:customer|user|automatic|auto[-\s]?reply|acknowledg(?:e|ment)|system\s*(?:generated|notification))\b/i.test(line)) {
    return false;
  }

  return /\b(?:support\s*agent\b|\bagent\b|\bsupport\s*rep\b|\bsupport\s*team\b|\bsupport\b)/i.test(line);
}

function extractTimes(input) {
  const log = String(input.ticket_log || "");
  const lines = log.split(/\r?\n/);
  const stamped = [];

  for (const line of lines) {
    const m = line.match(TIMESTAMP_RE);
    if (!m) continue;
    const date = parseUTCDateTime(m[0]);
    if (!date) continue;
    stamped.push({ line, date });
  }

  if (stamped.length === 0) return null;

  let openedEntry = stamped.find((entry) => isOpenedLine(entry.line));
  if (!openedEntry) openedEntry = stamped[0];

  const firstReplyEntry = stamped
    .slice(stamped.indexOf(openedEntry) + 1)
    .find((entry) => isAgentReplyLine(entry.line));

  if (!firstReplyEntry) return null;

  return {
    opened: openedEntry.date,
    firstReply: firstReplyEntry.date
  };
}

export function buildState(input) {
  return {
    policy_text: String(input.policy_text || ""),
    ticket_log: String(input.ticket_log || "")
  };
}

export function questions(input) {
  return {
    priority: {
      type: "choice",
      instructions:
        "Use the `ticket_log` in the provided state. What priority did the ticket have at the time it was opened? Use the priority that applied when the ticket was opened, even if it is changed later.",
      criteria: {
        urgent: "The ticket was opened with Urgent priority.",
        high: "The ticket was opened with High priority.",
        normal: "The ticket was opened with Normal priority.",
        low: "The ticket was opened with Low priority."
      }
    },
    breach: {
      type: "choice",
      instructions:
        "Use the `policy_text` and `ticket_log` in the provided state. Determine whether the first-response SLA was breached. Only a reply from a support agent counts as a first response; customer messages and automatic acknowledgements do not count. Compute business hours, holidays, and priorities exactly as the SLA policy states.",
      criteria: {
        yes: "The first-response SLA was breached.",
        no: "The first-response SLA was not breached.",
        abstain: "The case is ambiguous or lacks enough information; a person should decide."
      }
    }
  };
}

export function decide(answers, input) {
  const holidays = parseHolidays(String(input.policy_text || ""));
  const times = extractTimes(input);
  let priority = extractPriorityFromLog(input);

  if (!priority && answers && answers.priority && answers.priority.type === "choice") {
    const p = answers.priority;
    if (p.confidence >= 0.85 && ["urgent", "high", "normal", "low"].includes(p.choice)) {
      priority = p.choice;
    }
  }

  if (times && priority) {
    const due = computeDue(priority, times.opened, holidays);
    return times.firstReply > due ? "yes" : "no";
  }

  const breach = answers && answers.breach;
  if (breach && breach.type === "choice" && breach.confidence >= 0.85) {
    if (breach.choice === "yes" || breach.choice === "no") {
      return breach.choice;
    }
  }

  return "abstain";
}
