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
  return { ...d, day: newDays, hours: newHoursInDay, minutes: newMinutes };
}

function businessMinutesBetween(start, end) {
  let current = { ...start };
  let total = 0;
  while (
    current.year < end.year ||
    current.month < end.month ||
    current.day < end.day ||
    current.hours < end.hours ||
    current.minutes < end.minutes
  ) {
    if (isBusinessDay(current) && isBusinessHour(current)) {
      const nextMinute = addMinutes(current, 1);
      if (isBusinessDay(nextMinute) && isBusinessHour(nextMinute)) {
        total++;
        current = nextMinute;
      } else {
        current = { ...nextMinute, hours: 9, minutes: 0 };
        if (!isBusinessDay(current)) {
          current.day++;
          current.dayOfWeek = (current.dayOfWeek % 7) + 1;
        }
      }
    } else {
      current.day++;
      current.dayOfWeek = (current.dayOfWeek % 7) + 1;
      current.hours = 9;
      current.minutes = 0;
    }
  }
  return total;
}

function getDayOfWeek(date) {
  const d = new Date(date.year, date.month - 1, date.day);
  return d.getDay() === 0 ? 7 : d.getDay();
}

export function buildState(input) {
  const openedMatch = input.ticket_log.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC) .* ticket opened/);
  const repliedMatch = input.ticket_log.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC) .* first reply from support agent/);
  const priorityMatch = input.ticket_log.match(/priority (\w+)/);

  const opened = parseDateTime(openedMatch[1]);
  opened.dayOfWeek = getDayOfWeek(opened);

  const replied = parseDateTime(repliedMatch[1]);
  replied.dayOfWeek = getDayOfWeek(replied);

  const priority = priorityMatch[1];

  return {
    policy_text: input.policy_text,
    opened_date: openedMatch[1],
    replied_date: repliedMatch[1],
    priority,
    opened_year: opened.year,
    opened_month: opened.month,
    opened_day: opened.day,
    opened_hour: opened.hours,
    opened_minute: opened.minutes,
    replied_year: replied.year,
    replied_month: replied.month,
    replied_day: replied.day,
    replied_hour: replied.hours,
    replied_minute: replied.minutes,
  };
}

export function questions() {
  return {
    urgent_target: {
      type: 'choice',
      instructions: 'How many hours is the first-response target for Urgent priority in `policy_text`?',
      criteria: {
        '1': '1 hour',
        '4': '4 hours',
        '16': '16 hours',
        '32': '32 hours',
      },
    },
    high_target: {
      type: 'choice',
      instructions: 'How many business hours is the first-response target for High priority in `policy_text`?',
      criteria: {
        '1': '1 business hour',
        '4': '4 business hours',
        '16': '16 business hours',
        '32': '32 business hours',
      },
    },
    normal_low_target: {
      type: 'choice',
      instructions: 'How many business hours is the first-response target for Normal and Low priority in `policy_text`?',
      criteria: {
        '1': '1 business hour',
        '4': '4 business hours',
        '16': '16 business hours',
        '32': '32 business hours',
      },
    },
    business_hours_start: {
      type: 'choice',
      instructions: 'At what UTC hour do business hours start in `policy_text`?',
      criteria: {
        '8': '08:00',
        '9': '09:00',
        '10': '10:00',
      },
    },
    business_hours_end: {
      type: 'choice',
      instructions: 'At what UTC hour do business hours end in `policy_text`?',
      criteria: {
        '16': '16:00',
        '17': '17:00',
        '18': '18:00',
      },
    },
    business_days: {
      type: 'choice',
      instructions: 'Which days are business days in `policy_text`?',
      criteria: {
        'mon_fri': 'Monday to Friday',
        'mon_sat': 'Monday to Saturday',
        'all': 'All days',
      },
    },
    is_24x7: {
      type: 'noul',
      instructions: 'Does `policy_text` state that Urgent priority first-response is around the clock (all days, all hours)?',
      criteria: {
        true: 'Urgent is 24x7',
        false: 'Urgent is not 24x7',
      },
    },
    opened_is_business_day: {
      type: 'noul',
      instructions: 'Is the date in `opened_year`, `opened_month`, `opened_day` a business day according to `policy_text` (considering holidays)?',
      criteria: {
        true: 'opened date is a business day',
        false: 'opened date is not a business day',
      },
    },
    opened_is_business_hour: {
      type: 'noul',
      instructions: 'Is the time `opened_hour`:`opened_minute` within business hours according to `policy_text`?',
      criteria: {
        true: 'opened time is within business hours',
        false: 'opened time is not within business hours',
      },
    },
    replied_is_business_day: {
      type: 'noul',
      instructions: 'Is the date in `replied_year`, `replied_month`, `replied_day` a business day according to `policy_text` (considering holidays)?',
      criteria: {
        true: 'replied date is a business day',
        false: 'replied date is not a business day',
      },
    },
    replied_is_business_hour: {
      type: 'noul',
      instructions: 'Is the time `replied_hour`:`replied_minute` within business hours according to `policy_text`?',
      criteria: {
        true: 'replied time is within business hours',
        false: 'replied time is not within business hours',
      },
    },
  };
}

