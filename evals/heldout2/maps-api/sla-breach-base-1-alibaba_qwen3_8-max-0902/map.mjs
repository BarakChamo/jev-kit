const CHOICES = ["yes", "no", "abstain"];

export function buildState(input) {
  return {
    policy_text: input?.policy_text ?? "",
    ticket_log: input?.ticket_log ?? "",
    task: "Decide whether the first support-agent response breached the first-response SLA. Answer yes, no, or abstain."
  };
}

export function questions(input) {
  return {
    sla: {
      type: "choice",
      instructions: [
        "Use state.policy_text and state.ticket_log.",
        "Decide whether the first response from a support agent breached the first-response SLA.",
        "Use the priority the ticket had when opened.",
        "Customer messages and automatic acknowledgements are not first responses.",
        "Return abstain if any needed fact is missing or ambiguous."
      ].join("\n"),
      criteria: {
        yes: "The first support-agent response was later than the applicable SLA target.",
        no: "The first support-agent response was within the applicable SLA target.",
        abstain: "The case should be sent to a person because it cannot be decided reliably."
      }
    }
  };
}

export function decide(answers, input) {
  const ans = normalizeChoice(answers?.sla ?? answers?.breached ?? answers?.decision);
  const det = decideDeterministically(input);

  if (ans && (ans.choice === "yes" || ans.choice === "no") && ans.confidence >= 0.8) {
    if (!det.ok || det.breached === ans.choice) {
      return { breached: ans.choice };
    }
  }

  if (det.ok) {
    return { breached: det.breached };
  }

  if (ans && (ans.choice === "yes" || ans.choice === "no") && ans.confidence >= 0.6) {
    return { breached: ans.choice };
  }

  return { breached: "abstain" };
}

function decideDeterministically(input) {
  try {
    const policy = parsePolicy(input?.policy_text);
    const log = parseTicketLog(input?.ticket_log);

    const opened = log.opened;
    const firstAgent = log.firstAgent;

    if (!opened?.at || !opened?.priority || !firstAgent?.at) return { ok: false };
    if (firstAgent.at < opened.at) return { ok: false };

    const target = policy.targets[opened.priority];
    if (!target || !Number.isFinite(target.minutes)) return { ok: false };

    if (target.type === "calendar") {
      const elapsed = (firstAgent.at - opened.at) / 60000;
      return { ok: true, breached: elapsed > target.minutes ? "yes" : "no" };
    }

    const elapsed = businessElapsedMinutes(opened.at, firstAgent.at, policy, target.minutes + 0.5);
    return { ok: true, breached: elapsed > target.minutes ? "yes" : "no" };
  } catch {
    return { ok: false };
  }
}

function parsePolicy(text) {
  const s = String(text ?? "");
  const policy = {
    startMinute: 9 * 60,
    endMinute: 17 * 60,
    weekdays: new Set([1, 2, 3, 4, 5]),
    holidays: new Set(),
    targets: {}
  };

  const hours = s.match(/(\d{1,2}):(\d{2})\s*(?:UTC)?\s*to\s*(\d{1,2}):(\d{2})\s*(?:UTC)?/i);
  if (hours) {
    const start = Number(hours[1]) * 60 + Number(hours[2]);
    const end = Number(hours[3]) * 60 + Number(hours[4]);
    if (end > start) {
      policy.startMinute = start;
      policy.endMinute = end;
    }
  }

  if (/business hours[^\n]*(?:all days|seven days|including weekends?)/i.test(s)) {
    policy.weekdays = new Set([0, 1, 2, 3, 4, 5, 6]);
  }

  const holidayMatch = s.match(/(?:public\s+holidays?|holidays?)\s*:\s*([^\n.]+)/i);
  if (holidayMatch) {
    for (const part of holidayMatch[1].split(/[,\n]/)) {
      const date = part.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) policy.holidays.add(date);
    }
  }

  const businessDayMinutes = Math.max(0, policy.endMinute - policy.startMinute) || 8 * 60;

  for (const line of s.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s*([^:]+):\s*within\s+(\d+(?:\.\d+)?)\s*(business\s+)?(hour|day)s?/i);
    if (!m) continue;

    const amount = Number(m[2]);
    const unit = m[4].toLowerCase();
    const business = Boolean(m[3]) || /business/i.test(line);
    const calendar = /around the clock|all days|all hours|calendar|24x7|24\/7/i.test(line);

    let type;
    let minutes;

    if (calendar) {
      type = "calendar";
      minutes = unit === "day" ? amount * 1440 : amount * 60;
    } else if (business || unit === "day") {
      type = "business";
      if (unit === "day") {
        const explicit = line.match(/\((\d+(?:\.\d+)?)\s*business\s+hours?\)/i);
        minutes = explicit ? Number(explicit[1]) * 60 : amount * businessDayMinutes;
      } else {
        minutes = amount * 60;
      }
    } else {
      type = "calendar";
      minutes = unit === "day" ? amount * 1440 : amount * 60;
    }

    const target = { type, minutes };
    const labels = m[1].split(/[,/&]+|\band\b|\bor\b/i);

    for (let label of labels) {
      label = label.toLowerCase().replace(/priorit(?:y|ies)/gi, "").trim();
      if (!label) continue;

      if (/urgent|critical|p1/i.test(label)) policy.targets.urgent = target;
      if (/high|p2/i.test(label)) policy.targets.high = target;
      if (/normal|medium|p3/i.test(label)) policy.targets.normal = target;
      if (/low|p4/i.test(label)) policy.targets.low = target;
    }
  }

  if (!policy.targets.urgent) policy.targets.urgent = { type: "calendar", minutes: 60 };
  if (!policy.targets.high) policy.targets.high = { type: "business", minutes: 4 * 60 };
  if (!policy.targets.normal) policy.targets.normal = { type: "business", minutes: 2 * businessDayMinutes };
  if (!policy.targets.low) policy.targets.low = { type: "business", minutes: 2 * businessDayMinutes };

  return policy;
}

