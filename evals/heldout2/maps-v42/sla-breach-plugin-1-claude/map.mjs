// SLA first-response breach checker.
//
// Strategy: read exact stated facts (timestamps, priority-target numbers, business
// hours, holiday dates) with code or narrow choice/noul questions, then do all date
// and business-hours arithmetic in code (never ask Jev to compare against a computed
// deadline). Jev is used only for genuinely textual judgments: which priority applied
// at open, the policy's business-hour/day parameters and per-priority target unit and
// amount, and whether a given log entry is a genuine agent reply to the customer.

const PRIORITIES = ["urgent", "high", "normal", "low"];

const UNIT_CRITERIA = {
  calendar_hours:
    "the target is a number of real (calendar/clock) hours, counted around the clock including nights, weekends and holidays",
  business_hours:
    "the target is a number of business hours, counted only during the policy's stated business hours on business days",
  calendar_days:
    "the target is a number of real (calendar) days, counted around the clock",
  business_days:
    "the target is a number of business days (whole business days), counted only on the policy's business days",
};

const DAY_NAMES = {
  sun: "Sunday",
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
};
const DAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function amountCriteria() {
  const c = {};
  for (let n = 1; n <= 120; n++) c[String(n)] = `the policy states the number ${n}`;
  return c;
}

function parseLogEntries(log) {
  const lines = String(log || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const re = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})\s*UTC\b.*?:\s*(.*)$/;
  const out = [];
  for (const line of lines) {
    const m = line.match(re);
    if (!m) continue;
    const [, y, mo, d, h, mi, desc] = m;
    const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
    if (!Number.isNaN(date.getTime())) out.push({ date, text: line, desc });
  }
  return out;
}

function getOpenAndOthers(input) {
  const entries = parseLogEntries(input.ticket_log).sort((a, b) => a.date - b.date);
  if (entries.length === 0) return { entries: [], openEntry: null, others: [] };
  let openIdx = entries.findIndex((e) => /open/i.test(e.desc));
  if (openIdx < 0) openIdx = 0;
  const openEntry = entries[openIdx];
  const others = entries.filter((_, i) => i !== openIdx);
  return { entries, openEntry, others };
}

function extractHolidays(text) {
  const str = String(text || "");
  const idx = str.toLowerCase().indexOf("holiday");
  const region = idx >= 0 ? str.slice(idx) : str;
  const matches = region.match(/\d{4}-\d{2}-\d{2}/g) || [];
  return new Set(matches);
}

function isBusinessMoment(date, bizStart, bizEnd, bizDaysSet, holidays) {
  const day = date.getUTCDay();
  if (!bizDaysSet.has(day)) return false;
  const dateStr = date.toISOString().slice(0, 10);
  if (holidays.has(dateStr)) return false;
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60;
  return hour >= bizStart && hour < bizEnd;
}

function addBusinessHours(start, hoursNeeded, bizStart, bizEnd, bizDaysSet, holidays) {
  let cur = new Date(start.getTime());
  let remainingMinutes = Math.round(hoursNeeded * 60);
  let guard = 0;
  while (remainingMinutes > 0 && guard < 2_000_000) {
    if (isBusinessMoment(cur, bizStart, bizEnd, bizDaysSet, holidays)) {
      remainingMinutes -= 1;
    }
    cur = new Date(cur.getTime() + 60000);
    guard += 1;
  }
  return cur;
}

export function buildState(input) {
  const { openEntry, others } = getOpenAndOthers(input);
  return {
    policy_text: input.policy_text,
    ticket_log: input.ticket_log,
    open_line: openEntry ? openEntry.text : null,
    candidates: others.map((e) => e.text),
  };
}

