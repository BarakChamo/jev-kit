function splitLines(ticket_log) {
  return String(ticket_log ?? "").split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);
}

function parseTimestampMs(line) {
  const m = String(line).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?:\s*UTC)?/);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return Number.isNaN(ms) ? null : ms;
}

function parseHolidays(policy_text) {
  const text = String(policy_text ?? "");
  const afterHoliday = text.split(/holiday/i).slice(1).join(" ");
  const src = afterHoliday || text;
  const dates = src.match(/\d{4}-\d{2}-\d{2}/g) || [];
  return new Set(dates);
}

function parseBusinessHours(policy_text) {
  const m = String(policy_text ?? "").match(/(\d{1,2}):(\d{2})\s*(?:UTC)?\s*(?:to|-|–)\s*(\d{1,2}):(\d{2})/i);
  if (!m) return { startHour: 9, endHour: 17 };
  return { startHour: +m[1], endHour: +m[3] };
}

function dateKey(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

function businessMinutesBetween(startMs, endMs, holidays, startHour, endHour) {
  if (endMs <= startMs) return 0;
  let total = 0;
  const s = new Date(startMs);
  let dayMs = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  const endDayMs = Date.UTC(new Date(endMs).getUTCFullYear(), new Date(endMs).getUTCMonth(), new Date(endMs).getUTCDate());
  while (dayMs <= endDayMs) {
    const d = new Date(dayMs);
    const dow = d.getUTCDay();
    const key = dateKey(dayMs);
    if (dow >= 1 && dow <= 5 && !holidays.has(key)) {
      const bStart = dayMs + startHour * 3600000;
      const bEnd = dayMs + endHour * 3600000;
      const lo = Math.max(startMs, bStart);
      const hi = Math.min(endMs, bEnd);
      if (hi > lo) total += (hi - lo) / 60000;
    }
    dayMs += 86400000;
  }
  return total;
}

function parseTargets(policy_text) {
  const t = String(policy_text ?? "");
  let urgentMin = 60;
  let highMin = 4 * 60;
  let normalLowMin = 16 * 60;
  let mu = t.match(/Urgent[^.\n]*?within\s+(\d+(?:\.\d+)?)\s*hour/i);
  if (mu) urgentMin = parseFloat(mu[1]) * 60;
  let mh = t.match(/High[^.\n]*?within\s+(\d+(?:\.\d+)?)\s*business\s*hours?/i);
  if (mh) highMin = parseFloat(mh[1]) * 60;
  let mn = t.match(/Normal and Low[^.\n]*?\(\s*(\d+(?:\.\d+)?)\s*business\s*hours?/i);
  if (mn) normalLowMin = parseFloat(mn[1]) * 60;
  else {
    let md = t.match(/Normal and Low[^.\n]*?within\s+(\d+(?:\.\d+)?)\s*business\s*days?/i);
    if (md) normalLowMin = parseFloat(md[1]) * 2 * 8 * 60 / 2;
  }
  const urgentWall = /Urgent[^.\n]*(around the clock|all days|all hours|calendar|24\s*\/\s*7)/i.test(t);
  return { urgentMin, highMin, normalLowMin, urgentWall: urgentWall || true };
}

export function buildState(input) {
  const log_lines = splitLines(input.ticket_log);
  return {
    policy_text: input.policy_text,
    ticket_log: input.ticket_log,
    log_lines,
    convention: "A support-agent reply is a message written by a named support person answering the ticket. A customer message is written by the customer. An automatic acknowledgement is a system message saying the ticket was received or created. Only a reply written by a support agent counts as a first response.",
  };
}

export function questions(input) {
  const log_lines = splitLines(input.ticket_log);
  const idx = log_lines.map((_, i) => String(i));
  const openedCriteria = {};
  log_lines.forEach((text, i) => {
    openedCriteria[String(i)] = text.slice(0, 200) || `line ${i}`;
  });
  openedCriteria["unclear"] = "no line of log_lines clearly states that the ticket was opened; a person should decide";
  const q = {
    priority_at_open: {
      type: "choice",
      instructions: "What priority does `ticket_log` state for the ticket at the time it was opened?",
      criteria: {
        urgent: "ticket_log states the opening priority is Urgent",
        high: "ticket_log states the opening priority is High",
        normal: "ticket_log states the opening priority is Normal",
        low: "ticket_log states the opening priority is Low",
        ambiguous: "ticket_log states no opening priority or genuinely supports more than one; a person should decide",
      },
    },
    opened_line: {
      type: "choice",
      instructions: "Which line of `log_lines` states that the ticket was opened?",
      criteria: openedCriteria,
    },
    has_auto_ack: {
      type: "noul",
      instructions: "Does `ticket_log` include an automatic acknowledgement or system-generated message?",
      criteria: {
        true: "ticket_log includes an automatic acknowledgement, auto-reply, or system message",
        false: "ticket_log includes no such automatic message",
      },
    },
    priority_changed_later: {
      type: "noul",
      instructions: "Does `ticket_log` state that the ticket priority was changed after the ticket was opened?",
      criteria: {
        true: "ticket_log states the priority was changed, updated, or escalated after opening",
        false: "ticket_log states no such later change",
      },
    },
  };
  log_lines.forEach((_, i) => {
    q[`agent_${i}`] = {
      type: "noul",
      instructions: `Does \`log_lines[${i}]\` state a reply written by a support agent?`,
      criteria: {
        true: `log_lines[${i}] is a message written by a named support agent as a response`,
        false: `log_lines[${i}] is a customer message, an automatic acknowledgement or system message, or states no reply`,
      },
    };
  });
  void idx;
  return q;
}

export function decide(answers, input) {
  try {
    const log_lines = splitLines(input.ticket_log);
    const pAns = answers?.priority_at_open;
    const oAns = answers?.opened_line;
    if (!pAns || !oAns) return { breached: "abstain" };
    const pChoice = pAns.choice;
    const pProb = pAns.probabilities?.[pChoice] ?? pAns.confidence ?? 0;
    if (!pChoice || pChoice === "ambiguous" || pProb < 0.8) return { breached: "abstain" };
    if (!["urgent", "high", "normal", "low"].includes(pChoice)) return { breached: "abstain" };
    const oChoice = oAns.choice;
    const oProb = oAns.probabilities?.[oChoice] ?? oAns.confidence ?? 0;
    if (!oChoice || oChoice === "unclear" || oProb < 0.7) return { breached: "abstain" };
    const openedIdx = Number(oChoice);
    if (!Number.isInteger(openedIdx) || openedIdx < 0 || openedIdx >= log_lines.length) return { breached: "abstain" };
    const openedMs = parseTimestampMs(log_lines[openedIdx]);
    if (openedMs == null) return { breached: "abstain" };

    const autoNoul = answers?.has_auto_ack?.noul;
    const changedNoul = answers?.priority_changed_later?.noul;
    if (changedNoul != null && changedNoul > 0.5 && pProb < 0.9) return { breached: "abstain" };

    const candidates = [];
    for (let i = 0; i < log_lines.length; i++) {
      const a = answers?.[`agent_${i}`];
      if (!a || typeof a.noul !== "number") return { breached: "abstain" };
      if (a.noul > 0.5) {
        const ms = parseTimestampMs(log_lines[i]);
        if (ms == null) return { breached: "abstain" };
        candidates.push({ i, ms, p: a.noul });
      } else if (a.noul > 0.3) {
        const ms = parseTimestampMs(log_lines[i]);
        if (ms != null && ms > openedMs) return { breached: "abstain" };
      }
    }
    const afterOpen = candidates.filter((c) => c.ms >= openedMs).sort((x, y) => x.ms - y.ms);
    if (afterOpen.length === 0) return { breached: "abstain" };
    const first = afterOpen[0];
    if (first.p < 0.7) return { breached: "abstain" };
    if (autoNoul != null && autoNoul > 0.5 && first.p < 0.8) return { breached: "abstain" };

    const holidays = parseHolidays(input.policy_text);
    const { startHour, endHour } = parseBusinessHours(input.policy_text);
    const { urgentMin, highMin, normalLowMin, urgentWall } = parseTargets(input.policy_text);
    const respMs = first.ms;
    if (respMs < openedMs) return { breached: "abstain" };

    if (pChoice === "urgent") {
      const wallMin = (respMs - openedMs) / 60000;
      void urgentWall;
      return { breached: wallMin > urgentMin ? "yes" : "no" };
    }
    const target = pChoice === "high" ? highMin : normalLowMin;
    const bizMin = businessMinutesBetween(openedMs, respMs, holidays, startHour, endHour);
    return { breached: bizMin > target + 1e-9 ? "yes" : "no" };
  } catch {
    return { breached: "abstain" };
  }
}