function parseTicketLog(log) {
  const events = [];
  const lineRe = /^\s*(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})\s*UTC(?:\s*\(([^)]*)\))?\s*:\s*(.*)$/i;

  for (const line of String(log ?? "").split(/\r?\n/)) {
    const m = line.match(lineRe);
    if (!m) continue;

    const at = Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      0,
      0
    );

    events.push({ at, text: m[7] });
  }

  events.sort((a, b) => a.at - b.at);
  if (!events.length) return {};

  let opened = null;
  for (const event of events) {
    if (/ticket opened|opened by/i.test(event.text)) {
      opened = { at: event.at, priority: extractPriority(event.text) };
      if (opened.priority) break;
    }
  }

  if (!opened) return {};

  if (!opened.priority) {
    for (const event of events) {
      if (event.at < opened.at) continue;
      if (/chang|updat|set\s+to|escalat/i.test(event.text)) continue;

      const priority = extractPriority(event.text);
      if (priority) {
        opened.priority = priority;
        break;
      }
    }
  }

  let firstAgent = null;
  const skipRe = /automatic|auto[-\s]?acknowledg|customer\s+(?:repl(?:y|ied|ies)|message|response)|customer response/i;
  const agentRe = /(first\s+(?:reply|response)\s+from\s+support\s+agent|support\s+agent\b.*\b(?:repl(?:y|ied|ies)|responded|response)|\bagent\b\s*(?:repl(?:y|ied|ies)|responded|response)|(?:reply|response)\s+from\s+(?:support\s+)?agent)/i;

  for (const event of events) {
    if (event.at < opened.at) continue;
    if (skipRe.test(event.text)) continue;

    if (agentRe.test(event.text)) {
      firstAgent = { at: event.at };
      break;
    }
  }

  return { opened, firstAgent };
}

function extractPriority(text) {
  const m = text.match(/priority\s*[:\-]?\s*(urgent|high|normal|low|p[1-4])/i);
  if (!m) return null;

  const p = m[1].toLowerCase();
  if (p === "p1") return "urgent";
  if (p === "p2") return "high";
  if (p === "p3") return "normal";
  if (p === "p4") return "low";
  return p;
}

function businessElapsedMinutes(start, end, policy, limit = Infinity) {
  if (!(end > start)) return 0;

  let total = 0;
  let day = dayStartMs(start);
  const lastDay = dayStartMs(end);

  while (day <= lastDay) {
    const date = new Date(day);

    if (policy.weekdays.has(date.getUTCDay()) && !policy.holidays.has(dateKey(day))) {
      const winStart = day + policy.startMinute * 60000;
      const winEnd = day + policy.endMinute * 60000;

      const s = Math.max(start, winStart);
      const e = Math.min(end, winEnd);

      if (e > s) {
        total += (e - s) / 60000;
        if (total >= limit) return total;
      }
    }

    day = addDays(day, 1);
  }

  return total;
}

function normalizeChoice(ans) {
  if (!ans || typeof ans !== "object") return null;

  const explicitConfidence = Number.isFinite(ans.confidence) ? ans.confidence : null;

  if (typeof ans.choice === "string") {
    const choice = ans.choice.trim().toLowerCase();
    if (CHOICES.includes(choice)) {
      return { choice, confidence: explicitConfidence == null ? 1 : explicitConfidence };
    }
  }

  if (ans.probabilities && typeof ans.probabilities === "object") {
    let best = null;
    let bestP = -1;

    for (const [key, p] of Object.entries(ans.probabilities)) {
      const choice = String(key).trim().toLowerCase();
      if (!CHOICES.includes(choice) || !Number.isFinite(p)) continue;

      if (p > bestP) {
        best = choice;
        bestP = p;
      }
    }

    if (best) {
      return { choice: best, confidence: Math.max(explicitConfidence ?? 0, bestP) };
    }
  }

  return null;
}

function dateKey(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayStartMs(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function addDays(ms, n) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n);
}
