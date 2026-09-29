// SLA first-response breach checker built on Jev.
//
// Design: exact date/business-hours arithmetic is deterministic (LLMs are
// unreliable at multi-day business-hour math), while the genuinely fuzzy
// judgment calls -- "which log line is a valid first response from a
// support agent" and "is this case too messy to automate" -- are delegated
// to Jev.

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function parseEvents(ticketLog) {
  const events = [];
  const lines = String(ticketLog || "").split(/\r?\n/);
  const re = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s*UTC/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const m = line.match(re);
    if (!m) continue;
    const date = new Date(`${m[1]}T${m[2]}:00Z`);
    if (isNaN(date.getTime())) continue;
    events.push({ i, date, text: line });
  }
  return events;
}

function findOpenIndex(events) {
  const idx = events.findIndex((e) => /\bticket\s+(opened|created|submitted)\b/i.test(e.text));
  return idx >= 0 ? idx : 0;
}

function parsePriorityWord(openLine) {
  const m = openLine.match(/priority\s*[:\-]?\s*([A-Za-z]+)/i);
  return m ? m[1].toLowerCase() : null;
}

function parsePolicy(policyText) {
  const text = String(policyText || "");
  const result = { bizStart: null, bizEnd: null, businessDays: null, holidays: new Set(), targets: {} };

  const bizMatch = text.match(
    /business hours are\s+(\d{1,2}):(\d{2})\s*(?:to|-)\s*(\d{1,2}):(\d{2})\s*UTC(?:,\s*([A-Za-z]+)\s+to\s+([A-Za-z]+))?/i
  );
  if (bizMatch) {
    result.bizStart = { h: +bizMatch[1], m: +bizMatch[2] };
    result.bizEnd = { h: +bizMatch[3], m: +bizMatch[4] };
    if (bizMatch[5] && bizMatch[6]) {
      const startIdx = DAY_NAMES.indexOf(bizMatch[5].toLowerCase());
      const endIdx = DAY_NAMES.indexOf(bizMatch[6].toLowerCase());
      if (startIdx >= 0 && endIdx >= 0) {
        const set = new Set();
        let d = startIdx;
        while (true) {
          set.add(d);
          if (d === endIdx) break;
          d = (d + 1) % 7;
        }
        result.businessDays = set;
      }
    }
    if (!result.businessDays) result.businessDays = new Set([1, 2, 3, 4, 5]); // default Mon-Fri
  }

  for (const m of text.matchAll(/\d{4}-\d{2}-\d{2}/g)) result.holidays.add(m[0]);

  const dayHours = result.bizStart && result.bizEnd
    ? (result.bizEnd.h + result.bizEnd.m / 60) - (result.bizStart.h + result.bizStart.m / 60)
    : null;

  const lineRe = /^[-*]?\s*(.+?):\s*within\s+([\d.]+)\s*(business\s+)?(hour|day)s?\b(.*)$/gim;
  for (const m of text.matchAll(lineRe)) {
    const namesPart = m[1];
    const amount = parseFloat(m[2]);
    const isBusinessUnit = !!m[3];
    const unit = m[4].toLowerCase();
    const rest = m[5] || "";
    const aroundClock = /around the clock/i.test(rest);
    let hours, useBusiness;
    if (unit === "day") {
      useBusiness = isBusinessUnit;
      hours = amount * (isBusinessUnit ? (dayHours ?? 8) : 24);
    } else {
      useBusiness = isBusinessUnit && !aroundClock;
      hours = amount;
    }
    const names = namesPart.split(/\s*,\s*|\s+and\s+/i).map((s) => s.trim().toLowerCase()).filter(Boolean);
    for (const n of names) result.targets[n] = { hours, useBusiness };
  }

  return result;
}

function atTime(date, h, m) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), h, m, 0));
}

function isBusinessDay(date, policy) {
  const dateKey = date.toISOString().slice(0, 10);
  if (policy.holidays.has(dateKey)) return false;
  return policy.businessDays.has(date.getUTCDay());
}

