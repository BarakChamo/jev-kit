// map.mjs — first-response SLA breach check.
//
// Design (per Jev question-map rules): Jev only reads present-tense facts out of
// `policy_text` and `log_lines` — which line opened the ticket, which line is the
// first human agent reply, the priority at open, the stated target (number, unit,
// clock), the business-hours window, which weekdays are business days, and which
// dates are holidays. All date arithmetic, business-hour accumulation and the
// final "within target?" comparison happen in code. Every acted-on answer must
// clear a probability gate; anything unsure, unstated or contradictory abstains.

const GATE = 0.8;        // act on a choice label only if its probability >= 0.8
const NOUL_HI = 0.8;     // noul above -> true
const NOUL_LO = 0.2;     // noul below -> false, between -> abstain

const DAY_MS = 86400000;
const TS = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;
const WEEKDAYS = [[0, "Sunday"], [1, "Monday"], [2, "Tuesday"], [3, "Wednesday"], [4, "Thursday"], [5, "Friday"], [6, "Saturday"]];
const PRIORITIES = ["urgent", "high", "normal", "low"];

const pad = (n) => String(n).padStart(2, "0");
const isoDate = (t) => new Date(t).toISOString().slice(0, 10);

function lines(input) {
  return String(input?.ticket_log ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}
function parseTs(s) {
  const m = TS.exec(s);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
}
function spanDates(ls) {
  const ts = ls.map(parseTs).filter((t) => t != null);
  if (!ts.length) return [];
  const lo = Math.floor(Math.min(...ts) / DAY_MS) * DAY_MS;
  const hi = Math.floor(Math.max(...ts) / DAY_MS) * DAY_MS;
  const out = [];
  for (let t = lo; t <= hi; t += DAY_MS) out.push(isoDate(t));
  return out;
}

export function buildState(input) {
  return {
    policy_text: String(input?.policy_text ?? ""),
    ticket_log: String(input?.ticket_log ?? ""),
    log_lines: lines(input),
  };
}

export function questions(input) {
  const ls = lines(input);
  const q = {};

  const lineOpts = Object.fromEntries(ls.map((text, i) => [String(i), text]));
  lineOpts.none = "no line in `log_lines` records this event";

  q.open_line = {
    type: "choice",
    instructions: "Which line of `log_lines` records when the ticket was opened (created) by the customer? Pick the line that states the opening event and its time, not a later status change.",
    criteria: lineOpts,
  };
  q.first_agent_reply_line = {
    type: "choice",
    instructions: "Which line of `log_lines` records the FIRST reply from a human support agent? Per `policy_text`, only a reply from a support agent counts as a first response: messages from the customer and automatic acknowledgements do not count. If several lines are agent replies, pick the earliest one. Pick \"none\" if no line records a reply from a support agent.",
    criteria: lineOpts,
  };
  q.priority_at_open = {
    type: "choice",
    instructions: "What priority did the ticket have at the moment it was opened, according to `ticket_log`? Per `policy_text`, the priority at opening is the one that applies even if the priority was changed later; ignore later changes.",
    criteria: {
      urgent: "the priority at opening was Urgent",
      high: "the priority at opening was High",
      normal: "the priority at opening was Normal",
      low: "the priority at opening was Low",
      not_stated: "`ticket_log` does not state the priority the ticket had when it was opened",
    },
  };

  const valueOpts = Object.fromEntries(
    ["0.5", "1", "2", "3", "4", "6", "8", "12", "16", "24", "40"].map((v) => [v, `the stated number is ${v}`])
  );
  valueOpts.other = "the stated number is not one of the listed values";
  valueOpts.not_stated = "`policy_text` does not state a first-response target for this priority";

  const unitOpts = {
    minutes: "minutes",
    hours: "plain hours, not qualified as business hours",
    business_hours: "business hours",
    business_days: "business days",
    calendar_days: "calendar days (24-hour days)",
    other: "a different unit than any listed",
    not_stated: "no unit is stated",
  };
  const clockOpts = {
    all_hours: "the target runs around the clock: all hours of all days count",
    business_hours: "only business hours count toward the target",
    not_stated: "`policy_text` does not say which hours count",
  };

  for (const p of PRIORITIES) {
    q[`target_value_${p}`] = {
      type: "choice",
      instructions: `What is the number in the first-response target that \`policy_text\` sets for ${p} priority tickets? Read the stated number exactly. If the target is stated in two equivalent ways, such as "2 business days (16 business hours)", give the number expressed in hours (the 16 in the example).`,
      criteria: valueOpts,
    };
    q[`target_unit_${p}`] = {
      type: "choice",
      instructions: `In what unit does \`policy_text\` state the first-response target for ${p} priority tickets? If it is stated in two equivalent ways, such as "2 business days (16 business hours)", answer with the hours unit (business hours in the example).`,
      criteria: unitOpts,
    };
    q[`target_clock_${p}`] = {
      type: "choice",
      instructions: `Which hours count toward the first-response target for ${p} priority tickets, according to \`policy_text\`: all hours around the clock, or business hours only?`,
      criteria: clockOpts,
    };
  }

  const hourOpts = Object.fromEntries(Array.from({ length: 24 }, (_, h) => [String(h), `the hour ${pad(h)} (24-hour clock)`]));
  const minuteOpts = Object.fromEntries(Array.from({ length: 60 }, (_, m) => [String(m), `${pad(m)} minutes past the hour`]));
  q.business_start_hour = { type: "choice", instructions: "At what hour of the day do business hours begin, according to `policy_text`? Answer with the hour in 24-hour time.", criteria: hourOpts };
  q.business_start_minute = { type: "choice", instructions: "At how many minutes past the hour do business hours begin, according to `policy_text`?", criteria: minuteOpts };
  q.business_end_hour = { type: "choice", instructions: "At what hour of the day do business hours end, according to `policy_text`? Answer with the hour in 24-hour time.", criteria: hourOpts };
  q.business_end_minute = { type: "choice", instructions: "At how many minutes past the hour do business hours end, according to `policy_text`?", criteria: minuteOpts };

  for (const [, name] of WEEKDAYS) {
    q[`business_day_${name.toLowerCase()}`] = {
      type: "noul",
      instructions: `According to \`policy_text\`, is ${name} one of the business days on which business hours run?`,
      criteria: { true: `${name} is a business day`, false: `${name} is not a business day` },
    };
  }
  for (const d of spanDates(ls)) {
    q[`holiday_${d}`] = {
      type: "noul",
      instructions: `Does \`policy_text\` list ${d} as a public holiday on which business hours do not run?`,
      criteria: { true: `${d} is listed as a public holiday`, false: `${d} is not listed as a public holiday` },
    };
  }
  return q;
}

export function decide(answers, input) {
  const abstain = { breached: "abstain" };
  const ls = lines(input);
  const pick = (id) => {
    const a = answers?.[id];
    if (!a || typeof a.choice !== "string") return null;
    return (a.probabilities?.[a.choice] ?? 0) >= GATE ? a.choice : null;
  };
  const flag = (id) => {
    const n = answers?.[id]?.noul;
    if (typeof n !== "number") return null;
    return n >= NOUL_HI ? true : n <= NOUL_LO ? false : null;
  };

  // Event lines -> exact timestamps (parsing and arithmetic in code, never by the model).
  const oi = pick("open_line"), ri = pick("first_agent_reply_line");
  if (!oi || !ri || oi === "none" || ri === "none") return abstain;
  const t0 = parseTs(ls[+oi] ?? ""), t1 = parseTs(ls[+ri] ?? "");
  if (t0 == null || t1 == null || t1 < t0) return abstain;

  // Priority at open and its stated target.
  const prio = pick("priority_at_open");
  if (!prio || prio === "not_stated") return abstain;
  const value = pick(`target_value_${prio}`);
  const unit = pick(`target_unit_${prio}`);
  const clock = pick(`target_clock_${prio}`);
  if (!value || value === "other" || value === "not_stated") return abstain;
  if (!unit || unit === "other" || unit === "not_stated") return abstain;
  if (!clock) return abstain;

  const businessUnit = unit === "business_hours" || unit === "business_days";
  let measure = clock; // "all_hours" | "business_hours" | "not_stated"
  if (measure === "not_stated") {
    if (!businessUnit) return abstain;
    measure = "business_hours";
  } else if (businessUnit && measure === "all_hours") {
    return abstain; // contradictory read of the policy: business unit but around-the-clock
  }

  // Business-hours window, needed to measure in business hours or to convert business days.
  let startMin = null, endMin = null;
  if (measure === "business_hours" || unit === "business_days") {
    const sh = pick("business_start_hour"), sm = pick("business_start_minute");
    const eh = pick("business_end_hour"), em = pick("business_end_minute");
    if (sh == null || sm == null || eh == null || em == null) return abstain;
    startMin = Number(sh) * 60 + Number(sm);
    endMin = Number(eh) * 60 + Number(em);
    if (!(endMin > startMin)) return abstain;
  }

  const v = Number(value);
  const target =
    unit === "minutes" ? v / 60 :
    unit === "hours" || unit === "business_hours" ? v :
    unit === "business_days" ? v * ((endMin - startMin) / 60) :
    v * 24; // calendar_days

  let elapsed;
  if (measure === "all_hours") {
    elapsed = (t1 - t0) / 3600000;
  } else {
    const biz = {};
    for (const [wd, name] of WEEKDAYS) {
      const f = flag(`business_day_${name.toLowerCase()}`);
      if (f == null) return abstain;
      biz[wd] = f;
    }
    const d0 = Math.floor(t0 / DAY_MS) * DAY_MS, d1 = Math.floor(t1 / DAY_MS) * DAY_MS;
    const holidays = new Set();
    for (let t = d0; t <= d1; t += DAY_MS) {
      const f = flag(`holiday_${isoDate(t)}`);
      if (f == null) return abstain;
      if (f) holidays.add(isoDate(t));
    }
    let ms = 0;
    for (let t = d0; t <= d1; t += DAY_MS) {
      if (!biz[new Date(t).getUTCDay()] || holidays.has(isoDate(t))) continue;
      ms += Math.max(0, Math.min(t1, t + endMin * 60000) - Math.max(t0, t + startMin * 60000));
    }
    elapsed = ms / 3600000;
  }

  // "Within the target" breached only when elapsed strictly exceeds it (comparison in code).
  return { breached: elapsed > target + 1e-9 ? "yes" : "no" };
}
