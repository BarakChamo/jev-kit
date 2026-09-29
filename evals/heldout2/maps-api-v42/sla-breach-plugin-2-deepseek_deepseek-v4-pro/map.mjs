function parseTimestamp(line) {
  const match = line.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})\s+UTC/i);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
}

function parsePolicy(text = '') {
  const firstNumber = (regex) => {
    const match = text.match(regex);
    return match ? Number(match[1]) : null;
  };

  const businessMatch = text.match(/Business hours are\s*(\d{1,2}):(\d{2})\s*to\s*(\d{1,2}):(\d{2})\s*UTC/i);
  const businessStartHour = businessMatch ? Number(businessMatch[1]) : 9;
  const businessEndHour = businessMatch ? Number(businessMatch[3]) : 17;

  const holidaySection = text.match(/excluding these public holidays:\s*([^\.]+)\./i);
  const holidayText = holidaySection ? holidaySection[1] : text;
  const holidays = [...new Set([...holidayText.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)].map((m) => `${m[1]}-${m[2]}-${m[3]}`))];

  const targetUrgent = firstNumber(/Urgent[^\n]*within\s+(\d+)\s+hour/i) ?? 1;
  const targetHigh = firstNumber(/High[^\n]*within\s+(\d+)\s+business\s+hour/i) ?? 4;

  let targetNormalLow =
    firstNumber(/Normal and Low[^\n]*\((\d+)\s+business\s+hours?\)/i) ??
    firstNumber(/Normal and Low[^\n]*within\s+(\d+)\s+business\s+hours?/i);

  if (targetNormalLow == null) {
    const days = firstNumber(/Normal and Low[^\n]*within\s+(\d+)\s+business\s+days?/i);
    if (days != null) targetNormalLow = days * (businessEndHour - businessStartHour);
  }

  return {
    businessStartHour,
    businessEndHour,
    holidays,
    targetHours: {
      urgent: targetUrgent,
      high: targetHigh,
      normalLow: targetNormalLow ?? 16,
    },
    urgentAroundClock: /around the clock|all days, all hours/i.test(text),
    weekdaysOnly: /Monday to Friday/i.test(text),
    priorityAtOpenApplies: /priority a ticket had when it was opened is the one that applies/i.test(text),
    onlyAgentReplyCounts: /Only a reply from a support agent counts/i.test(text),
  };
}

function countBusinessMs(start, end, startHour, endHour, holidays, weekdaysOnly = true) {
  if (end <= start) return 0;

  const DAY_MS = 86400000;
  const startDay = Date.UTC(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth(), new Date(start).getUTCDate());
  const endDay = Date.UTC(new Date(end).getUTCFullYear(), new Date(end).getUTCMonth(), new Date(end).getUTCDate());

  let total = 0;
  for (let day = startDay; day <= endDay; day += DAY_MS) {
    const date = new Date(day);

    if (weekdaysOnly) {
      const dow = date.getUTCDay();
      if (dow === 0 || dow === 6) continue;
    }

    const iso = date.toISOString().slice(0, 10);
    if (holidays.includes(iso)) continue;

    const dayStart = day + startHour * 3600000;
    const dayEnd = day + endHour * 3600000;
    const overlapStart = Math.max(start, dayStart);
    const overlapEnd = Math.min(end, dayEnd);

    if (overlapEnd > overlapStart) total += overlapEnd - overlapStart;
  }

  return total;
}

function lineOptions(lines, noneText) {
  const options = {};
  lines.forEach((text, index) => {
    options[String(index)] = text;
  });
  options.none = noneText;
  return options;
}

export function buildState(input) {
  const ticket_lines = input.ticket_log
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    policy_text: input.policy_text,
    ticket_log: input.ticket_log,
    ticket_lines,
  };
}

export function questions(input) {
  const state = buildState(input);

  return {
    open_line: {
      type: 'choice',
      instructions: 'Which line of `ticket_log` records the ticket being opened by the customer?',
      criteria: lineOptions(state.ticket_lines, 'No line records the ticket being opened'),
    },
    reply_line: {
      type: 'choice',
      instructions:
        'Which line of `ticket_log` contains the first reply from a support agent? Do not pick a customer message or an automatic acknowledgement. If there are several support-agent replies, pick the earliest one.',
      criteria: lineOptions(state.ticket_lines, 'No support-agent first response is present'),
    },
    open_priority: {
      type: 'choice',
      instructions: 'What priority did the ticket have when it was opened, according to `ticket_log`?',
      criteria: {
        urgent: 'the ticket was opened with priority Urgent',
        high: 'the ticket was opened with priority High',
        normal: 'the ticket was opened with priority Normal',
        low: 'the ticket was opened with priority Low',
      },
    },
  };
}

const LINE_P_MIN = 0.7;
const PRIORITY_P_MIN = 0.7;

export function decide(answers, input) {
  const state = buildState(input);
  const policy = parsePolicy(input.policy_text);

  const openChoice = answers.open_line?.choice;
  const replyChoice = answers.reply_line?.choice;
  const priorityChoice = answers.open_priority?.choice;

  if (!openChoice || !replyChoice || !priorityChoice) return { breached: 'abstain' };
  if (openChoice === 'none' || replyChoice === 'none') return { breached: 'abstain' };

  const pOpen = answers.open_line.probabilities?.[openChoice] ?? 0;
  const pReply = answers.reply_line.probabilities?.[replyChoice] ?? 0;
  const pPriority = answers.open_priority.probabilities?.[priorityChoice] ?? 0;

  if (pOpen < LINE_P_MIN || pReply < LINE_P_MIN || pPriority < PRIORITY_P_MIN) {
    return { breached: 'abstain' };
  }

  if (!policy.priorityAtOpenApplies) return { breached: 'abstain' };

  const openIndex = Number(openChoice);
  const replyIndex = Number(replyChoice);

  if (
    !Number.isInteger(openIndex) ||
    !Number.isInteger(replyIndex) ||
    openIndex < 0 ||
    replyIndex < 0 ||
    openIndex >= state.ticket_lines.length ||
    replyIndex >= state.ticket_lines.length
  ) {
    return { breached: 'abstain' };
  }

  const openTime = parseTimestamp(state.ticket_lines[openIndex]);
  const replyTime = parseTimestamp(state.ticket_lines[replyIndex]);

  if (openTime == null || replyTime == null || replyTime <= openTime) {
    return { breached: 'abstain' };
  }

  const targetHours =
    priorityChoice === 'urgent'
      ? policy.targetHours.urgent
      : priorityChoice === 'high'
        ? policy.targetHours.high
        : priorityChoice === 'normal' || priorityChoice === 'low'
          ? policy.targetHours.normalLow
          : null;

  if (targetHours == null) return { breached: 'abstain' };

  let elapsedMs;
  if (priorityChoice === 'urgent' && policy.urgentAroundClock) {
    elapsedMs = replyTime - openTime;
  } else {
    elapsedMs = countBusinessMs(
      openTime,
      replyTime,
      policy.businessStartHour,
      policy.businessEndHour,
      policy.holidays,
      policy.weekdaysOnly,
    );
  }

  const breached = elapsedMs > targetHours * 3600000 ? 'yes' : 'no';
  return { breached };
}
