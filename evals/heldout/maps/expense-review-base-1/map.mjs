// Expense-line policy decisioning built on Jev.
//
// Strategy: let Jev read the raw policy text (it varies case to case) and
// answer a small, fixed set of judgment questions about THIS expense. All
// arithmetic (currency conversion, amount comparisons for confidence
// thresholds) is done deterministically in JS; Jev is only used for the
// parts that require reading/interpreting policy prose.

const AMBIG_LO = 0.4;
const AMBIG_HI = 0.6;

function isAmbiguous(p) {
  return typeof p === "number" && p > AMBIG_LO && p < AMBIG_HI;
}

export function buildState(input) {
  const { policy_text, fx_to_usd, expense } = input;
  const rate = fx_to_usd?.[expense.currency];
  const amount_usd = typeof rate === "number" ? expense.amount * rate : null;

  return {
    policy_text,
    expense,
    amount_usd: amount_usd != null ? Math.round(amount_usd * 100) / 100 : null,
  };
}

export function questions(input) {
  return {
    non_reimbursable: {
      type: "noul",
      instructions:
        "Look at policy_text and the expense in state. Regardless of amount or receipts, does the policy categorically forbid reimbursing this kind of expense (e.g. it is alcohol, entertainment, a personal item, or another explicitly excluded category)?",
      criteria: {
        true: "The policy explicitly says this category/item is never reimbursable.",
        false: "The policy does not exclude this category; it is a normal reimbursable expense type, possibly subject to a limit.",
      },
    },
    receipt_missing: {
      type: "noul",
      instructions:
        "Look at policy_text and the expense in state (amount_usd, receipt_attached). Does the policy require an itemised receipt for an expense of this size, and is that required receipt missing here?",
      criteria: {
        true: "Policy requires a receipt at this amount and receipt_attached is false (or otherwise missing), so approval is required for the missing documentation.",
        false: "Either no receipt is required at this amount, or a receipt is already attached.",
      },
    },
    over_limit: {
      type: "noul",
      instructions:
        "Look at policy_text and the expense in state (category, city, amount_usd). Determine the applicable USD limit for this category and city tier per the policy, and decide whether amount_usd exceeds that limit.",
      criteria: {
        true: "amount_usd is above the policy's applicable limit for this category/city.",
        false: "amount_usd is within the policy's applicable limit for this category/city.",
      },
    },
    over_limit_action: {
      type: "choice",
      instructions:
        "If this expense (per policy_text and the expense in state) exceeds its policy limit, what does the policy say should happen? If the policy is silent or the expense is not over limit, answer with the general/default rule the policy states for over-limit expenses.",
      criteria: {
        reject: "Policy says amounts over the limit are rejected outright.",
        needs_approval: "Policy says amounts over the limit require manager approval rather than rejection (this is the common default when the policy doesn't say 'rejected').",
      },
    },
  };
}

export function decide(answers, input) {
  const abstain = { decision: "abstain" };
  const { expense, fx_to_usd } = input;

  const rate = fx_to_usd?.[expense.currency];
  if (typeof rate !== "number" || !(expense.amount >= 0) || !expense.category) {
    return abstain;
  }

  const nonReimb = answers.non_reimbursable?.noul;
  const receiptMissing = answers.receipt_missing?.noul;
  const overLimit = answers.over_limit?.noul;
  const overAction = answers.over_limit_action;

  if (
    typeof nonReimb !== "number" ||
    typeof receiptMissing !== "number" ||
    typeof overLimit !== "number"
  ) {
    return abstain;
  }

  // Core categorical calls (exclusion, over-limit) too uncertain to trust.
  if (isAmbiguous(nonReimb) || isAmbiguous(overLimit)) {
    return abstain;
  }

  if (nonReimb >= 0.6) {
    return { decision: "reject" };
  }

  if (receiptMissing >= 0.5) {
    return { decision: "needs_approval" };
  }

  if (overLimit >= 0.6) {
    if (overAction?.choice === "reject" && overAction.confidence >= 0.6) {
      return { decision: "reject" };
    }
    return { decision: "needs_approval" };
  }

  return { decision: "approve" };
}
