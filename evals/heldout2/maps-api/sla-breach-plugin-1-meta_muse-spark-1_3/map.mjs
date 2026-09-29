const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const YEARS = ["2024","2025","2026","2027","2028"];

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    ticket_log: input.ticket_log,
    sla_convention: "Business hours are 09:00 to 17:00 UTC, Monday to Friday, excluding public holidays. Only minutes inside those windows count as business time. The priority the ticket had when it was opened is the one that applies even if it is changed later. Only a reply from a support agent counts as a first response; customer messages and automatic acknowledgements do not count."
  };
}

function yearCrit(extra) {
  const c = {};
  for (const y of YEARS) c[y] = `the stated year is ${y}`;
  for (const e of extra) c[e] = e === "unclear" ? "cannot be determined from the stated field" : "no reply from a support agent is stated in `ticket_log`";
  c["unclear"] = "cannot be determined from the stated field";
  return c;
}
function monthCrit(isResp) {
  const c = {};
  for (const m of MONTHS) c[m] = `the stated month is ${m}`;
  if (isResp) c["no_response"] = "no reply from a support agent is stated in `ticket_log`";
  c["unclear"] = "cannot be determined from the stated field";
  return c;
}
function dayCrit(isResp) {
  const c = {};
  for (let d = 1; d <= 31; d++) c[String(d)] = `the stated day of month is ${d}`;
  if (isResp) c["no_response"] = "no reply from a support agent is stated in `ticket_log`";
  c["unclear"] = "cannot be determined from the stated field";
  return c;
}
function hourCrit(isResp) {
  const c = {};
  for (let h = 0; h <= 23; h++) c[String(h)] = `the stated hour (UTC) is ${h}`;
  if (isResp) c["no_response"] = "no reply from a support agent is stated in `ticket_log`";
  c["unclear"] = "cannot be determined from the stated field";
  return c;
}
function minCrit(isResp) {
  const c = {};
  for (let m = 0; m <= 59; m++) c[String(m)] = `the stated minute is ${m}`;
  if (isResp) c["no_response"] = "no reply from a support agent is stated in `ticket_log`";
  c["unclear"] = "cannot be determined from the stated field";
  return c;
}

export function questions(input) {
  return {
    response_present: {
      type: "choice",
      instructions: "Does `ticket_log` include any reply from a support agent? Customer messages and automatic acknowledgements do not count.",
      criteria: {
        present: "a reply from a support agent is stated in `ticket_log`",
        absent: "no reply from a support agent is stated in `ticket_log`",
        unclear: "cannot be determined from `ticket_log`"
      }
    },
    priority_at_open: {
      type: "choice",
      instructions: "What priority did the ticket have when it was opened, as stated in `ticket_log`? Use the opening priority even when `ticket_log` later states a change.",
      criteria: {
        urgent: "the opening priority stated in `ticket_log` is Urgent",
        high: "the opening priority stated in `ticket_log` is High",
        normal: "the opening priority stated in `ticket_log` is Normal",
        low: "the opening priority stated in `ticket_log` is Low",
        unclear: "the opening priority cannot be determined from `ticket_log`"
      }
    },
    open_year: { type: "choice", instructions: "What calendar year is stated in `ticket_log` for the moment the ticket was opened?", criteria: yearCrit([]) },
    open_month: { type: "choice", instructions: "What calendar month is stated in `ticket_log` for the moment the ticket was opened?", criteria: monthCrit(false) },
    open_day: { type: "choice", instructions: "What day of the month is stated in `ticket_log` for the moment the ticket was opened?", criteria: dayCrit(false) },
    open_hour: { type: "choice", instructions: "What hour (UTC) is stated in `ticket_log` for the moment the ticket was opened?", criteria: hourCrit(false) },
    open_minute: { type: "choice", instructions: "What minute is stated in `ticket_log` for the moment the ticket was opened?", criteria: minCrit(false) },
    resp_year: { type: "choice", instructions: "What calendar year is stated in `ticket_log` for the first reply from a support agent? Customer messages and automatic acknowledgements do not count. Select no_response when `ticket_log` states no reply from a support agent.", criteria: yearCrit(["no_response"]) },
    resp_month: { type: "choice", instructions: "What calendar month is stated in `ticket_log` for the first reply from a support agent? Customer messages and automatic acknowledgements do not count. Select no_response when `ticket_log` states no reply from a support agent.", criteria: monthCrit(true) },
    resp_day: { type: "choice", instructions: "What day of the month is stated in `ticket_log` for the first reply from a support agent? Customer messages and automatic acknowledgements do not count. Select no_response when `ticket_log` states no reply from a support agent.", criteria: dayCrit(true) },
    resp_hour: { type: "choice", instructions: "What hour (UTC) is stated in `ticket_log` for the first reply from a support agent? Customer messages and automatic acknowledgements do not count. Select no_response when `ticket_log` states no reply from a support agent.", criteria: hourCrit(true) },
    resp_minute: { type: "choice", instructions: "What minute is stated in `ticket_log` for the first reply from a support agent? Customer messages and automatic acknowledgements do not count. Select no_response when `ticket_log` states no reply from a support agent.", criteria: minCrit(true) }
  };
}

function pad2(n) { return String(n).padStart(2, "0"); }

