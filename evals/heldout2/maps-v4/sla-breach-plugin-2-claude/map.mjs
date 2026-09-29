// SLA first-response breach checker.
//
// Business-hours arithmetic, date/day-of-week math and regex extraction of the
// policy's literal numbers/dates are all done in code (Jev is unreliable at
// arithmetic and at comparing against a value it must first compute). Jev is
// only asked to do the parts that need reading comprehension: which log line
// is the ticket-opening event, which log line is the first genuine
// support-agent reply (as opposed to a customer message or an automatic
// acknowledgement), what priority the ticket opened at, and what the policy
// states as each priority's target unit/number.

const CONF_GATE = 0.7; // unfitted placeholder; tune with jev-audit against labels
const PRIORITIES = ["Urgent", "High", "Normal", "Low"];
const TARGET_VALUES = [
  "0.5", "1", "2", "3", "4", "6", "8", "12", "16", "24", "32", "40", "48",
  "56", "64", "72", "96", "120", "144", "168", "192", "216", "240",
];
const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function parseLogLines(ticketLog) {
  const re = /^\s*(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})\s*UTC(?:\s*\([^)]*\))?\s*:\s*(.*)$/i;
  const out = [];
  for (const line of (ticketLog || "").split(/\r?\n/)) {
    const m = line.match(re);
    if (!m) continue;
    const [, date, rawTime] = m;
    const time = rawTime.length === 4 ? "0" + rawTime : rawTime;
    const ms = Date.parse(`${date}T${time}:00Z`);
    if (!Number.isNaN(ms)) out.push({ index: out.length, timestamp: ms, text: line.trim() });
  }
  return out;
}

function parsePolicyFacts(text) {
  const bh = (text || "").match(/(\d{1,2}):(\d{2})\s*(?:to|-|–)\s*(\d{1,2}):(\d{2})\s*UTC/i);
  if (!bh) return null;
  const dayRange = (text || "").match(/UTC[,]?\s*([A-Za-z]+)\s+to\s+([A-Za-z]+)/i);
  if (!dayRange) return null;
  const startDayIdx = DAY_NAMES.indexOf(dayRange[1].toLowerCase());
  const endDayIdx = DAY_NAMES.indexOf(dayRange[2].toLowerCase());
  if (startDayIdx === -1 || endDayIdx === -1) return null;

  const businessDays = new Set();
  let i = startDayIdx;
  while (true) {
    businessDays.add(i);
    if (i === endDayIdx) break;
    i = (i + 1) % 7;
  }

  const holidays = new Set(Array.from(text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)).map((m) => m[1]));
  const startMin = parseInt(bh[1], 10) * 60 + parseInt(bh[2], 10);
  const endMin = parseInt(bh[3], 10) * 60 + parseInt(bh[4], 10);
  if (endMin <= startMin) return null;

  return { startMin, endMin, businessDays, holidays };
}

function businessHoursElapsed(openMs, respMs, facts) {
  if (respMs <= openMs) return 0;
  let total = 0;
  let dayStart = Math.floor(openMs / 86400000) * 86400000;
  while (dayStart <= respMs) {
    const d = new Date(dayStart);
    const weekday = d.getUTCDay();
    const dateStr = d.toISOString().slice(0, 10);
    if (facts.businessDays.has(weekday) && !facts.holidays.has(dateStr)) {
      const bizStart = dayStart + facts.startMin * 60000;
      const bizEnd = dayStart + facts.endMin * 60000;
      const overlapStart = Math.max(bizStart, openMs);
      const overlapEnd = Math.min(bizEnd, respMs);
      if (overlapEnd > overlapStart) total += overlapEnd - overlapStart;
    }
    dayStart += 86400000;
  }
  return total / 3600000;
}

function topProb(ans) {
  if (!ans) return 0;
  if (ans.probabilities && ans.choice in ans.probabilities) return ans.probabilities[ans.choice];
  return ans.confidence ?? 0;
}

export function buildState(input) {
  const logLines = parseLogLines(input.ticket_log || "");
  return {
    policy_text: input.policy_text,
    ticket_log: input.ticket_log,
    log_lines: logLines.map((l) => ({ index: l.index, text: l.text })),
  };
}