function nextBusinessDayStart(date, policy) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 1);
  while (!isBusinessDay(d, policy)) d.setUTCDate(d.getUTCDate() + 1);
  return atTime(d, policy.bizStart.h, policy.bizStart.m);
}

function snapToBusinessStart(date, policy) {
  if (!isBusinessDay(date, policy)) return nextBusinessDayStart(date, policy);
  const startT = atTime(date, policy.bizStart.h, policy.bizStart.m);
  const endT = atTime(date, policy.bizEnd.h, policy.bizEnd.m);
  if (date < startT) return startT;
  if (date >= endT) return nextBusinessDayStart(date, policy);
  return date;
}

function addBusinessHours(start, hours, policy) {
  let current = snapToBusinessStart(start, policy);
  let remaining = hours;
  while (remaining > 1e-9) {
    const endT = atTime(current, policy.bizEnd.h, policy.bizEnd.m);
    const availHours = (endT - current) / 3600000;
    if (remaining <= availHours + 1e-9) {
      current = new Date(current.getTime() + remaining * 3600000);
      remaining = 0;
    } else {
      remaining -= availHours;
      current = nextBusinessDayStart(current, policy);
    }
  }
  return current;
}

function candidateKey(e) {
  return String(e.i);
}

export function buildState(input) {
  return { policy_text: input.policy_text, ticket_log: input.ticket_log };
}

export function questions(input) {
  const events = parseEvents(input.ticket_log);
  const openIdx = findOpenIndex(events);
  const candidates = events.filter((e) => e.i > events[openIdx].i);

  const criteria = { none: "No entry in the log is a genuine first response from a support agent." };
  for (const c of candidates) criteria[candidateKey(c)] = c.text;

  return {
    first_response: {
      type: "choice",
      instructions:
        "Given the full ticket log and SLA policy in state, find the FIRST reply from a support agent after the ticket was opened. Per policy, only a reply from a support agent counts as the first response; customer messages and automatic/system acknowledgements do NOT count, even if they look like a reply. Choose the log entry (by its option key) that is this first valid response. If no such entry exists anywhere in the log, choose 'none'.",
      criteria,
    },
    ambiguous: {
      type: "noul",
      instructions:
        "Looking at the ticket log and SLA policy in state, is there real ambiguity or missing information that should stop an automated system from confidently deciding whether the first-response SLA was breached? Examples: no clear ticket-opening event or priority, conflicting or unparseable business-hours/holiday rules, or genuine uncertainty about which log entry (if any) is the first valid agent response.",
      criteria: {
        true: "The case is ambiguous or missing information needed for a confident automated decision; a person should review it.",
        false: "The case is clear-cut and an automated decision can be made confidently.",
      },
    },
  };
}

export function decide(answers, input) {
  const events = parseEvents(input.ticket_log);
  if (events.length === 0) return { breached: "abstain" };

  const openIdx = findOpenIndex(events);
  const openEvent = events[openIdx];
  const priorityWord = parsePriorityWord(openEvent.text);
  if (!priorityWord) return { breached: "abstain" };

  const policy = parsePolicy(input.policy_text);
  const target = policy.targets[priorityWord];
  if (!target) return { breached: "abstain" };
  if (target.useBusiness && (!policy.bizStart || !policy.bizEnd)) return { breached: "abstain" };

  const ambiguousP = answers?.ambiguous?.noul;
  if (typeof ambiguousP === "number" && ambiguousP > 0.5) return { breached: "abstain" };

  const fr = answers?.first_response;
  if (!fr || fr.choice === "none") return { breached: "abstain" };
  if (typeof fr.confidence === "number" && fr.confidence < 0.55) return { breached: "abstain" };

  const chosenIdx = parseInt(fr.choice, 10);
  const respEvent = events.find((e) => e.i === chosenIdx);
  if (!respEvent) return { breached: "abstain" };

  const deadline = target.useBusiness
    ? addBusinessHours(openEvent.date, target.hours, policy)
    : new Date(openEvent.date.getTime() + target.hours * 3600000);

  return { breached: respEvent.date.getTime() > deadline.getTime() ? "yes" : "no" };
}
