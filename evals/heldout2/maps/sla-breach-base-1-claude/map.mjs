// map.mjs — SLA first-response breach checker built on Jev.

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    ticket_log: input.ticket_log,
  };
}

export function questions(input) {
  return {
    breach: {
      type: "choice",
      instructions: `State contains policy_text (the written first-response SLA policy: priority targets, business-hours window, and holiday exclusions) and ticket_log (a chronological log of when the ticket was opened, its priority at that time, and every message with its timestamp and source).

Determine whether the FIRST reply from a support AGENT (never a customer message, never an automatic/system acknowledgement) arrived within the first-response target that the policy assigns to the ticket's priority AT THE TIME IT WAS OPENED, even if the priority was changed afterward.

How to compute elapsed time:
- If the target is stated in business hours/days, count only time inside the policy's business-hours window on business days, excluding the listed public holidays. Time outside that window/those days does not count.
- If the target applies "around the clock" or is otherwise calendar-based, count real elapsed wall-clock time instead.
- Use the priority recorded at ticket opening, not any later priority change.

Decision:
- "no" if the elapsed qualifying time from opening to the first qualifying agent reply is within (<=) the applicable target.
- "yes" if it exceeds the applicable target.
- "abstain" if this cannot be reliably determined: e.g. no agent reply is present in the log, the opening time or opening priority is missing/unclear, the policy's business-hours/holiday rules are missing or self-contradictory, timestamps are malformed, or genuine ambiguity remains about which message counts as the first agent response.`,
      criteria: {
        yes: "The elapsed qualifying time to the first support-agent reply exceeds the applicable SLA target: the SLA was breached.",
        no: "The elapsed qualifying time to the first support-agent reply is within the applicable SLA target: the SLA was not breached.",
        abstain: "The case cannot be reliably decided from the given policy and log (missing first response, missing/ambiguous priority or timestamps, unclear or conflicting policy terms, or another genuine ambiguity): this should go to a human.",
      },
    },
    confident: {
      type: "noul",
      instructions: `Using only the policy_text and ticket_log in state: is the breach determination for this ticket clear-cut and unambiguous? That means the ticket's opening priority, opening timestamp, the applicable business-hours/holiday calendar, and the timestamp of the first qualifying support-agent reply are all clearly and consistently stated, with no missing data, contradictions, or judgment calls required.`,
      criteria: {
        true: "Every fact needed for the decision is clearly and unambiguously stated; a careful human reviewer would reach the same conclusion without hesitation.",
        false: "Some needed fact is missing, ambiguous, contradictory, or requires a judgment call that could reasonably go either way.",
      },
    },
  };
}

export function decide(answers, input) {
  const breach = answers?.breach;
  const confident = answers?.confident;

  if (!breach || breach.type !== "choice" || !breach.choice) {
    return { breached: "abstain" };
  }

  if (breach.choice === "abstain") {
    return { breached: "abstain" };
  }

  const CONFIDENCE_FLOOR = 0.55;
  const choiceConfidence = typeof breach.confidence === "number" ? breach.confidence : 1;
  const factsClearProb = confident && confident.type === "noul" && typeof confident.noul === "number"
    ? confident.noul
    : 1;

  if (choiceConfidence < CONFIDENCE_FLOOR || factsClearProb < CONFIDENCE_FLOOR) {
    return { breached: "abstain" };
  }

  if (breach.choice === "yes" || breach.choice === "no") {
    return { breached: breach.choice };
  }

  return { breached: "abstain" };
}
