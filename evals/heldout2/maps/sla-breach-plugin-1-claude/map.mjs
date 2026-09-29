// SLA first-response breach checker.
//
// Design: Jev is used only for the two genuinely ambiguous semantic
// judgments that free text requires — which log line (if any) is a real
// support-agent reply, and whether the priority/open-event of the ticket is
// unambiguous. All dates, policy numbers and the business-hours arithmetic
// are read/parsed exactly and computed in plain code (never asked of Jev,
// never compared by Jev).

const REPLY_THRESHOLD = 0.6;
const AMBIGUOUS_THRESHOLD = 0.5;

function parseEvents(ticketLog) {
  const lines = String(ticketLog || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const events = [];
  for (const line of lines) {
    const m = line.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})\s*UTC/);
    if (!m) continue;
    const [, y, mo, d, h, mi] = m;
    const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:00Z`);
    events.push({ text: line, date });
  }
  return events;
}

function parsePriorityAtOpen(openLine) {
  if (!openLine) return null;
  const m = openLine.match(/priority[:\s]+([A-Za-z]+)/i);
  return m ? m[1].trim() : null;
}

function parseTargets(policyText) {
  const targets = [];
  const bulletRe = /^-\s*([A-Za-z][A-Za-z ,]*?):\s*(.+?)\.?\s*$/gm;
  let m;
  while ((m = bulletRe.exec(policyText))) {
    const namesPart = m[1];
    const desc = m[2];
    const names = namesPart.split(/,|\band\b/i).map((s) => s.trim()).filter(Boolean);

    let mode = null;
    let businessHours = null;
    let calendarHours = null;

    const parenBiz = desc.match(/\(\s*(\d+)\s*business hours?\s*\)/i);
    const inlineBiz = desc.match(/within\s+(\d+)\s*business hours?/i);
    const bizDays = desc.match(/within\s+(\d+)\s*business days?/i);
    const calHours = desc.match(/within\s+(\d+)\s*hours?/i);
    const aroundClock = /around the clock|all days,?\s*all hours/i.test(desc);

    if (parenBiz) {
      mode = "business";
      businessHours = parseInt(parenBiz[1], 10);
    } else if (inlineBiz) {
      mode = "business";
      businessHours = parseInt(inlineBiz[1], 10);
    } else if (bizDays) {
      mode = "business";
      businessHours = { businessDays: parseInt(bizDays[1], 10) };
    } else if (calHours && !aroundClock && !/business/i.test(desc)) {
      mode = "calendar";
      calendarHours = parseInt(calHours[1], 10);
    } else if (calHours && aroundClock) {
      mode = "calendar";
      calendarHours = parseInt(calHours[1], 10);
    }

    if (mode) targets.push({ names, mode, businessHours, calendarHours });
  }
  return targets;
}

function parseBusinessWindow(policyText) {
  const m = policyText.match(
    /Business hours are\s+(\d{1,2}):(\d{2})\s+to\s+(\d{1,2}):(\d{2})\s*UTC,\s*([A-Za-z]+)\s+to\s+([A-Za-z]+)/i
  );
  if (!m) return null;
  const WD = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  const startWeekday = WD[m[5].toLowerCase()];
  const endWeekday = WD[m[6].toLowerCase()];
  if (startWeekday === undefined || endWeekday === undefined) return null;
  return {
    startMin: parseInt(m[1], 10) * 60 + parseInt(m[2], 10),
    endMin: parseInt(m[3], 10) * 60 + parseInt(m[4], 10),
    startWeekday,
    endWeekday,
  };
}

function parseHolidays(policyText) {
  const idx = policyText.search(/holiday/i);
  if (idx === -1) return new Set();
  const rest = policyText.slice(idx);
  const stop = rest.search(/\.\s*\n|\.\s*$/);
  const segment = stop === -1 ? rest : rest.slice(0, stop);
  const dates = segment.match(/\d{4}-\d{2}-\d{2}/g) || [];
  return new Set(dates);
}

function businessMinutesBetween(start, end, window, holidaySet) {
  if (end <= start) return 0;
  let minutes = 0;
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cursor <= endDay) {
    const wd = cursor.getUTCDay();
    const dateStr = cursor.toISOString().slice(0, 10);
    if (wd >= window.startWeekday && wd <= window.endWeekday && !holidaySet.has(dateStr)) {
      const winStart = new Date(cursor.getTime() + window.startMin * 60000);
      const winEnd = new Date(cursor.getTime() + window.endMin * 60000);
      const segStart = start > winStart ? start : winStart;
      const segEnd = end < winEnd ? end : winEnd;
      if (segEnd > segStart) minutes += (segEnd - segStart) / 60000;
    }
    cursor = new Date(cursor.getTime() + 24 * 3600000);
  }
  return minutes;
}

export function buildState(input) {
  const events = parseEvents(input.ticket_log);
  return {
    policy_text: input.policy_text,
    ticket_log: input.ticket_log,
    events: events.map((e) => e.text),
  };
}

export function questions(input) {
  const events = parseEvents(input.ticket_log);
  const qs = {};

  qs.open_ambiguous = {
    type: "noul",
    instructions:
      "Look at `ticket_log`. Is it unclear or ambiguous which event is the ticket actually first being opened, or when that happened — for example because the ticket was reopened, merged, duplicated, or has more than one 'opened' event, or the opening timestamp is missing or contradictory?",
    criteria: { true: "which event is the ticket's opening, or its time, is ambiguous", false: "the ticket's opening event and time are clear" },
  };

  qs.priority_ambiguous = {
    type: "noul",
    instructions:
      "Look at `ticket_log`. Is it unclear or ambiguous what priority the ticket had at the moment it was FIRST opened — for example because of conflicting statements, a missing priority, or the priority only being stated after a later change (as opposed to a later priority change being clearly a change from an initial value)?",
    criteria: { true: "the priority at the moment of first opening is ambiguous", false: "the priority at first opening is clearly stated" },
  };

  events.forEach((e, i) => {
    if (i === 0) return; // the opening event itself is never a "reply"
    qs[`reply_${i}`] = {
      type: "noul",
      instructions: `Look at events[${i}] in \`events\`. Was this message actually written and sent by a human support agent — as opposed to a message from the customer, or an automatic/system-generated acknowledgement or notification?`,
      criteria: {
        true: "a human support agent genuinely wrote and sent this message",
        false: "this is a customer message, or an automatic/system-generated message, not a genuine agent reply",
      },
    };
  });

  return qs;
}

