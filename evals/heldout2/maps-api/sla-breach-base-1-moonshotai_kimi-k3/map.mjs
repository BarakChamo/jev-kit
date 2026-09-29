// map.mjs — first-response SLA breach check built on Jev (TypeSafe System One).
//
// Jev extracts the structured facts in one parallel pass (open event, first
// qualifying response, applicable target, business calendar, holidays) plus a
// holistic cross-check; the elapsed-time math is done deterministically here.
// Missing, low-confidence or contradictory facts send the case to a human.

const CONF = 0.6;     // min confidence for structural choice answers
const CAL_CONF = 0.5; // min confidence for business-calendar answers

const CLOCK_H = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 24, 48, 72];
const BUS_H = [0.5, 1, 2, 3, 4, 6, 8, 12, 16, 20, 24, 40];
const BUS_D = [1, 2, 3, 5];
const STARTS = ["06:00", "07:00", "08:00", "08:30", "09:00", "09:30", "10:00"];
const ENDS = ["15:00", "16:00", "16:30", "17:00", "17:30", "18:00", "19:00", "20:00"];
const DAYSETS = {
  mon_fri: [1, 2, 3, 4, 5],
  mon_sat: [1, 2, 3, 4, 5, 6],
  every_day: [0, 1, 2, 3, 4, 5, 6],
  sun_thu: [0, 1, 2, 3, 4],
};

// ---------- parsing helpers (shared by questions() and decide()) ----------

function eventLines(log) {
  return String(log || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}/.test(l));
}

function parseTs(line) {
  const m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/.exec(String(line || ""));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
}

function parseHM(s) {
  const m = /^(\d{2}):(\d{2})$/.exec(s || "");
  return m ? +m[1] + +m[2] / 60 : null;
}

function policyDates(text) {
  const out = [], seen = new Set();
  const re = /\b(\d{4}-\d{2}-\d{2})\b/g;
  let m;
  while ((m = re.exec(String(text || ""))) && out.length < 20) {
    if (!seen.has(m[1])) { seen.add(m[1]); out.push(m[1]); }
  }
  return out;
}

// Business hours between two UTC instants (in hours).
function businessHours(fromMs, toMs, days, sh, eh, holidays) {
  const DAY = 86400000;
  let total = 0;
  for (let d = Math.floor(fromMs / DAY) * DAY; d < toMs; d += DAY) {
    const dt = new Date(d);
    if (!days.includes(dt.getUTCDay())) continue;
    if (holidays.has(dt.toISOString().slice(0, 10))) continue;
    const s = Math.max(fromMs, d + sh * 3600000);
    const e = Math.min(toMs, d + eh * 3600000);
    if (e > s) total += (e - s) / 3600000;
  }
  return total;
}

// ---------- Jev interface ----------

export function buildState(input) {
  return {
    task: "Determine whether the first-response SLA was breached for a support ticket, under the SLA policy below.",
    policy_text: input && input.policy_text,
    ticket_log: input && input.ticket_log,
    log_lines: eventLines(input && input.ticket_log).map((l, i) => `L${i}: ${l}`),
  };
}

export function questions(input) {
  const lineOpts = {};
  for (const [i, l] of eventLines(input && input.ticket_log).entries()) lineOpts["L" + i] = l;

  const targetOpts = {};
  for (const h of CLOCK_H) targetOpts["clock_" + h] = `Within ${h} hour(s) of opening, counted around the clock (all days, all hours).`;
  for (const h of BUS_H) targetOpts["bus_" + h] = `Within ${h} business hour(s); only time inside the policy's business hours counts.`;
  for (const d of BUS_D) targetOpts["bday_" + d] = `Within ${d} business day(s) as defined by the policy.`;
  targetOpts.none = "The policy sets no determinable first-response target for this ticket's priority at open.";

  const hm = (arr, noun) => {
    const c = {};
    for (const t of arr) c[t] = `Business hours ${noun} at ${t}.`;
    c.other = "A different time, or the policy does not state it clearly.";
    return c;
  };

  const q = {
    open: {
      type: "choice",
      instructions:
        "Read the SLA policy and ticket log in the state. Which log line records the ticket being OPENED/created — the event that starts the first-response SLA? Pick the earliest line describing the ticket's creation, not later updates or replies.",
      criteria: { ...lineOpts, none: "No log line clearly records the ticket being opened." },
    },
    response: {
      type: "choice",
      instructions:
        "Read the SLA policy and ticket log in the state. Apply the policy's rule about what counts as a first response (typically only a reply from a support agent; customer messages, automated acknowledgements and bot replies do not). Which log line is the EARLIEST event that counts as the first response?",
      criteria: { ...lineOpts, none: "No log line is a qualifying first response under the policy." },
    },
    target: {
      type: "choice",
      instructions:
        "Read the SLA policy in the state. What is the first-response target for THIS ticket, based on the priority it had WHEN OPENED (even if changed later)? 'clock' = around-the-clock target; 'business hours' = counted only during the policy's business hours; 'business days' = whole business days per the policy.",
      criteria: targetOpts,
    },
    days: {
      type: "choice",
      instructions: "According to the SLA policy in the state, on which days of the week do business hours run?",
      criteria: {
        mon_fri: "Monday to Friday.",
        mon_sat: "Monday to Saturday.",
        every_day: "Every day of the week.",
        sun_thu: "Sunday to Thursday.",
        other: "Any other pattern, or the policy does not say clearly.",
      },
    },
    start: {
      type: "choice",
      instructions:
        "According to the SLA policy in the state, at what time of day do business hours START? Express it in the timezone the policy/log uses (assume they share one timezone).",
      criteria: hm(STARTS, "start"),
    },
    end: {
      type: "choice",
      instructions:
        "According to the SLA policy in the state, at what time of day do business hours END? Express it in the timezone the policy/log uses (assume they share one timezone).",
      criteria: hm(ENDS, "end"),
    },
    uniform_hours: {
      type: "noul",
      instructions:
        "According to the SLA policy in the state, are the business hours the SAME on every business day (one start time and one end time applying to all business days)?",
      criteria: {
        true: "Yes, one consistent daily start and end time applies to every business day.",
        false: "No, hours vary by day or are unclear.",
      },
    },
    extra_holidays: {
      type: "noul",
      instructions:
        "Does the SLA policy in the state define any non-business days/holidays other than as a simple list of explicit calendar dates (e.g. named holidays like 'Easter', recurring rules, or region-dependent holidays)?",
      criteria: {
        true: "Yes, there are holiday rules beyond explicit calendar dates.",
        false: "No, non-business days (if any) are given only as explicit calendar dates, or none are given.",
      },
    },
    verdict: {
      type: "noul",
      instructions:
        "Considering the SLA policy and the full ticket log in the state: was the first-response SLA breached? Work out the priority at open, the applicable target, which event is the first qualifying response, and the elapsed time (using the business calendar and holidays if the target is in business time).",
      criteria: {
        true: "The first qualifying response arrived after the applicable SLA deadline.",
        false: "The first qualifying response arrived within the SLA, or a breach cannot be established from the record.",
      },
    },
  };

  for (const d of policyDates(input && input.policy_text)) {
    q["hol_" + d] = {
      type: "noul",
      instructions: `Does the SLA policy in the state list ${d} as a public holiday or non-business day?`,
      criteria: {
        true: `${d} is listed as a holiday / non-business day.`,
        false: `${d} is NOT listed as a holiday (it may appear in the policy for another reason).`,
      },
    };
  }
  return q;
}

