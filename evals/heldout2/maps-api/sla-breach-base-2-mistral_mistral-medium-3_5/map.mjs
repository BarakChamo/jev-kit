export function buildState(input) {
  return input;
}

export function questions(input) {
  return {
    q1: {
      type: "noul",
      instructions: "Determine if the first-response SLA was breached based on the policy and ticket log. Consider business hours (09:00-17:00 UTC, Mon-Fri), holidays (2026-01-01, 2026-04-03, 2026-05-25, 2026-12-25), and priority-specific targets (Urgent: 1h always, High: 4 business hours, Normal/Low: 16 business hours). Only agent replies count as first response.",
      criteria: {
        true: "SLA was breached",
        false: "SLA was not breached"
      }
    }
  };
}

export function decide(answers, input) {
  if (!answers.q1 || typeof answers.q1.noul !== 'number') return { breached: "abstain" };
  const breached = answers.q1.noul > 0.5 ? "yes" : "no";
  return { breached };
}
