// Expense line triage against a free-text T&E policy, using Jev for policy
// interpretation and plain JS for the deterministic parts (currency math,
// data-validity checks).

function amountUsd(input) {
  const { expense, fx_to_usd } = input;
  const rate = fx_to_usd && fx_to_usd[expense.currency];
  if (typeof rate !== "number" || !isFinite(rate) || rate <= 0) return null;
  if (typeof expense.amount !== "number" || !isFinite(expense.amount)) return null;
  return Math.round(expense.amount * rate * 100) / 100;
}

export function buildState(input) {
  const { policy_text, fx_to_usd, expense } = input;
  return {
    policy_text,
    fx_to_usd,
    expense: { ...expense, amount_usd: amountUsd(input) },
  };
}

export function questions(input) {
  const usd = amountUsd(input);
  const { expense } = input;
  const ctx =
    `Expense: category="${expense.category}", city="${expense.city}", ` +
    `amount=${expense.amount} ${expense.currency} (~USD ${usd ?? "unknown"}), ` +
    `receipt_attached=${expense.receipt_attached}, description="${expense.description ?? ""}".`;

  return {
    neverReimbursable: {
      type: "noul",
      instructions:
        `Using policy_text in state, decide if this expense is of a category the policy ` +
        `explicitly says is never reimbursable regardless of amount (e.g. alcohol, entertainment, ` +
        `personal items) — not merely over a spending limit. ${ctx}`,
      criteria: {
        true: "The policy text explicitly bars reimbursement for this kind of expense outright.",
        false: "The policy does not bar this category outright; at most it has an amount limit.",
      },
    },
    withinLimit: {
      type: "noul",
      instructions:
        `Using policy_text in state and the expense's USD amount (state.expense.amount_usd), ` +
        `decide whether the amount is within the applicable policy limit for this category and ` +
        `city's cost tier (policies often have a higher limit for named high-cost cities). ${ctx}`,
      criteria: {
        true: "The USD amount is at or under the applicable limit in the policy.",
        false: "The USD amount exceeds the applicable limit in the policy.",
      },
    },
    receiptOk: {
      type: "noul",
      instructions:
        `Using policy_text's receipt/documentation rules, decide whether this expense line ` +
        `satisfies those requirements given receipt_attached and the amount. ${ctx}`,
      criteria: {
        true: "Receipt/documentation requirements are satisfied (none required, or one is attached).",
        false: "A receipt or itemised documentation is required by policy but missing.",
      },
    },
    overLimitAction: {
      type: "choice",
      instructions:
        `Read only the policy_text. When an expense exceeds its category/city spending limit, ` +
        `what consequence does the written policy prescribe?`,
      criteria: {
        reject: "Policy says over-limit expenses are rejected/not reimbursed.",
        needs_approval: "Policy says over-limit expenses require manager approval rather than rejection.",
      },
    },
    missingReceiptAction: {
      type: "choice",
      instructions:
        `Read only the policy_text. When a required receipt/itemised documentation is missing, ` +
        `what consequence does the written policy prescribe?`,
      criteria: {
        reject: "Policy says a missing required receipt causes rejection.",
        needs_approval: "Policy says a missing required receipt requires manager approval rather than rejection.",
      },
    },
    ambiguous: {
      type: "noul",
      instructions:
        `Decide if this case is too ambiguous or under-specified for an automated policy check to ` +
        `resolve on its own, such that a human reviewer should look at it instead — e.g. the ` +
        `category/city isn't addressed by the policy, data looks contradictory, or the situation is ` +
        `unusual enough that policy text doesn't clearly apply. ${ctx}`,
      criteria: {
        true: "A human should review this rather than an automated decision.",
        false: "The policy text clearly covers this case; an automated decision is appropriate.",
      },
    },
  };
}

function isUncertain(p, margin = 0.12) {
  return typeof p !== "number" || Math.abs(p - 0.5) < margin;
}

export function decide(answers, input) {
  const usd = amountUsd(input);
  const { expense } = input;

  if (usd === null || !expense.category || !expense.city) {
    return { decision: "abstain" };
  }

  const neverReimbursable = answers.neverReimbursable?.noul;
  const withinLimit = answers.withinLimit?.noul;
  const receiptOk = answers.receiptOk?.noul;
  const ambiguous = answers.ambiguous?.noul;
  const overLimitAction = answers.overLimitAction;
  const missingReceiptAction = answers.missingReceiptAction;

  if (
    typeof neverReimbursable !== "number" ||
    typeof withinLimit !== "number" ||
    typeof receiptOk !== "number" ||
    typeof ambiguous !== "number" ||
    !overLimitAction ||
    !missingReceiptAction
  ) {
    return { decision: "abstain" };
  }

  if (ambiguous > 0.5 || isUncertain(neverReimbursable, 0.1)) {
    return { decision: "abstain" };
  }

  if (neverReimbursable > 0.5) {
    return { decision: "reject" };
  }

  const overLimit = withinLimit <= 0.5;
  const missingReceipt = receiptOk <= 0.5;

  if (isUncertain(withinLimit) || isUncertain(receiptOk)) {
    return { decision: "abstain" };
  }

  let action = null; // "reject" | "needs_approval" | null
  if (overLimit) {
    if (overLimitAction.confidence != null && overLimitAction.confidence < 0.55) {
      return { decision: "abstain" };
    }
    action = overLimitAction.choice === "reject" ? "reject" : "needs_approval";
  }
  if (missingReceipt) {
    if (missingReceiptAction.confidence != null && missingReceiptAction.confidence < 0.55) {
      return { decision: "abstain" };
    }
    const a = missingReceiptAction.choice === "reject" ? "reject" : "needs_approval";
    action = action === "reject" || a === "reject" ? "reject" : "needs_approval";
  }

  if (action === "reject") return { decision: "reject" };
  if (action === "needs_approval") return { decision: "needs_approval" };
  return { decision: "approve" };
}
