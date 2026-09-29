// map.mjs — first-response SLA breach check (decision support desk).

export function buildState(input) {
  // Pass the policy and the raw ticket log straight through. Jev will read
  // the SLA rules directly from the policy text.
  return {
    policy_text: input.policy_text,
    ticket_log: input.ticket_log
  };
}

export function questions(input) {
  return {
    priority_at_open: {
      type: "choice",
      instructions:
        "From the ticket log in 'state.ticket_log', identify the priority that was assigned to the ticket AT THE MOMENT IT WAS OPENED. Per the SLA policy in 'state.policy_text', this original priority governs the SLA even if the priority is later changed.",
      criteria: {
        "Urgent": "Priority was Urgent when the ticket was opened (around-the-clock 1-hour target).",
        "High":   "Priority was High when the ticket was opened (4 business hours target).",
        "Normal": "Priority was Normal when the ticket was opened (16 business hours / 2 business days target).",
        "Low":    "Priority was Low when the ticket was opened (16 business hours / 2 business days target).",
        "Unclear": "The priority at opening cannot be determined from the log."
      }
    },

    sla_breached: {
      type: "noul",
      instructions:
        "Determine whether the first-response SLA was breached for this ticket. Procedure: (1) Use the ticket's priority AT OPENING TIME — this is what applies even if later changed. (2) Identify the FIRST QUALIFYING reply from a support agent in the log. Per policy, customer messages and automatic acknowledgements do NOT count as first response. (3) Compute the SLA deadline from the opening timestamp: Urgent = 1 hour after opening, around the clock; High = 4 business hours after opening; Normal or Low = 16 business hours (2 business days) after opening. Business hours are 09:00 to 17:00 UTC, Monday through Friday, excluding the public holidays listed in the policy. (4) Compare the first qualifying agent reply against the deadline. Answer TRUE if the deadline was exceeded or no qualifying agent reply ever occurred; FALSE if the first agent reply arrived within the deadline.",
      criteria: {
        "true":
          "The first-response SLA was breached — the first support agent reply arrived after the deadline, or no qualifying support agent reply ever occurred in the log.",
        "false":
          "The first-response SLA was NOT breached — the first support agent reply arrived within (or before) the deadline."
      }
    }
  };
}

export function decide(answers, input) {
  // If we can't pin the opening priority from the log, we can't evaluate
  // the SLA target — route it to a human.
  const priorityChoice =
    answers && answers.priority_at_open && answers.priority_at_open.choice;
  if (priorityChoice === "Unclear") return { breached: "abstain" };

  const sla = answers && answers.sla_breached;
  if (!sla || typeof sla.noul !== "number") return { breached: "abstain" };

  // 'noul' is the model's probability that the criteria for "true" hold,
  // i.e. the probability that the SLA was breached.
  const pBreach = sla.noul;

  // Strong evidence → decide. Otherwise → abstain for human review.
  if (pBreach >= 0.7) return { breached: "yes" };
  if (pBreach <= 0.3) return { breached: "no" };
  return { breached: "abstain" };
}
