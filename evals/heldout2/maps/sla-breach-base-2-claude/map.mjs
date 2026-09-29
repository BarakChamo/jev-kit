// map.mjs — SLA first-response breach checker built on Jev.

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    ticket_log: input.ticket_log,
  };
}

export function questions(_input) {
  return {
    breach: {
      type: "noul",
      instructions:
        "The state contains policy_text (the written first-response SLA policy) and ticket_log " +
        "(a timestamped log of ticket events). Determine whether the first-response SLA was breached.\n" +
        "Steps to follow: (1) Find the ticket's priority at the moment it was OPENED — a later priority " +
        "change does not change which SLA target applies. (2) Find the applicable first-response target " +
        "for that priority from policy_text (a fixed duration, or a number of business hours/days). " +
        "(3) Find the first reply that came from a support AGENT — ignore customer messages and automatic " +
        "acknowledgements. (4) If the target is stated in business hours/days, count elapsed time using " +
        "only the business hours, weekdays, and holiday exclusions defined in policy_text (skip weekends " +
        "and any listed public holidays entirely); if the target is a plain wall-clock duration (e.g. " +
        "'around the clock' / 'within 1 hour'), count real elapsed time instead. (5) Compare the elapsed " +
        "time from ticket open to the first agent reply against the target.",
      criteria: {
        true: "The elapsed time from ticket open to the first support-agent reply, measured per the " +
          "policy's rules, exceeds the applicable first-response target — the SLA was breached.",
        false: "The first support-agent reply arrived at or before the applicable first-response target, " +
          "or there is no clear breach — the SLA was met.",
      },
    },
    ambiguous: {
      type: "noul",
      instructions:
        "Using the same policy_text and ticket_log in the state, judge whether this case is too unclear " +
        "or underspecified to confidently score as breached/not-breached without a human reviewing it. " +
        "Examples of what makes a case ambiguous: the ticket's opening priority is not stated or is unclear; " +
        "no reply is clearly identifiable as coming from a support agent (vs. a customer or an automated " +
        "message); timestamps are missing, malformed, or have unresolvable timezone/ordering issues; the " +
        "policy's business-hours, weekday, or holiday rules are missing or self-contradictory; or the reply " +
        "in question arrives so close to the deadline that rounding/interpretation could flip the outcome.",
      criteria: {
        true: "The case has a genuine ambiguity of the kind described above that should be escalated to a " +
          "human rather than decided automatically.",
        false: "The policy, priority, and relevant timestamps are all clear enough to compute the breach " +
          "determination with confidence.",
      },
    },
  };
}

export function decide(answers, _input) {
  const ambiguous = answers?.ambiguous?.noul;
  const breach = answers?.breach?.noul;

  if (typeof ambiguous !== "number" || typeof breach !== "number") {
    return { breached: "abstain" };
  }
  if (ambiguous >= 0.55) {
    return { breached: "abstain" };
  }
  if (breach >= 0.7) {
    return { breached: "yes" };
  }
  if (breach <= 0.3) {
    return { breached: "no" };
  }
  return { breached: "abstain" };
}
