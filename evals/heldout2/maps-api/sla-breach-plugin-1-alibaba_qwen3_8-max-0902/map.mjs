const MIN_P = 0.6;
const ABSTAIN = { breached: "abstain" };

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

function criteriaFrom(values) {
  const out = {};
  for (const value of values) out[String(value)] = String(value);
  return out;
}

function numericCriteria(start, end) {
  const out = {};
  for (let i = start; i <= end; i++) {
    const plain = String(i);
    const padded = i < 10 ? `0${plain}` : plain;
    out[plain] = plain;
    if (!(padded in out)) out[padded] = padded;
  }
  return out;
}

function withUnknown(criteria) {
  return {
    ...criteria,
    unknown: "The value is not present or cannot be determined",
  };
}

const YEAR_CRITERIA = withUnknown(criteriaFrom(range(2000, 2100)));
const MONTH_CRITERIA = withUnknown(numericCriteria(1, 12));
const DAY_CRITERIA = withUnknown(numericCriteria(1, 31));
const HOUR_CRITERIA = withUnknown(numericCriteria(0, 23));
const MINUTE_CRITERIA = withUnknown(numericCriteria(0, 59));

const PARTS = {
  year: { criteria: YEAR_CRITERIA, phrase: "year" },
  month: { criteria: MONTH_CRITERIA, phrase: "month number (1-12)" },
  day: { criteria: DAY_CRITERIA, phrase: "day of month (1-31)" },
  hour: { criteria: HOUR_CRITERIA, phrase: "hour (0-23)" },
  minute: { criteria: MINUTE_CRITERIA, phrase: "minute (0-59)" },
};

const OPEN_WHEN = "on the line where the customer opened the ticket";
const RESPONSE_WHEN =
  "of the first reply from a support agent, not a customer message and not an automatic acknowledgement";

function componentQuestion(part, when) {
  const spec = PARTS[part];
  return {
    type: "choice",
    instructions: `In \`ticket_log\`, what is the ${spec.phrase} of the UTC timestamp ${when}? Choose unknown if the timestamp is not present.`,
    criteria: spec.criteria,
  };
}

export function buildState(input) {
  const i = input || {};
  return {
    policy_text: i.policy_text ?? "",
    ticket_log: i.ticket_log ?? "",
    sla_convention:
      "Use `policy_text` as the SLA source. The priority at ticket opening applies. Only a support-agent reply counts as first response. For business-hour targets, count only business hours defined in `policy_text`.",
  };
}

export function questions(input) {
  return {
    has_open: {
      type: "noul",
      instructions:
        "Does `ticket_log` include a line stating that the ticket was opened by the customer?",
      criteria: {
        true: "A ticket opening by the customer is shown",
        false: "No ticket opening by the customer is shown",
      },
    },
    has_agent_reply: {
      type: "noul",
      instructions:
        "Does `ticket_log` include at least one reply from a support agent, not a customer message and not an automatic acknowledgement?",
      criteria: {
        true: "At least one support-agent reply is shown",
        false: "No support-agent reply is shown",
      },
    },
    open_priority: {
      type: "choice",
      instructions:
        "What priority does `ticket_log` state the ticket had when it was opened? Use the priority at opening, even if a later message changes it.",
      criteria: {
        urgent: "Opened as Urgent",
        high: "Opened as High",
        normal: "Opened as Normal",
        low: "Opened as Low",
        unknown: "The opening priority is not stated",
      },
    },
    open_year: componentQuestion("year", OPEN_WHEN),
    open_month: componentQuestion("month", OPEN_WHEN),
    open_day: componentQuestion("day", OPEN_WHEN),
    open_hour: componentQuestion("hour", OPEN_WHEN),
    open_minute: componentQuestion("minute", OPEN_WHEN),
    resp_year: componentQuestion("year", RESPONSE_WHEN),
    resp_month: componentQuestion("month", RESPONSE_WHEN),
    resp_day: componentQuestion("day", RESPONSE_WHEN),
    resp_hour: componentQuestion("hour", RESPONSE_WHEN),
    resp_minute: componentQuestion("minute", RESPONSE_WHEN),
  };
}

function getNoul(answers, id) {
  const a = answers && answers[id];
  if (!a || typeof a.noul !== "number") return null;
  return a.noul;
}

function getChoice(answers, id) {
  const a = answers && answers[id];
  if (!a || a.type !== "choice" || typeof a.choice !== "string") return null;
  const p =
    a.probabilities && typeof a.probabilities[a.choice] === "number"
      ? a.probabilities[a.choice]
      : typeof a.confidence === "number"
        ? a.confidence
        : 0;
  return { value: a.choice, p };
}

