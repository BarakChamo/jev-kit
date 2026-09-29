export function buildState(input) {
  return {
    policy_text: input.policy_text,
    ticket_log: input.ticket_log
  };
}

export function questions(input) {
  return {
    sla_status: {
      type: "choice",
      instructions:
        "Determine whether the first-response SLA was breached based on the provided policy (evaluating priorities at open time, business hours, holidays, and qualifying agent replies).",
      criteria: {
        breached:
          "The first valid agent response occurred after the SLA target expired, or the deadline has elapsed without any agent response.",
        not_breached:
          "A valid agent first response was provided within the allowed SLA timeframe.",
        uncertain:
          "The ticket log or policy is ambiguous, timestamps are contradictory or incomplete, or the case requires human judgment."
      }
    }
  };
}

export function decide(answers, input) {
  const res = answers?.sla_status;
  if (!res || typeof res.confidence !== "number" || res.confidence < 0.75) {
    return { breached: "abstain" };
  }

  if (res.choice === "breached") {
    return { breached: "yes" };
  }
  if (res.choice === "not_breached") {
    return { breached: "no" };
  }

  return { breached: "abstain" };
}
