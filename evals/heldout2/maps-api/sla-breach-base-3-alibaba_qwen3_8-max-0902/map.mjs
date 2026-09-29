export function buildState(input) {
  const i = input || {};
  const policy_text = i.policy_text || "";
  const ticket_log = i.ticket_log || "";

  return {
    policy_text,
    ticket_log,
    prompt: `SLA policy:\n${policy_text}\n\nTicket log:\n${ticket_log}`
  };
}

export function questions(input) {
  return {
    sla: {
      type: "choice",
      instructions:
        "Use state.prompt. Decide whether the first-response SLA was breached. Apply the policy exactly: use the priority when opened, business hours, weekdays, listed holidays, and count only a support-agent reply as first response. Ignore customer messages and automatic acknowledgements. If essential information is missing or ambiguous, choose abstain.",
      criteria: {
        yes: "The first support-agent reply was later than the SLA target, or no reply had arrived by a known deadline that had already passed.",
        no: "The first support-agent reply was at or before the SLA target.",
        abstain: "Cannot decide confidently from the given data."
      }
    },
    complete: {
      type: "choice",
      instructions:
        "Use state.prompt. Decide whether the data is sufficient to determine first-response SLA status.",
      criteria: {
        complete:
          "Opening time, opening priority, and either a first support-agent reply time or a clear reference time for no reply are available.",
        incomplete:
          "An essential fact is missing, ambiguous, or contradictory."
      }
    }
  };
}

export function decide(answers, input) {
  const a = answers || {};
  const sla = a.sla || {};
  const complete = a.complete || {};
  const choice = sla.choice;

  if (complete.choice !== "complete") {
    return { breached: "abstain" };
  }

  if (choice !== "yes" && choice !== "no") {
    return { breached: "abstain" };
  }

  const confidence = Number(sla.confidence || 0);
  const probability = Number((sla.probabilities || {})[choice] || confidence);

  if (Math.max(confidence, probability) < 0.7) {
    return { breached: "abstain" };
  }

  return { breached: choice };
}
