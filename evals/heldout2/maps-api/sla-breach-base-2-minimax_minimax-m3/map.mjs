export function buildState(input) {
  return {
    policy_text: String(input?.policy_text ?? ""),
    ticket_log: String(input?.ticket_log ?? "")
  };
}

export function questions(_input) {
  return {
    priority: {
      type: "choice",
      instructions: "From the ticket log, identify the priority the ticket had at the moment it was opened by the customer. The policy states the priority at opening applies, even if later changed.",
      criteria: {
        "Urgent": "Ticket opened with Urgent priority.",
        "High": "Ticket opened with High priority.",
        "Normal": "Ticket opened with Normal priority.",
        "Low": "Ticket opened with Low priority."
      }
    },
    breached: {
      type: "noul",
      instructions: "Apply the SLA policy to this ticket. The opening priority sets the first-response target: Urgent = 1 hour around the clock (all days/hours); High = 4 business hours; Normal/Low = 2 business days (16 business hours). Business hours are 09:00-17:00 UTC, Monday-Friday, excluding any public holidays explicitly listed in the policy. Only replies from a human support agent count as the first response; customer messages and automatic acknowledgements do not. Determine whether the first agent reply landed within the target window measured from ticket opening. If no agent reply occurred, the SLA is breached.",
      criteria: {
        "true": "The first-response SLA was breached (no agent reply within the target window, or no agent reply at all).",
        "false": "The first-response SLA was met (an agent reply arrived within the target window)."
      }
    }
  };
}

export function decide(answers, _input) {
  const p = answers && answers.priority;
  const b = answers && answers.breached;
  if (!p || typeof p.choice !== "string") return { breached: "abstain" };
  if (!["Urgent", "High", "Normal", "Low"].includes(p.choice)) return { breached: "abstain" };
  if (typeof p.confidence === "number" && p.confidence < 0.55) return { breached: "abstain" };
  if (!b || typeof b.noul !== "number") return { breached: "abstain" };
  if (b.noul > 0.25 && b.noul < 0.75) return { breached: "abstain" };
  return { breached: b.noul >= 0.5 ? "yes" : "no" };
}