export function decide(answers, input) {
  const GATE = 0.8;
  const abstain = { breached: "abstain" };
  function read(id) {
    const a = answers ? answers[id] : null;
    if (!a || typeof a.choice !== "string") return null;
    const p = (a.probabilities && typeof a.probabilities[a.choice] === "number") ? a.probabilities[a.choice] : (typeof a.confidence === "number" ? a.confidence : 0);
    return { choice: a.choice, p };
  }
  const rp = read("response_present");
  const pr = read("priority_at_open");
  const oy = read("open_year"), om = read("open_month"), od = read("open_day"), oh = read("open_hour"), omin = read("open_minute");
  const ry = read("resp_year"), rm = read("resp_month"), rd = read("resp_day"), rh = read("resp_hour"), rmin = read("resp_minute");
  const all = [rp, pr, oy, om, od, oh, omin, ry, rm, rd, rh, rmin];
  if (all.some(v => !v)) return abstain;
  if (all.some(v => v.p < GATE)) return abstain;
  if (rp.choice !== "present") return abstain;
  if (pr.choice === "unclear") return abstain;
  for (const v of [oy, om, od, oh, omin, ry, rm, rd, rh, rmin]) {
    if (v.choice === "unclear" || v.choice === "no_response") return abstain;
  }
  const omi = MONTHS.indexOf(om.choice);
  const rmi = MONTHS.indexOf(rm.choice);
  if (omi < 0 || rmi < 0) return abstain;
  const oY = parseInt(oy.choice, 10), oD = parseInt(od.choice, 10), oH = parseInt(oh.choice, 10), oM = parseInt(omin.choice, 10);
  const rY = parseInt(ry.choice, 10), rD = parseInt(rd.choice, 10), rH = parseInt(rh.choice, 10), rMm = parseInt(rmin.choice, 10);
  if ([oY, oD, oH, oM, rY, rD, rH, rMm].some(n => !Number.isFinite(n))) return abstain;
  if (oD < 1 || oD > 31 || rD < 1 || rD > 31 || oH > 23 || rH > 23 || oM > 59 || rMm > 59) return abstain;
  const openMs = Date.UTC(oY, omi, oD, oH, oM, 0);
  const respMs = Date.UTC(rY, rmi, rD, rH, rMm, 0);
  const oc = new Date(openMs), rc = new Date(respMs);
  if (oc.getUTCFullYear() !== oY || oc.getUTCMonth() !== omi || oc.getUTCDate() !== oD || oc.getUTCHours() !== oH || oc.getUTCMinutes() !== oM) return abstain;
  if (rc.getUTCFullYear() !== rY || rc.getUTCMonth() !== rmi || rc.getUTCDate() !== rD || rc.getUTCHours() !== rH || rc.getUTCMinutes() !== rMm) return abstain;
  if (!(respMs >= openMs)) return abstain;

  const policy = (input && typeof input.policy_text === "string") ? input.policy_text : "";
  const holidays = new Set(policy.match(/\d{4}-\d{2}-\d{2}/g) || []);
  let startMin = 9 * 60, endMin = 17 * 60;
  const mBH = policy.match(/business hours are\s+(\d{1,2})(?::(\d{2}))?\s*to\s*(\d{1,2})(?::(\d{2}))?/i);
  if (mBH) {
    startMin = parseInt(mBH[1], 10) * 60 + (mBH[2] ? parseInt(mBH[2], 10) : 0);
    endMin = parseInt(mBH[3], 10) * 60 + (mBH[4] ? parseInt(mBH[4], 10) : 0);
    if (!(endMin > startMin)) return abstain;
  }
  const prio = pr.choice.toLowerCase();
  let targetHours = prio === "urgent" ? 1 : prio === "high" ? 4 : 16;
  let isClock = prio === "urgent";
  const mU = policy.match(/urgent[^\n]*?within\s+(\d+(?:\.\d+)?)\s*hour/i);
  if (mU && prio === "urgent") targetHours = parseFloat(mU[1]);
  const mH = policy.match(/high[^\n]*?within\s+(\d+(?:\.\d+)?)\s*(business\s*)?hour/i);
  if (mH && prio === "high") targetHours = parseFloat(mH[1]);
  const mN = policy.match(/normal and low[^\n]*?\((\d+(?:\.\d+)?)\s*business\s*hour/i);
  if (mN && (prio === "normal" || prio === "low")) targetHours = parseFloat(mN[1]);
  if (prio === "urgent") {
    if (/urgent[^\n]*?business hour/i.test(policy)) isClock = false;
    else if (/urgent[^\n]*?(around the clock|all days|all hours|24\s*\/\s*7)/i.test(policy)) isClock = true;
  }
  if (!Number.isFinite(targetHours) || targetHours < 0) return abstain;

  if (isClock) {
    const elapsed = respMs - openMs;
    const breached = elapsed > targetHours * 3600 * 1000;
    return { breached: breached ? "yes" : "no" };
  }
  function isBizDay(y, m, d) {
    const dt = new Date(Date.UTC(y, m, d));
    const dow = dt.getUTCDay();
    if (dow === 0 || dow === 6) return false;
    const iso = `${y}-${pad2(m + 1)}-${pad2(d)}`;
    if (holidays.has(iso)) return false;
    return true;
  }
  let total = 0;
  const day0 = Date.UTC(oc.getUTCFullYear(), oc.getUTCMonth(), oc.getUTCDate());
  for (let ds = day0; ds <= respMs; ds += 86400000) {
    const d = new Date(ds);
    if (!isBizDay(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) continue;
    const ws = ds + startMin * 60000;
    const we = ds + endMin * 60000;
    const s = Math.max(openMs, ws);
    const e = Math.min(respMs, we);
    if (e > s) total += e - s;
  }
  const breached = total > targetHours * 3600 * 1000;
  return { breached: breached ? "yes" : "no" };
}
