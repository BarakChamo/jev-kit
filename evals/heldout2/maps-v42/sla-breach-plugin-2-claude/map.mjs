// SLA first-response breach checker.
// Dates, hours, holidays and priority words are read exactly with regex (rule 9);
// Jev is only asked the one genuinely ambiguous judgment: which log entry, if any,
// is a genuine first reply from a support agent (not a customer, not an auto-ack).

const DAY_NAMES = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

const PICK_CONFIDENCE_THRESHOLD = 0.65; // placeholder pending jev-eval fitting

function parseLogEntries(ticketLog) {
  const lineRe = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})\s*UTC(?:\s*\([^)]*\))?:\s*(.*)$/;
  const entries = [];
  for (const raw of String(ticketLog || "").split(/\n+/)) {
    const line = raw.trim();
    const m = line.match(lineRe);
    if (!m) continue;
    const [, y, mo, d, h, mi, desc] = m;
    entries.push({
      raw: line,
      desc,
      date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi)),
    });
  }
  return entries;
}

function findOpenIndex(entries) {
  for (let i = 0; i < entries.length; i++) {
    if (/ticket opened|opened by/i.test(entries[i].desc)) return i;
  }
  return entries.length ? 0 : -1;
}

function extractPriority(desc) {
  const m = desc.match(/priority\s*[:\-]?\s*(Urgent|High|Normal|Low)|(Urgent|High|Normal|Low)\s*priority/i);
  if (!m) return null;
  const word = m[1] || m[2];
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

function parsePolicy(policyText) {
  const text = String(policyText || "");
  const result = { targets: {}, businessStart: null, businessEnd: null, startDay: null, endDay: null, holidays: new Set() };

  const bhMatch = text.match(/business hours are\s*(\d{2}):(\d{2})\s*to\s*(\d{2}):(\d{2})\s*UTC[^]*?([A-Za-z]+)\s*to\s*([A-Za-z]+)/i);
  if (bhMatch) {
    result.businessStart = +bhMatch[1] + +bhMatch[2] / 60;
    result.businessEnd = +bhMatch[3] + +bhMatch[4] / 60;
    const d1 = DAY_NAMES[bhMatch[5].toLowerCase()];
    const d2 = DAY_NAMES[bhMatch[6].toLowerCase()];
    if (d1 !== undefined && d2 !== undefined) {
      result.startDay = d1;
      result.endDay = d2;
    }
  }

  const holidayMatch = text.match(/excluding these public holidays:\s*([^\n.]+)/i);
  if (holidayMatch) {
    const dates = holidayMatch[1].match(/\d{4}-\d{2}-\d{2}/g) || [];
    dates.forEach((d) => result.holidays.add(d));
  }

  const lineRe = /^[-•\d.]*\s*([A-Za-z][A-Za-z ,]*?):\s*within\s+(\d+)\s*(business\s+)?(hour|hours|day|days)([^\n]*)$/gim;
  let m;
  while ((m = lineRe.exec(text)) !== null) {
    const names = m[1].split(/,| and /i).map((s) => s.trim()).filter(Boolean);
    const num = +m[2];
    const isBusinessUnit = !!m[3];
    const isDayUnit = m[4].toLowerCase().startsWith("day");
    const rest = m[5] || "";
    const parenHours = rest.match(/\((\d+)\s*business\s*hours?\)/i);
    const calendarFlag = /around the clock|all days,?\s*all hours|24\s*\/\s*7/i.test(rest);

    let hours, mode;
    if (calendarFlag) {
      mode = "calendar";
      hours = isDayUnit ? num * 24 : num;
    } else if (parenHours) {
      mode = "business";
      hours = +parenHours[1];
    } else {
      mode = isBusinessUnit ? "business" : "calendar";
      hours = isDayUnit ? num * 24 : num;
    }
    for (const n of names) {
      result.targets[n.replace(/\.$/, "")] = { hours, mode };
    }
  }

  return result;
}

function inDayRange(dow, startDay, endDay) {
  if (startDay <= endDay) return dow >= startDay && dow <= endDay;
  return dow >= startDay || dow <= endDay;
}

function businessMinutesElapsed(start, end, businessStart, businessEnd, startDay, endDay, holidays) {
  if (end <= start) return 0;
  let total = 0;
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cursor <= lastDay) {
    const dow = cursor.getUTCDay();
    const dateStr = cursor.toISOString().slice(0, 10);
    if (inDayRange(dow, startDay, endDay) && !holidays.has(dateStr)) {
      const y = cursor.getUTCFullYear(), mo = cursor.getUTCMonth(), d = cursor.getUTCDate();
      const dayStart = new Date(Date.UTC(y, mo, d, Math.floor(businessStart), Math.round((businessStart % 1) * 60)));
      const dayEnd = new Date(Date.UTC(y, mo, d, Math.floor(businessEnd), Math.round((businessEnd % 1) * 60)));
      const s = Math.max(dayStart.getTime(), start.getTime());
      const e = Math.min(dayEnd.getTime(), end.getTime());
      if (e > s) total += (e - s) / 60000;
    }
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return total;
}

function buildCandidates(input) {
  const entries = parseLogEntries(input.ticket_log);
  const openIndex = findOpenIndex(entries);
  const candidates = [];
  if (openIndex >= 0) {
    for (let i = openIndex + 1; i < entries.length; i++) {
      candidates.push({ id: String(i), entry: entries[i] });
    }
  }
  return { entries, openIndex, candidates };
}

export function buildState(input) {
  const { candidates } = buildCandidates(input);
  const state = {
    policy_text: input.policy_text,
    ticket_log: input.ticket_log,
    candidates: {},
  };
  for (const c of candidates) {
    state.candidates[c.id] = `${c.entry.raw}`;
  }
  return state;
}

export function questions(input) {
  const { candidates } = buildCandidates(input);
  if (candidates.length === 0) return {};

  const criteria = {};
  for (const c of candidates) {
    criteria[c.id] = `Entry ${c.id} — "${c.entry.raw}". Choose this if it is the FIRST entry, in chronological order, that is a genuine reply written by a human support agent (not the customer, and not an automatic or system-generated acknowledgement).`;
  }
  criteria.none = "No entry in `ticket_log` is a genuine reply from a support agent — every entry after the ticket opened is a customer message, an automated acknowledgement, or there are no entries at all.";

  return {
    first_agent_reply: {
      type: "choice",
      instructions:
        "The candidate entries are the log lines in `ticket_log` that occur after the ticket was opened, in chronological order. Read the full `ticket_log` for context. Choose the candidate that is the FIRST reply actually written by a support agent. A customer's message does not count as a first response, and neither does an automatic or system-generated acknowledgement. If none of the candidates qualify, choose \"none\".",
      criteria,
    },
  };
}

export function decide(answers, input) {
  const policy = parsePolicy(input.policy_text);
  const { entries, openIndex, candidates } = buildCandidates(input);

  if (openIndex < 0) return { breached: "abstain" };

  const priority = extractPriority(entries[openIndex].desc);
  if (!priority) return { breached: "abstain" };

  const target = policy.targets[priority];
  if (!target) return { breached: "abstain" };

  if (target.mode === "business" && (policy.businessStart == null || policy.startDay == null)) {
    return { breached: "abstain" };
  }

  if (candidates.length === 0) return { breached: "abstain" };

  const answer = answers && answers.first_agent_reply;
  if (!answer || answer.choice === "none") return { breached: "abstain" };

  const topProb = (answer.probabilities && answer.probabilities[answer.choice]) ?? answer.confidence ?? 0;
  if (topProb < PICK_CONFIDENCE_THRESHOLD) return { breached: "abstain" };

  const picked = candidates.find((c) => c.id === answer.choice);
  if (!picked) return { breached: "abstain" };

  const openTime = entries[openIndex].date;
  const replyTime = picked.entry.date;

  let elapsedMinutes;
  if (target.mode === "calendar") {
    elapsedMinutes = (replyTime - openTime) / 60000;
  } else {
    elapsedMinutes = businessMinutesElapsed(
      openTime, replyTime, policy.businessStart, policy.businessEnd, policy.startDay, policy.endDay, policy.holidays
    );
  }

  const breached = elapsedMinutes > target.hours * 60;
  return { breached: breached ? "yes" : "no" };
}
