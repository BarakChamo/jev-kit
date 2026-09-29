export function buildState(input) {
  return input;
}

export function questions(input) {
  return {
    q1: {
      type: "choice",
      instructions: "Determine if the first-response SLA was breached based on the policy and ticket log. Consider business hours (09:00-17:00 UTC, Mon-Fri), holidays, and priority. Only support agent replies count as first response.",
      criteria: {
        yes: "SLA was breached",
        no: "SLA was not breached",
        abstain: "Unclear or insufficient information"
      }
    }
  };
}

export function decide(answers, input) {
  const choice = answers?.q1?.choice;
  if (choice === "yes") return { breached: "yes" };
  if (choice === "no") return { breached: "no" };
  return { breached: "abstain" };
}