function makeUtc(year, month, day, hour, minute) {
  if (![year, month, day, hour, minute].every(Number.isInteger)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  const ts = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return d;
}

function holidaysFrom(policyText) {
  const text = String(policyText || "");
  let idx = text.search(/public\s+holidays\s*:/i);
  if (idx < 0) idx = text.search(/holiday/i);
  const segment = idx >= 0 ? text.slice(idx) : text;
  const found = segment.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
  const unique = Array.from(new Set(found));
  if (unique.length) return unique;

  return [
    "2026-01-01",
    "2026-04-03",
    "2026-05-25",
    "2026-12-25",
  ];
}

function businessWindow(policyText) {
  const text = String(policyText || "");
  const m = text.match(
    /(\d{1,2}):(\d{2})\s*(?:to|-|until|till)\s*(\d{1,2}):(\d{2})/i
  );
  if (m) {
    const startMin = Number(m[1]) * 60 + Number(m[2]);
    const endMin = Number(m[3]) * 60 + Number(m[4]);
    if (startMin >= 0 && endMin <= 24 * 60 && endMin > startMin) {
      return { startMin, endMin };
    }
  }
  return { startMin: 9 * 60, endMin: 17 * 60 };
}

function dateKey(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isBusinessDay(d, holidays) {
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  return !holidays.includes(dateKey(d));
}

function alignToBusiness(date, holidays, startMin, endMin) {
  let d = new Date(date.getTime());

  for (let i = 0; i < 1000; i++) {
    const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const start = new Date(base + startMin * 60000);
    const end = new Date(base + endMin * 60000);

    if (isBusinessDay(d, holidays)) {
      if (d.getTime() >= start.getTime() && d.getTime() < end.getTime()) {
        return d;
      }
      if (d.getTime() < start.getTime()) {
        return start;
      }
    }

    d = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
    );
  }

  return null;
}

function addBusinessMinutes(start, minutes, holidays, startMin, endMin) {
  let cur = alignToBusiness(start, holidays, startMin, endMin);
  if (!cur) return null;

  let remaining = minutes * 60000;

  for (let i = 0; i < 1000 && remaining > 0; i++) {
    const base = Date.UTC(
      cur.getUTCFullYear(),
      cur.getUTCMonth(),
      cur.getUTCDate()
    );
    const end = new Date(base + endMin * 60000);
    const available = end.getTime() - cur.getTime();

    if (available <= 0) {
      cur = alignToBusiness(
        new Date(cur.getTime() + 60000),
        holidays,
        startMin,
        endMin
      );
      if (!cur) return null;
      continue;
    }

    if (remaining <= available) {
      return new Date(cur.getTime() + remaining);
    }

    remaining -= available;
    const nextDay = new Date(
      Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), cur.getUTCDate() + 1)
    );
    cur = alignToBusiness(nextDay, holidays, startMin, endMin);
    if (!cur) return null;
  }

  return remaining > 0 ? null : cur;
}

export function decide(answers, input) {
  try {
    const hasOpen = getNoul(answers, "has_open");
    const hasAgentReply = getNoul(answers, "has_agent_reply");
    if (hasOpen === null || hasOpen < MIN_P) return ABSTAIN;
    if (hasAgentReply === null || hasAgentReply < MIN_P) return ABSTAIN;

    const priority = getChoice(answers, "open_priority");
    if (!priority || priority.p < MIN_P) return ABSTAIN;
    const p = priority.value;
    if (!["urgent", "high", "normal", "low"].includes(p)) return ABSTAIN;

    const parts = {};
    for (const prefix of ["open", "resp"]) {
      for (const part of ["year", "month", "day", "hour", "minute"]) {
        const id = `${prefix}_${part}`;
        const answer = getChoice(answers, id);
        if (!answer || answer.p < MIN_P || answer.value === "unknown") {
          return ABSTAIN;
        }
        const n = Number(answer.value);
        if (!Number.isInteger(n)) return ABSTAIN;
        parts[id] = n;
      }
    }

    const openedAt = makeUtc(
      parts.open_year,
      parts.open_month,
      parts.open_day,
      parts.open_hour,
      parts.open_minute
    );
    const respondedAt = makeUtc(
      parts.resp_year,
      parts.resp_month,
      parts.resp_day,
      parts.resp_hour,
      parts.resp_minute
    );
    if (!openedAt || !respondedAt) return ABSTAIN;
    if (respondedAt.getTime() < openedAt.getTime()) return ABSTAIN;

    const policyText = (input && input.policy_text) || "";
    const holidays = holidaysFrom(policyText);
    const { startMin, endMin } = businessWindow(policyText);

    let deadline;
    if (p === "urgent") {
      deadline = new Date(openedAt.getTime() + 60 * 60000);
    } else {
      const targetMinutes = p === "high" ? 4 * 60 : 16 * 60;
      deadline = addBusinessMinutes(
        openedAt,
        targetMinutes,
        holidays,
        startMin,
        endMin
      );
    }

    if (!deadline) return ABSTAIN;

    return {
      breached: respondedAt.getTime() > deadline.getTime() ? "yes" : "no",
    };
  } catch {
    return ABSTAIN;
  }
}