export function decide(answers, input) {
  const events = parseEvents(input.ticket_log);
  if (events.length === 0) return { breached: "abstain" };

  if ((answers.open_ambiguous?.noul ?? 0) >= AMBIGUOUS_THRESHOLD) return { breached: "abstain" };
  if ((answers.priority_ambiguous?.noul ?? 0) >= AMBIGUOUS_THRESHOLD) return { breached: "abstain" };

  const openEvent = events[0];
  const priority = parsePriorityAtOpen(openEvent.text);
  if (!priority) return { breached: "abstain" };

  let bestReply = null;
  for (let i = 1; i < events.length; i++) {
    const p = answers[`reply_${i}`]?.noul ?? 0;
    if (p >= REPLY_THRESHOLD && events[i].date >= openEvent.date) {
      if (!bestReply || events[i].date < bestReply.date) bestReply = events[i];
    }
  }
  if (!bestReply) return { breached: "abstain" };

  const targets = parseTargets(input.policy_text);
  const target = targets.find((t) => t.names.some((n) => n.toLowerCase() === priority.toLowerCase()));
  if (!target) return { breached: "abstain" };

  let elapsedMinutes;
  let targetMinutes;

  if (target.mode === "calendar") {
    elapsedMinutes = (bestReply.date - openEvent.date) / 60000;
    targetMinutes = target.calendarHours * 60;
  } else {
    const window = parseBusinessWindow(input.policy_text);
    if (!window) return { breached: "abstain" };
    const holidays = parseHolidays(input.policy_text);
    elapsedMinutes = businessMinutesBetween(openEvent.date, bestReply.date, window, holidays);

    if (typeof target.businessHours === "number") {
      targetMinutes = target.businessHours * 60;
    } else if (target.businessHours && typeof target.businessHours.businessDays === "number") {
      const dayLenMin = window.endMin - window.startMin;
      targetMinutes = target.businessHours.businessDays * dayLenMin;
    } else {
      return { breached: "abstain" };
    }
  }

  const EPS = 1e-6;
  return { breached: elapsedMinutes > targetMinutes + EPS ? "yes" : "no" };
}
