// Expense line triage against a free-text travel & expense policy, via Jev.
//
// Currency conversion is done deterministically in buildState (LLMs are
// unreliable at arithmetic); everything that requires reading/interpreting
// the policy text (limits, high-cost cities, banned categories, receipt
// rules, escalation vs. rejection) is left to Jev, since policy_text differs
// per case and can't be hardcoded.

function round2(n) {
  return Math.round(n * 100) / 100;
}

function usdAmount(input) {
  const { fx_to_usd, expense } = input;
  if (!expense || typeof expense.amount !== "number") return null;
  const currency = expense.currency;
  const rate = currency === "USD" ? 1 : fx_to_usd && fx_to_usd[currency];
  if (typeof rate !== "number") return null;
  return round2(expense.amount * rate);
}

export function buildState(input) {
  const { policy_text, fx_to_usd, expense } = input;
  return {
    policy_text,
    fx_to_usd,
    expense,
    amount_usd: usdAmount(input),
  };
}

function context(input) {
  const amount_usd = usdAmount(input);
  const { expense } = input;
  return `Policy:\n${input.policy_text}\n\nExpense line:\n${JSON.stringify(
    expense
  )}\n\nComputed amount in USD (already converted, trust this over doing your own conversion): ${
    amount_usd === null ? "UNKNOWN (currency not in provided FX table)" : amount_usd
  }`;
}

export function questions(input) {
  const ctx = context(input);
  return {
    never_reimbursable: {
      type: "noul",
      instructions: `${ctx}\n\nIs this expense of a category or nature that the policy says is NEVER reimbursable (e.g. alcohol, entertainment, or another explicitly banned item), regardless of amount?`,
      criteria: {
        true: "The policy explicitly bans this category/type of spend outright.",
        false: "The policy does not categorically ban this expense.",
      },
    },
    compliant: {
      type: "noul",
      instructions: `${ctx}\n\nIgnoring any categorical ban, does this expense fully comply with the policy as written: within the applicable per-category/per-city USD limit, and meeting any documentation/receipt requirements (e.g. itemised receipt above a threshold)?`,
      criteria: {
        true: "Within all applicable limits and documentation requirements are met.",
        false: "Exceeds a limit and/or is missing required documentation.",
      },
    },
    needs_manager_approval: {
      type: "noul",
      instructions: `${ctx}\n\nDoes the policy indicate this line should be escalated to manager approval rather than auto-approved or auto-rejected (for example: it exceeds a numeric limit but the policy treats over-limit as 'needs approval, not rejected', or a required receipt is missing and the policy sends that to manager approval)?`,
      criteria: {
        true: "Policy sends this specific situation to manager approval.",
        false: "Policy does not call for manager approval here.",
      },
    },
    insufficient_info: {
      type: "noul",
      instructions: `${ctx}\n\nIs there something about this case that makes it unsafe for an automated system to decide (e.g. the expense currency has no FX rate so USD amount is unknown, the category/city isn't addressed by the policy at all, the expense text is too ambiguous to classify, or the policy text is silent/contradictory on this situation)? Answer true only if a human should look at this instead of an automated decision.`,
      criteria: {
        true: "Missing/ambiguous info or policy silence means a human should review this instead.",
        false: "There is enough clear information and policy coverage to decide automatically.",
      },
    },
  };
}

export function decide(answers, input) {
  const p = (key) => (answers && answers[key] ? answers[key].noul : undefined);

  const amount_usd = usdAmount(input);
  if (amount_usd === null || !input.policy_text || !input.expense) {
    return { decision: "abstain" };
  }

  const insufficient = p("insufficient_info");
  if (typeof insufficient !== "number" || insufficient >= 0.6) {
    return { decision: "abstain" };
  }

  const neverReimbursable = p("never_reimbursable");
  if (typeof neverReimbursable === "number" && neverReimbursable >= 0.5) {
    return { decision: "reject" };
  }

  const needsApproval = p("needs_manager_approval");
  if (typeof needsApproval === "number" && needsApproval >= 0.5) {
    return { decision: "needs_approval" };
  }

  const compliant = p("compliant");
  if (typeof compliant === "number" && compliant >= 0.5) {
    return { decision: "approve" };
  }

  // Ambiguous/conflicting signals with no clear ban or escalation rule:
  // escalate rather than silently approve or reject.
  return { decision: "needs_approval" };
}
