export function buildState(input) {
  return {
    policy_text: input.policy_text,
    ticket_log: input.ticket_log
  };
}

export function questions(input) {
  return {
    sla_evaluation: {
      type: "choice",
      instructions:
        "Evaluate whether the first-response SLA was breached based strictly on the policy (accounting for initial priority, business hours, weekends, excluded holidays, and qualified agent replies) and the ticket log.",
      criteria: {
        breached:
          "The first valid support agent response occurred after the SLA target window had elapsed, or the SLA deadline passed without a valid response.",
        met:
          "The first valid support agent response occurred within the allowable SLA target window.",
        unclear:
          "The timestamps are missing, logs are ambiguous, or the policy does not clearly specify rules for this scenario."
      }
    }
  };
}

export function decide(answers, input) {
  const result = answers?.sla_evaluation;

  if (!result || result.choice === "unclear" || (result.confidence !== undefined && result.confidence < 0.8)) {
    return { breached: "abstain" };
  }

  if (result.choice === "breached") {
    return { breached: "yes" };
  }

  if (result.choice === "met") {
    return { breached: "no" };
  }

  return { breached: "abstain" };
}