export function decide(answers, input) {
  const ABSTAIN = { breached: "abstain" };
  const get = (id) => (answers ? answers[id] : undefined);
  const conf = (a) => (a && typeof a.confidence === "number" ? a.confidence : 0);
  const isLine = (c) => typeof c === "string" && /^L\d+$/.test(c);

  const lines = eventLines(input && input.ticket_log);
  if (!lines.length) return ABSTAIN;

  // 1) Open event.
  const openA = get("open");
  if (!openA || conf(openA) < CONF || !isLine(openA.choice)) return ABSTAIN;
  const openIdx = +openA.choice.slice(1);
  const openTs = parseTs(lines[openIdx]);
  if (openTs == null) return ABSTAIN;

  // 2) Applicable target.
  const tgtA = get("target");
  if (!tgtA || conf(tgtA) < CONF) return ABSTAIN;
  const tm = /^(clock|bus|bday)_([\d.]+)$/.exec(tgtA.choice || "");
  if (!tm) return ABSTAIN;
  const kind = tm[1];
  let targetHours = +tm[2];

  // 3) Business calendar, if the target is in business time.
  let cal = null;
  if (kind !== "clock") {
    const dA = get("days"), sA = get("start"), eA = get("end");
    if (conf(dA) < CAL_CONF || conf(sA) < CAL_CONF || conf(eA) < CAL_CONF) return ABSTAIN;
    const days = DAYSETS[dA && dA.choice];
    const sh = parseHM(sA && sA.choice), eh = parseHM(eA && eA.choice);
    if (!days || sh == null || eh == null || eh <= sh) return ABSTAIN;
    const uni = get("uniform_hours");
    if (uni && uni.noul < 0.5) return ABSTAIN;
    const extra = get("extra_holidays");
    if (extra && extra.noul >= 0.5) return ABSTAIN;
    const holidays = new Set();
    for (const d of policyDates(input && input.policy_text)) {
      const h = get("hol_" + d);
      if (h && h.noul >= 0.5) holidays.add(d);
    }
    cal = { days, sh, eh, holidays };
    if (kind === "bday") targetHours *= eh - sh;
  }

  // 4) First qualifying response.
  let respTs = null;
  const rA = get("response");
  if (rA && conf(rA) >= CONF && isLine(rA.choice)) {
    const rIdx = +rA.choice.slice(1);
    if (rIdx === openIdx) return ABSTAIN;
    respTs = parseTs(lines[rIdx]);
  }
  if (respTs != null && respTs < openTs) return ABSTAIN;

  const endTs = respTs != null ? respTs : parseTs(lines[lines.length - 1]);
  if (endTs == null || endTs < openTs) return ABSTAIN;

  const elapsed = cal
    ? businessHours(openTs, endTs, cal.days, cal.sh, cal.eh, cal.holidays)
    : (endTs - openTs) / 3600000;
  const breached = elapsed > targetHours + 1e-9;

  // 5) Cross-check the holistic verdict; strong disagreement goes to a human.
  const v = get("verdict");
  if (v && respTs != null) {
    if (v.noul >= 0.75 && !breached) return ABSTAIN;
    if (v.noul <= 0.25 && breached) return ABSTAIN;
  }

  if (respTs == null) return breached ? { breached: "yes" } : ABSTAIN;
  return { breached: breached ? "yes" : "no" };
}
