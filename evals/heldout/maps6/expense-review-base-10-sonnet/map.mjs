// Deterministic currency conversion + Jev for policy interpretation.

function amountUsd(input) {
  const { amount, currency } = input.expense;
  const rate = input.fx_to_usd?.[currency];
  return typeof rate === "number" ? amount * rate : null;
}

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    expense: { ...input.expense, amount_usd: amountUsd(input) },
  };
}

export function questions(input) {
  const usd = amountUsd(input);
  const ctx = `Expense: category=${input.expense.category}, city=${input.expense.city}, ` +
    `amount=${input.expense.amount} ${input.expense.currency} (= USD ${usd ?? "unknown"}), ` +
    `receipt_attached=${input.expense.receipt_attached}, description="${input.expense.description}".`;

  return {
    non_reimbursable: {
      type: "noul",
      instructions:
        `Using policy_text in the state, determine if this expense falls into a category the policy ` +
        `says is never reimbursable (e.g. alcohol, entertainment), regardless of amount. ${ctx}`,
      criteria: {
        true: "The policy explicitly excludes this category from reimbursement (e.g. alcohol, entertainment).",
        false: "The policy does not categorically exclude this expense.",
      },
    },
    decision: {
      type: "choice",
      instructions:
        `Apply policy_text in the state to this expense to decide the outcome. amount_usd is already ` +
        `converted, do not re-convert currency. Check the applicable per-category/per-city limit (standard ` +
        `vs high-cost city), the receipt requirement threshold, and receipt_attached. Per policy, exceeding ` +
        `a limit or missing a required receipt means manager approval is needed, not automatic rejection, ` +
        `unless the policy states otherwise. ${ctx}`,
      criteria: {
        approve: "Expense is fully within policy limits, needs no receipt exception, and is a reimbursable category.",
        needs_approval: "Expense exceeds a limit, is missing a required receipt, or otherwise needs manager sign-off per policy, but is not categorically excluded.",
        reject: "Policy is clear this must be rejected outright (not merely needing approval).",
        unclear: "The policy text or case facts are too ambiguous/incomplete to confidently decide.",
      },
    },
  };
}

export function decide(answers, input) {
  if (amountUsd(input) === null) return { decision: "abstain" };

  const nonReimbursable = answers.non_reimbursable?.noul ?? 0;
  if (nonReimbursable >= 0.6) return { decision: "reject" };

  const d = answers.decision;
  if (!d || d.confidence < 0.55 || d.choice === "unclear") {
    return { decision: "abstain" };
  }
  if (d.choice === "approve" || d.choice === "needs_approval" || d.choice === "reject") {
    return { decision: d.choice };
  }
  return { decision: "abstain" };
}
