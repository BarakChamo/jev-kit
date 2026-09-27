// map.mjs — Jev mapping for expense-line policy review.

const CONFIDENCE_FLOOR = 0.6; // below this, send to a human instead of guessing
const AMBIGUOUS_CEILING = 0.5; // above this "ambiguous" probability, abstain

export function buildState(input) {
  const { policy_text, fx_to_usd, expense } = input;
  const rate = fx_to_usd && fx_to_usd[expense.currency];
  const amount_usd = typeof rate === "number" ? round2(expense.amount * rate) : null;

  return {
    policy_text,
    expense: {
      ...expense,
      amount_usd,
      fx_rate_used: rate ?? null,
    },
  };
}

export function questions(input) {
  return {
    classification: {
      type: "choice",
      instructions:
        "state.policy_text is the company's travel & expense policy. state.expense is one expense line; " +
        "state.expense.amount_usd is the line amount already converted to USD (use it, not the raw amount/currency, " +
        "for any limit comparison). Apply the policy exactly as written to this line: category limits, high-cost-city " +
        "limits, receipt requirements, and any categories that are never reimbursable. 'reject' applies only when the " +
        "policy explicitly bars reimbursement outright for this kind of expense (e.g. a listed never-reimbursable " +
        "category, or a clear non-business/personal expense), not merely because it exceeds a numeric limit. Exceeding " +
        "a limit, or missing a receipt where one is required, is 'needs_approval' unless the policy says such a case " +
        "is rejected. If the line fully complies with every applicable limit and requirement, it is 'approve'.",
      criteria: {
        approve: "Fully within all applicable policy limits and requirements; no manager sign-off needed.",
        needs_approval:
          "Exceeds a limit, is missing a required receipt, or otherwise needs manager sign-off per policy, but is not a category the policy bars outright.",
        reject:
          "The policy explicitly disallows reimbursement for this outright (e.g. a listed never-reimbursable category, or clearly non-business/personal), regardless of amount.",
      },
    },
    ambiguous: {
      type: "noul",
      instructions:
        "Look at state.policy_text and state.expense together. Is there missing or contradictory information that " +
        "would make it unsafe for an automated system to decide this expense line without a human reviewing it? " +
        "Examples: the city's cost tier (standard vs high-cost) isn't determinable from the policy, the expense " +
        "category doesn't clearly match any policy category, the description contradicts the category, or " +
        "amount_usd is missing/null because no FX rate was available.",
      criteria: {
        true: "There is a real gap or contradiction that makes confident automated decisioning unsafe.",
        false: "The policy and expense data are clear enough to decide automatically.",
      },
    },
  };
}

export function decide(answers, input) {
  const expense = input.expense;
  const rate = input.fx_to_usd && input.fx_to_usd[expense.currency];
  if (typeof rate !== "number") {
    return { decision: "abstain" };
  }

  const ambiguous = answers.ambiguous;
  if (ambiguous && typeof ambiguous.noul === "number" && ambiguous.noul > AMBIGUOUS_CEILING) {
    return { decision: "abstain" };
  }

  const cls = answers.classification;
  if (!cls || typeof cls.choice !== "string") {
    return { decision: "abstain" };
  }
  if (typeof cls.confidence === "number" && cls.confidence < CONFIDENCE_FLOOR) {
    return { decision: "abstain" };
  }

  if (cls.choice === "approve" || cls.choice === "needs_approval" || cls.choice === "reject") {
    return { decision: cls.choice };
  }

  return { decision: "abstain" };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