export function questions(input) {
  const logLines = parseLogLines(input.ticket_log || "");

  const lineOptions = {};
  if (logLines.length === 0) {
    lineOptions.no_lines_parsed = "No timestamped events could be identified in ticket_log.";
  } else {
    for (const l of logLines) lineOptions[`line_${l.index}`] = l.text.slice(0, 300);
  }

  const responseOptions = {
    ...lineOptions,
    no_agent_reply_yet:
      "No line in log_lines is a genuine reply from a support agent; customer messages and automatic/system acknowledgements do not count.",
  };

  const valueCriteria = {};
  for (const v of TARGET_VALUES) valueCriteria[v] = `the stated number is ${v}`;
  valueCriteria.other_value = "the stated number is not in this list, or no number is given for this priority";

  const unitCriteria = {
    calendar_time: "the target applies around the clock / at all times, in real clock hours, not limited to business hours",
    business_hours: "the target is stated directly as a number of business hours",
    business_days: "the target is stated as a number of business days",
    not_applicable: "policy_text states no first-response target for this priority",
  };

  const qs = {
    opening_line: {
      type: "choice",
      instructions:
        "In `log_lines` (built from `ticket_log`), which single line records the moment this support ticket was first opened/created? Pick the earliest such event, not a later reply or update.",
      criteria: lineOptions,
    },
    response_line: {
      type: "choice",
      instructions:
        "In `log_lines` (built from `ticket_log`), which single line is the FIRST reply from a human support agent to this ticket? A reply from a support agent counts as a first response. A message from the customer, and any automatic or system-generated acknowledgement, does not count, even if it appears earlier in the log.",
      criteria: responseOptions,
    },
    opening_priority: {
      type: "choice",
      instructions:
        "Read `ticket_log`. What priority was this ticket assigned at the moment it was opened/created, even if the priority was changed later?",
      criteria: {
        Urgent: "the ticket was opened as Urgent priority",
        High: "the ticket was opened as High priority",
        Normal: "the ticket was opened as Normal priority",
        Low: "the ticket was opened as Low priority",
        other_not_listed: "the ticket's opening priority is not one of Urgent/High/Normal/Low, or is not stated",
      },
    },
  };

  for (const p of PRIORITIES) {
    qs[`target_unit_${p}`] = {
      type: "choice",
      instructions: `Read \`policy_text\`. For priority "${p}", is its first-response target measured in real/calendar time (around the clock, including nights, weekends and holidays), stated directly as a number of business hours, or stated as a number of business days? Answer "not_applicable" if policy_text gives no first-response target for priority "${p}".`,
      criteria: unitCriteria,
    };
    qs[`target_value_${p}`] = {
      type: "choice",
      instructions: `Read \`policy_text\`. For priority "${p}", what is the plain number stated for its first-response target: the number of hours if the target is in hours, or the number of days if the target is in business days? If a business-day target also gives an equivalent business-hours number in parentheses, give the business-day number here, not the parenthetical hours.`,
      criteria: valueCriteria,
    };
  }

  return qs;
}

export function decide(answers, input) {
  const logLines = parseLogLines(input.ticket_log || "");
  if (logLines.length === 0) return { breached: "abstain" };

  const openingLineAns = answers.opening_line;
  const responseLineAns = answers.response_line;
  const openingPriorityAns = answers.opening_priority;
  if (!openingLineAns || !responseLineAns || !openingPriorityAns) return { breached: "abstain" };
  if (openingLineAns.choice === "no_lines_parsed") return { breached: "abstain" };
  if (openingPriorityAns.choice === "other_not_listed") return { breached: "abstain" };
  if (topProb(openingLineAns) < CONF_GATE || topProb(openingPriorityAns) < CONF_GATE) {
    return { breached: "abstain" };
  }

  const openIdx = parseInt(String(openingLineAns.choice).replace("line_", ""), 10);
  const openLine = logLines[openIdx];
  if (!openLine) return { breached: "abstain" };

  if (responseLineAns.choice === "no_agent_reply_yet") return { breached: "abstain" };
  if (topProb(responseLineAns) < CONF_GATE) return { breached: "abstain" };
  const respIdx = parseInt(String(responseLineAns.choice).replace("line_", ""), 10);
  const respLine = logLines[respIdx];
  if (!respLine) return { breached: "abstain" };
  if (respLine.timestamp <= openLine.timestamp) return { breached: "abstain" };

  const priority = openingPriorityAns.choice;
  const unitAns = answers[`target_unit_${priority}`];
  const valueAns = answers[`target_value_${priority}`];
  if (!unitAns || !valueAns) return { breached: "abstain" };
  if (topProb(unitAns) < CONF_GATE || topProb(valueAns) < CONF_GATE) return { breached: "abstain" };

  const unit = unitAns.choice;
  if (unit === "not_applicable" || valueAns.choice === "other_value") return { breached: "abstain" };
  const value = parseFloat(valueAns.choice);

  let actualHours, targetHours;
  if (unit === "calendar_time") {
    actualHours = (respLine.timestamp - openLine.timestamp) / 3600000;
    targetHours = value;
  } else {
    const facts = parsePolicyFacts(input.policy_text || "");
    if (!facts) return { breached: "abstain" };
    const businessHoursPerDay = (facts.endMin - facts.startMin) / 60;
    targetHours = unit === "business_days" ? value * businessHoursPerDay : value;
    actualHours = businessHoursElapsed(openLine.timestamp, respLine.timestamp, facts);
  }

  return { breached: actualHours > targetHours + 1e-9 ? "yes" : "no" };
}
