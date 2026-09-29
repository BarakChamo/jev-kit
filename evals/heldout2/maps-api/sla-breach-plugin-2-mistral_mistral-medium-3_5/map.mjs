const HOLIDAYS = new Set(['2026-01-01', '2026-04-03', '2026-05-25', '2026-12-25']);

function parseDateTime(s) {
  const [datePart, timePart] = s.split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hours, minutes] = timePart.split(':').map(Number);
  return { year, month, day, hours, minutes };
}

function isBusinessDay(d) {
  const dateStr = `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
  if (HOLIDAYS.has(dateStr)) return false;
  return d.dayOfWeek >= 1 && d.dayOfWeek <= 5;
}

function isBusinessHour(d) {
  return d.hours >= 9 && d.hours < 17;
}

function addMinutes(d, mins) {
  const total = d.minutes + mins;
  const newHours = d.hours + Math.floor(total / 60);
  const newMinutes = total % 60;
  const newDays = d.day + Math.floor(newHours / 24);
  const newHoursInDay = newHours % 24;
  return { year: d.year, month: d.month, day: newDays, hours: newHoursInDay, minutes: newMinutes };
}

function businessMinutesBetween(start, end) {
  let current = { ...start };
  let total = 0;
  while (current.year < end.year || current.month < end.month || current.day < end.day || current.hours < end.hours || current.minutes < end.minutes) {
    if (isBusinessDay(current) && isBusinessHour(current)) {
      const nextMinute = addMinutes(current, 1);
      if (isBusinessDay(nextMinute) && isBusinessHour(nextMinute)) {
        total++;
      } else {
        const nextHour = addMinutes(current, 60 - current.minutes);
        if (isBusinessDay(nextHour) && isBusinessHour(nextHour)) {
          total += 60 - current.minutes;
          current = nextHour;
          continue;
        }
        const nextBusinessStart = { ...nextHour };
        while (!isBusinessDay(nextBusinessStart) || !isBusinessHour(nextBusinessStart)) {
          nextBusinessStart.day++;
          const date = new Date(nextBusinessStart.year, nextBusinessStart.month - 1, nextBusinessStart.day);
          nextBusinessStart.dayOfWeek = date.getUTCDay();
        }
        nextBusinessStart.hours = 9;
        nextBusinessStart.minutes = 0;
        current = nextBusinessStart;
        continue;
      }
    } else {
      const nextDay = { ...current, day: current.day + 1 };
      const date = new Date(nextDay.year, nextDay.month - 1, nextDay.day);
      nextDay.dayOfWeek = date.getUTCDay();
      current = nextDay;
      current.hours = 9;
      current.minutes = 0;
      continue;
    }
    current = addMinutes(current, 1);
  }
  return total;
}

function getDayOfWeek(date) {
  const d = new Date(date.year, date.month - 1, date.day);
  return d.getUTCDay();
}

export function buildState(input) {
  const lines = input.ticket_log.split('\n');
  const openLine = lines.find(l => l.includes('ticket opened'));
  const replyLine = lines.find(l => l.includes('first reply from support agent'));

  const openMatch = openLine.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/);
  const replyMatch = replyLine.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/);
  const priorityMatch = openLine.match(/priority (\w+)/);

  const openedAt = parseDateTime(openMatch[1]);
  openedAt.dayOfWeek = getDayOfWeek(openedAt);

  const repliedAt = parseDateTime(replyMatch[1]);
  repliedAt.dayOfWeek = getDayOfWeek(repliedAt);

  const priority = priorityMatch[1];

  return {
    policy_text: input.policy_text,
    opened_at: openMatch[1],
    replied_at: replyMatch[1],
    priority_at_opening: priority,
    is_first_reply_from_agent: replyLine.includes('first reply from support agent'),
    business_hours: "09:00 to 17:00 UTC",
    business_days: "Monday to Friday",
    holidays: Array.from(HOLIDAYS).join(', '),
    urgent_target: "within 1 hour, around the clock",
    high_target: "within 4 business hours",
    normal_low_target: "within 2 business days (16 business hours)"
  };
}

export function questions(input) {
  return {
    priority: {
      type: 'choice',
      instructions: 'What is the priority stated in `priority_at_opening` for the ticket?',
      criteria: {
        Urgent: 'Urgent',
        High: 'High',
        Normal: 'Normal',
        Low: 'Low'
      }
    },
    opened_year: {
      type: 'choice',
      instructions: 'In which year is the `opened_at` timestamp?',
      criteria: { '2026': null }
    },
    opened_month: {
      type: 'choice',
      instructions: 'In which month is the `opened_at` timestamp?',
      criteria: { January: null, February: null, March: null, April: null, May: null, June: null, July: null, August: null, September: null, October: null, November: null, December: null }
    },
    opened_day: {
      type: 'choice',
      instructions: 'On which day of the month is the `opened_at` timestamp?',
      criteria: Object.fromEntries(Array.from({ length: 31 }, (_, i) => [String(i + 1), null]))
    },
    opened_hour: {
      type: 'choice',
      instructions: 'At which hour (00-23) is the `opened_at` timestamp?',
      criteria: Object.fromEntries(Array.from({ length: 24 }, (_, i) => [String(i).padStart(2, '0'), null]))
    },
    opened_minute: {
      type: 'choice',
      instructions: 'At which minute (00-59) is the `opened_at` timestamp?',
      criteria: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [String(i).padStart(2, '0'), null]))
    },
    replied_year: {
      type: 'choice',
      instructions: 'In which year is the `replied_at` timestamp?',
      criteria: { '2026': null }
    },
    replied_month: {
      type: 'choice',
      instructions: 'In which month is the `replied_at` timestamp?',
      criteria: { January: null, February: null, March: null, April: null, May: null, June: null, July: null, August: null, September: null, October: null, November: null, December: null }
    },
    replied_day: {
      type: 'choice',
      instructions: 'On which day of the month is the `replied_at` timestamp?',
      criteria: Object.fromEntries(Array.from({ length: 31 }, (_, i) => [String(i + 1), null]))
    },
    replied_hour: {
      type: 'choice',
      instructions: 'At which hour (00-23) is the `replied_at` timestamp?',
      criteria: Object.fromEntries(Array.from({ length: 24 }, (_, i) => [String(i).padStart(2, '0'), null]))
    },
    replied_minute: {
      type: 'choice',
      instructions: 'At which minute (00-59) is the `replied_at` timestamp?',
      criteria: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [String(i).padStart(2, '0'), null]))
    },
    is_first_reply_agent: {
      type: 'noul',
      instructions: 'Does `is_first_reply_from_agent` indicate that the first reply was from a support agent?',
      criteria: { true: 'yes, it was from a support agent', false: 'no, it was not from a support agent' }
    }
  };
}

export function decide(answers, input) {
  const monthMap = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };

  const openedAt = {
    year: parseInt(answers.opened_year.choice),
    month: monthMap[answers.opened_month.choice],
    day: parseInt(answers.opened_day.choice),
    hours: parseInt(answers.opened_hour.choice),
    minutes: parseInt(answers.opened_minute.choice)
  };
  openedAt.dayOfWeek = getDayOfWeek(openedAt);

  const repliedAt = {
    year: parseInt(answers.replied_year.choice),
    month: monthMap[answers.replied_month.choice],
    day: parseInt(answers.replied_day.choice),
    hours: parseInt(answers.replied_hour.choice),
    minutes: parseInt(answers.replied_minute.choice)
  };
  repliedAt.dayOfWeek = getDayOfWeek(repliedAt);

  const priority = answers.priority.choice;
  const isAgentReply = answers.is_first_reply_agent.noul > 0.5;

  if (!isAgentReply) return { breached: 'abstain' };

  const elapsedBusinessMinutes = businessMinutesBetween(openedAt, repliedAt);

  let targetMinutes;
  switch (priority) {
    case 'Urgent': targetMinutes = 60; break;
    case 'High': targetMinutes = 4 * 60; break;
    case 'Normal':
    case 'Low': targetMinutes = 16 * 60; break;
    default: return { breached: 'abstain' };
  }

  const pPriority = answers.priority.probabilities[priority] ?? 0;
  const pOpened = Object.values(answers).filter(k => k.choice && k.probabilities?.[k.choice] !== undefined && ['opened_year', 'opened_month', 'opened_day', 'opened_hour', 'opened_minute'].includes(k.id)).reduce((sum, k) => sum + (k.probabilities[k.choice] ?? 0), 0) / 5;
  const pReplied = Object.values(answers).filter(k => k.choice && k.probabilities?.[k.choice] !== undefined && ['replied_year', 'replied_month', 'replied_day', 'replied_hour', 'replied_minute'].includes(k.id)).reduce((sum, k) => sum + (k.probabilities[k.choice] ?? 0), 0) / 5;
  const pAgent = answers.is_first_reply_agent.noul > 0.5 ? answers.is_first_reply_agent.noul : (1 - answers.is_first_reply_agent.noul);

  const avgConfidence = (pPriority + pOpened + pReplied + pAgent) / 4;

  if (avgConfidence < 0.8) return { breached: 'abstain' };

  return { breached: elapsedBusinessMinutes > targetMinutes ? 'yes' : 'no' };
}