export function decide(answers, input) {
  const a = answers;
  const p = a.urgent_target.probabilities[a.urgent_target.choice] ?? 0;
  const urgentTarget = p >= 0.8 ? Number(a.urgent_target.choice) : null;
  const highTarget = a.high_target.probabilities[a.high_target.choice] >= 0.8 ? Number(a.high_target.choice) : null;
  const normalLowTarget = a.normal_low_target.probabilities[a.normal_low_target.choice] >= 0.8 ? Number(a.normal_low_target.choice) : null;
  const is24x7 = a.is_24x7.noul >= 0.8 ? a.is_24x7.noul > 0.5 : null;

  if (urgentTarget === null || highTarget === null || normalLowTarget === null || is24x7 === null) {
    return { breached: 'abstain' };
  }

  const opened = parseDateTime(input.ticket_log.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC)/)[1]);
  opened.dayOfWeek = getDayOfWeek(opened);
  const replied = parseDateTime(input.ticket_log.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC)/, input.ticket_log.lastIndexOf('first reply'))[1]);
  replied.dayOfWeek = getDayOfWeek(replied);

  const priority = input.ticket_log.match(/priority (\w+)/)[1];

  let targetHours;
  if (priority === 'Urgent') {
    targetHours = is24x7 ? urgentTarget : null;
  } else if (priority === 'High') {
    targetHours = highTarget;
  } else {
    targetHours = normalLowTarget;
  }

  if (targetHours === null) {
    return { breached: 'abstain' };
  }

  let elapsedBusinessMinutes;
  if (priority === 'Urgent' && is24x7) {
    const totalMinutes = (replied.year - opened.year) * 365 * 24 * 60 +
                         (replied.month - opened.month) * 30 * 24 * 60 +
                         (replied.day - opened.day) * 24 * 60 +
                         (replied.hours - opened.hours) * 60 +
                         (replied.minutes - opened.minutes);
    elapsedBusinessMinutes = totalMinutes;
  } else {
    elapsedBusinessMinutes = businessMinutesBetween(opened, replied);
  }

  const targetMinutes = targetHours * 60;
  const breached = elapsedBusinessMinutes > targetMinutes;

  const openedBusinessDayProb = a.opened_is_business_day.probabilities[a.opened_is_business_day.noul > 0.5 ? 'true' : 'false'] ?? 0;
  const openedBusinessHourProb = a.opened_is_business_hour.probabilities[a.opened_is_business_hour.noul > 0.5 ? 'true' : 'false'] ?? 0;
  const repliedBusinessDayProb = a.replied_is_business_day.probabilities[a.replied_is_business_day.noul > 0.5 ? 'true' : 'false'] ?? 0;
  const repliedBusinessHourProb = a.replied_is_business_hour.probabilities[a.replied_is_business_hour.noul > 0.5 ? 'true' : 'false'] ?? 0;

  const minProb = Math.min(openedBusinessDayProb, openedBusinessHourProb, repliedBusinessDayProb, repliedBusinessHourProb);
  if (minProb < 0.8) {
    return { breached: 'abstain' };
  }

  return { breached: breached ? 'yes' : 'no' };
}
