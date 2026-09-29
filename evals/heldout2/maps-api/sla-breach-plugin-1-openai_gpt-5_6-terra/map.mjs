const PRIORITIES = ['Urgent', 'High', 'Normal', 'Low'];
const UNITS = ['clock_minutes', 'clock_hours', 'clock_days', 'business_hours', 'business_days'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const ACT_THRESHOLD = 0.85;
const REJECT_THRESHOLD = 0.15;

const options = (values, description = null) =>
  Object.fromEntries(values.map((value) => [String(value), description ?? String(value)]));

const numberOptions = options(
  Array.from({ length: 180 }, (_, index) => index + 1),
  'This exact positive number is stated.'
);

function linesFrom(input) {
  return String(input?.ticket_log ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function holidayDatesFrom(input) {
  return [...new Set(String(input?.policy_text ?? '').match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [])];
}

export function buildState(input) {
  return {
    policy_text: String(input?.policy_text ?? ''),
    ticket_log: String(input?.ticket_log ?? ''),
    ticket_lines: linesFrom(input),
    policy_date_candidates: holidayDatesFrom(input),
    calculation_convention:
      'Use the written policy as the source of truth. A business hour is a minute within the stated business-day schedule. Count only elapsed qualifying business minutes after the ticket opens; do not count holidays or non-business periods. A support-agent reply counts only when the ticket log records it as a reply from a support agent, not as a customer message or automatic acknowledgement. Timestamps must be explicit UTC timestamps for this automated calculation.',
  };
}

export function questions(input) {
  const questions = {
    opened_priority: {
      type: 'choice',
      instructions:
        'Which priority does `ticket_log` state the ticket had when it was opened? Use the priority at opening, not a later changed priority.',
      criteria: {
        Urgent: 'The ticket was opened with priority Urgent.',
        High: 'The ticket was opened with priority High.',
        Normal: 'The ticket was opened with priority Normal.',
        Low: 'The ticket was opened with priority Low.',
        not_stated_or_ambiguous: 'The opening priority is absent or genuinely ambiguous.',
      },
    },
    business_start_hour: {
      type: 'choice',
      instructions:
        'What hour of the day does `policy_text` state business hours begin? Read the stated clock hour exactly.',
      criteria: options(Array.from({ length: 24 }, (_, i) => i), 'This exact hour is the stated start hour.'),
    },
    business_start_minute: {
      type: 'choice',
      instructions:
        'What minute within the hour does `policy_text` state business hours begin? Read the stated minute exactly.',
      criteria: options(Array.from({ length: 60 }, (_, i) => i), 'This exact minute is the stated start minute.'),
    },
    business_end_hour: {
      type: 'choice',
      instructions:
        'What hour of the day does `policy_text` state business hours end? Read the stated clock hour exactly.',
      criteria: options(Array.from({ length: 24 }, (_, i) => i), 'This exact hour is the stated end hour.'),
    },
    business_end_minute: {
      type: 'choice',
      instructions:
        'What minute within the hour does `policy_text` state business hours end? Read the stated minute exactly.',
      criteria: options(Array.from({ length: 60 }, (_, i) => i), 'This exact minute is the stated end minute.'),
    },
  };

  for (const day of DAYS) {
    questions[`business_day_${day}`] = {
      type: 'noul',
      instructions: `Does \`policy_text\` define ${day} as a business day?`,
      criteria: {
        true: `${day} is included in the policy's business-day schedule.`,
        false: `${day} is not included in the policy's business-day schedule.`,
      },
    };
  }

  for (const priority of PRIORITIES) {
    questions[`target_unit_${priority}`] = {
      type: 'choice',
      instructions:
        `What kind of time unit does \`policy_text\` use for the first-response target for priority ${priority}? ` +
        'Choose the principal unit named for that target, rather than converting it.',
      criteria: {
        clock_minutes: 'The target is stated in elapsed calendar minutes.',
        clock_hours: 'The target is stated in elapsed calendar hours, including around-the-clock coverage.',
        clock_days: 'The target is stated in elapsed calendar days.',
        business_hours: 'The target is stated in business hours.',
        business_days: 'The target is stated in business days.',
        not_stated_or_ambiguous: 'No single applicable target unit is stated clearly.',
      },
    };

    for (const unit of UNITS) {
      const readable = unit.replace('_', ' ');
      questions[`target_amount_${priority}_${unit}`] = {
        type: 'choice',
        instructions:
          `What exact positive number does \`policy_text\` state immediately with the ${readable} ` +
          `first-response target for priority ${priority}? Choose "not_stated_or_ambiguous" when that unit is not stated for this priority.`,
        criteria: {
          ...numberOptions,
          not_stated_or_ambiguous: 'That unit and an exact positive number are not clearly stated for this priority.',
        },
      };
    }
  }

  for (const [index] of linesFrom(input).entries()) {
    questions[`opened_line_${index}`] = {
      type: 'noul',
      instructions:
        `Does \`ticket_lines[${index}]\` record that this ticket was opened by the customer or requester? ` +
        'A later update, reply, assignment, or priority change is not an opening event.',
      criteria: {
        true: 'The line records the ticket being opened by the customer or requester.',
        false: 'The line does not record the ticket being opened by the customer or requester.',
      },
    };
    questions[`agent_reply_line_${index}`] = {
      type: 'noul',
      instructions:
        `Does \`ticket_lines[${index}]\` record a reply to this ticket from a support agent? ` +
        'Customer messages, system events, and automatic acknowledgements do not count.',
      criteria: {
        true: 'The line records a support-agent reply.',
        false: 'The line does not record a support-agent reply.',
      },
    };
  }

  for (const date of holidayDatesFrom(input)) {
    questions[`holiday_${date}`] = {
      type: 'noul',
      instructions:
        `Does \`policy_text\` list ${date} as a public holiday excluded from business hours?`,
      criteria: {
        true: `${date} is explicitly an excluded public holiday.`,
        false: `${date} is not explicitly an excluded public holiday.`,
      },
    };
  }

  return questions;
}

function probability(answer, label) {
  return answer?.probabilities?.[label] ?? 0;
}

function noul(answer) {
  return typeof answer === 'number' ? answer : answer?.noul;
}

function selectedChoice(answer) {
  const value = answer?.choice;
  return probability(answer, value) >= ACT_THRESHOLD ? value : null;
}

function parseUtcTimestamp(line) {
  const match = String(line).match(
    /\b(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s*(UTC|Z)\b/i
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '0'] = match;
  const time = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
  const check = new Date(time);
  if (
    check.getUTCFullYear() !== +year ||
    check.getUTCMonth() !== +month - 1 ||
    check.getUTCDate() !== +day ||
    check.getUTCHours() !== +hour ||
    check.getUTCMinutes() !== +minute
  ) return null;
  return time;
}

function businessMinutesBetween(start, end, calendar) {
  let total = 0;
  let cursor = start;

  while (cursor < end) {
    const date = new Date(cursor);
    const dateKey = date.toISOString().slice(0, 10);
    const weekday = date.getUTCDay();
    const isBusinessDay = calendar.businessWeekdays.has(weekday) && !calendar.holidays.has(dateKey);

    if (!isBusinessDay) {
      cursor = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
      continue;
    }

    const open = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      calendar.startHour,
      calendar.startMinute
    );
    const close = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      calendar.endHour,
      calendar.endMinute
    );

    if (cursor < open) {
      cursor = Math.min(open, end);
    } else if (cursor >= close) {
      cursor = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
    } else {
      const next = Math.min(close, end);
      total += Math.floor((next - cursor) / 60000);
      cursor = next;
    }
  }
  return total;
}

export function decide(answers, input) {
  const lines = linesFrom(input);
  const policy = String(input?.policy_text ?? '');

  if (!/\bUTC\b/i.test(policy)) return { breached: 'abstain' };

  const opened = [];
  const replies = [];

  for (const [index, line] of lines.entries()) {
    const timestamp = parseUtcTimestamp(line);
    if (timestamp == null) {
      if ((noul(answers[`opened_line_${index}`]) ?? 0) >= ACT_THRESHOLD ||
          (noul(answers[`agent_reply_line_${index}`]) ?? 0) >= ACT_THRESHOLD) {
        return { breached: 'abstain' };
      }
      continue;
    }

    const openingProbability = noul(answers[`opened_line_${index}`]);
    const replyProbability = noul(answers[`agent_reply_line_${index}`]);
    if (openingProbability == null || replyProbability == null) return { breached: 'abstain' };
    if (openingProbability > REJECT_THRESHOLD && openingProbability < ACT_THRESHOLD) return { breached: 'abstain' };
    if (replyProbability > REJECT_THRESHOLD && replyProbability < ACT_THRESHOLD) return { breached: 'abstain' };
    if (openingProbability >= ACT_THRESHOLD) opened.push(timestamp);
    if (replyProbability >= ACT_THRESHOLD) replies.push(timestamp);
  }

  if (opened.length !== 1 || replies.length === 0) return { breached: 'abstain' };
  const openedAt = opened[0];
  const repliedAt = Math.min(...replies);
  if (repliedAt < openedAt) return { breached: 'abstain' };

  const priority = selectedChoice(answers.opened_priority);
  if (!PRIORITIES.includes(priority)) return { breached: 'abstain' };

  const unit = selectedChoice(answers[`target_unit_${priority}`]);
  if (!UNITS.includes(unit)) return { breached: 'abstain' };

  const amountLabel = selectedChoice(answers[`target_amount_${priority}_${unit}`]);
  const amount = Number(amountLabel);
  if (!Number.isInteger(amount) || amount < 1) return { breached: 'abstain' };

  if (unit === 'clock_minutes') {
    return { breached: repliedAt - openedAt > amount * 60000 ? 'yes' : 'no' };
  }
  if (unit === 'clock_hours') {
    return { breached: repliedAt - openedAt > amount * 3600000 ? 'yes' : 'no' };
  }
  if (unit === 'clock_days') {
    return { breached: repliedAt - openedAt > amount * 86400000 ? 'yes' : 'no' };
  }

  const weekdays = new Set();
  for (const [index, day] of DAYS.entries()) {
    const value = noul(answers[`business_day_${day}`]);
    if (value == null || (value > REJECT_THRESHOLD && value < ACT_THRESHOLD)) {
      return { breached: 'abstain' };
    }
    if (value >= ACT_THRESHOLD) weekdays.add((index + 1) % 7);
  }

  const startHour = Number(selectedChoice(answers.business_start_hour));
  const startMinute = Number(selectedChoice(answers.business_start_minute));
  const endHour = Number(selectedChoice(answers.business_end_hour));
  const endMinute = Number(selectedChoice(answers.business_end_minute));
  if (![startHour, startMinute, endHour, endMinute].every(Number.isInteger)) {
    return { breached: 'abstain' };
  }

  const minutesPerBusinessDay = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
  if (weekdays.size === 0 || minutesPerBusinessDay <= 0) return { breached: 'abstain' };

  const holidays = new Set();
  for (const date of holidayDatesFrom(input)) {
    const value = noul(answers[`holiday_${date}`]);
    if (value == null || (value > REJECT_THRESHOLD && value < ACT_THRESHOLD)) {
      return { breached: 'abstain' };
    }
    if (value >= ACT_THRESHOLD) holidays.add(date);
  }

  const allowedMinutes =
    unit === 'business_hours' ? amount * 60 : amount * minutesPerBusinessDay;
  const elapsed = businessMinutesBetween(openedAt, repliedAt, {
    businessWeekdays: weekdays,
    holidays,
    startHour,
    startMinute,
    endHour,
    endMinute,
  });

  return { breached: elapsed > allowedMinutes ? 'yes' : 'no' };
}