export function questions(input) {
  const { others } = getOpenAndOthers(input);
  const q = {
    priority: {
      type: "choice",
      instructions:
        "In `ticket_log`, what priority was the ticket given at the moment it was opened (its original priority), ignoring any later priority changes?",
      criteria: {
        Urgent: "the opening entry states priority Urgent",
        High: "the opening entry states priority High",
        Normal: "the opening entry states priority Normal",
        Low: "the opening entry states priority Low",
      },
    },
    biz_start_hour: {
      type: "choice",
      instructions:
        "According to `policy_text`, at what UTC hour (0-23, 24-hour clock) do business hours begin each business day?",
      criteria: Object.fromEntries(
        Array.from({ length: 24 }, (_, h) => [String(h), `business hours start at ${h}:00 UTC`])
      ),
    },
    biz_end_hour: {
      type: "choice",
      instructions:
        "According to `policy_text`, at what UTC hour (0-23, 24-hour clock) do business hours end each business day?",
      criteria: Object.fromEntries(
        Array.from({ length: 24 }, (_, h) => [String(h), `business hours end at ${h}:00 UTC`])
      ),
    },
  };

  for (const [key, name] of Object.entries(DAY_NAMES)) {
    q[`biz_${key}`] = {
      type: "noul",
      instructions: `Does \`policy_text\` count ${name} as a business day for calculating business-hour SLA targets?`,
      criteria: {
        true: `${name} is a business day under the policy`,
        false: `${name} is not a business day under the policy`,
      },
    };
  }

  for (const p of PRIORITIES) {
    const label = p[0].toUpperCase() + p.slice(1);
    q[`${p}_unit`] = {
      type: "choice",
      instructions: `According to \`policy_text\`, what unit is the first-response time target for priority ${label} expressed in?`,
      criteria: UNIT_CRITERIA,
    };
    q[`${p}_amount`] = {
      type: "choice",
      instructions: `According to \`policy_text\`, what number is the first-response time target for priority ${label} (the count of hours or days stated, before any unit conversion)?`,
      criteria: amountCriteria(),
    };
  }

  others.forEach((_, i) => {
    q[`reply_${i}`] = {
      type: "noul",
      instructions: `Look at \`candidates[${i}]\`, one entry from the ticket log. Does it describe an actual reply message sent to the customer by a support agent (a human agent responding to the ticket), as opposed to a message from the customer, an automatic/system-generated acknowledgement, or an internal note not sent to the customer?`,
      criteria: {
        true: "it is a genuine reply sent to the customer by a support agent",
        false: "it is not (customer message, auto-acknowledgement, or internal note)",
      },
    };
  });

  return q;
}

export function decide(answers, input) {
  try {
    const { entries, openEntry, others } = getOpenAndOthers(input);
    if (!openEntry) return { breached: "abstain" };

    const priorityAns = answers.priority;
    if (!priorityAns || priorityAns.confidence < 0.55) return { breached: "abstain" };
    const pKey = priorityAns.choice.toLowerCase();
    if (!PRIORITIES.includes(pKey)) return { breached: "abstain" };

    const unitAns = answers[`${pKey}_unit`];
    const amountAns = answers[`${pKey}_amount`];
    if (!unitAns || !amountAns || unitAns.confidence < 0.55 || amountAns.confidence < 0.55) {
      return { breached: "abstain" };
    }
    const unit = unitAns.choice;
    const amount = Number(amountAns.choice);
    if (!Number.isFinite(amount) || amount <= 0) return { breached: "abstain" };

    let bizStart = 9;
    let bizEnd = 17;
    let bizDaysSet = new Set([1, 2, 3, 4, 5]);

    if (unit === "business_hours" || unit === "business_days") {
      const bsAns = answers.biz_start_hour;
      const beAns = answers.biz_end_hour;
      if (!bsAns || !beAns || bsAns.confidence < 0.5 || beAns.confidence < 0.5) {
        return { breached: "abstain" };
      }
      bizStart = Number(bsAns.choice);
      bizEnd = Number(beAns.choice);
      if (!(bizEnd > bizStart)) return { breached: "abstain" };

      bizDaysSet = new Set();
      for (const key of Object.keys(DAY_NAMES)) {
        const a = answers[`biz_${key}`];
        if (a && a.noul >= 0.5) bizDaysSet.add(DAY_INDEX[key]);
      }
      if (bizDaysSet.size === 0) return { breached: "abstain" };
    }

    const holidays = extractHolidays(input.policy_text);

    let amountHours = amount;
    if (unit === "calendar_days") amountHours = amount * 24;
    if (unit === "business_days") amountHours = amount * (bizEnd - bizStart);

    const deadline =
      unit === "calendar_hours" || unit === "calendar_days"
        ? new Date(openEntry.date.getTime() + amountHours * 3600000)
        : addBusinessHours(openEntry.date, amountHours, bizStart, bizEnd, bizDaysSet, holidays);

    let replyDate = null;
    for (let i = 0; i < others.length; i++) {
      const ans = answers[`reply_${i}`];
      if (!ans) continue;
      if (ans.noul > 0.5) {
        if (Math.abs(ans.noul - 0.5) < 0.15) return { breached: "abstain" };
        replyDate = others[i].date;
        break;
      }
    }

    if (replyDate) {
      return { breached: replyDate > deadline ? "yes" : "no" };
    }

    const lastKnown = entries[entries.length - 1].date;
    return { breached: lastKnown > deadline ? "yes" : "no" };
  } catch {
    return { breached: "abstain" };
  }
}
