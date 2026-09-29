// map.mjs — first-response SLA breach check, built on Jev (TypeSafe System One).

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    ticket_log: input.ticket_log,
    task:
      "Decide whether the first-response SLA described in policy_text was breached for the ticket " +
      "whose history is in ticket_log. Apply the written targets, business hours, public holidays, " +
      "and the priority the ticket had when it was opened. Only a reply from a support agent counts " +
      "as a first response; customer messages and automatic acknowledgements do not."
  };
}

export function questions(input) {
  return {
    open_clear: {
      type: "noul",
      instructions:
        "From ticket_log, is it clear and unambiguous when the ticket was opened (date, time, timezone) " +
        "and what priority it had at that moment?",
      criteria: {
        true:
          "The log states the opening timestamp and the priority at opening clearly enough to apply policy_text.",
        false:
          "The opening time or the priority at opening is missing, contradictory, or too ambiguous to apply the policy."
      }
    },
    first_reply_clear: {
      type: "noul",
      instructions:
        "From ticket_log and policy_text, is exactly one message identifiable as the first response " +
        "(a reply from a support agent, not a customer message and not an automatic acknowledgement), " +
        "with a clear timestamp?",
      criteria: {
        true: "There is a clear first qualifying agent reply with a knowable timestamp.",
        false: "There is no agent reply, several indistinguishable candidates, an unclear sender, or unclear timing."
      }
    },
    priority_at_open: {
      type: "choice",
      instructions: "What priority did the ticket have at the moment it was opened, per ticket_log?",
      criteria: {
        urgent: "The ticket was opened with Urgent priority.",
        high: "The ticket was opened with High priority.",
        normal: "The ticket was opened with Normal priority.",
        low: "The ticket was opened with Low priority.",
        unknown: "The priority at opening cannot be determined from the log."
      }
    },
    breach: {
      type: "noul",
      instructions:
        "Using policy_text (first-response targets by priority, business hours, excluded public holidays) " +
        "and ticket_log: was the first qualifying agent response received strictly after the applicable " +
        "SLA deadline for the ticket's priority at opening? Account correctly for business hours, weekends, " +
        "and holidays (e.g. Urgent runs around the clock; other targets only count business hours). " +
        "Ignore any priority changes made after the ticket was opened.",
      criteria: {
        true:
          "The first qualifying agent reply came after the applicable deadline, computed correctly over " +
          "business hours and holidays.",
        false:
          "The first qualifying agent reply came on or before the applicable deadline, so the SLA was met."
      }
    }
  };
}

export function decide(answers, input) {
  const openClear = answers?.open_clear?.noul;
  const replyClear = answers?.first_reply_clear?.noul;
  const priority = answers?.priority_at_open?.choice;
  const pBreach = answers?.breach?.noul;

  if (pBreach === undefined || priority === undefined) return { breached: "abstain" };
  if (priority === "unknown") return { breached: "abstain" };
  if ((openClear ?? 0) < 0.5 || (replyClear ?? 0) < 0.5) return { breached: "abstain" };

  if (pBreach >= 0.75) return { breached: "yes" };
  if (pBreach <= 0.25) return { breached: "no" };
  return { breached: "abstain" };
}
