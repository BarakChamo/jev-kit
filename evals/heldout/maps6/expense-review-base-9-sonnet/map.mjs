// Expense line reviewer built on Jev.
// Arithmetic (currency conversion) is done deterministically in JS; Jev is
// used only to interpret the free-text policy against this expense.

const HIGH = 0.65;
const LOW = 0.35;

// true/false/"ambiguous" from a noul probability
function tri(p) {
  if (typeof p !== "number") return "ambiguous";
  if (p >= HIGH) return true;
  if (p <= LOW) return false;
  return "ambiguous";
}

function usdAmount(input) {
  const { amount, currency } = input.expense;
  const rate = input.fx_to_usd?.[currency];
  return typeof rate === "number" ? amount * rate : null;
}

export function buildState(input) {
  const usd_amount = usdAmount(input);
  return {
    policy_text: input.policy_text,
    fx_to_usd: input.fx_to_usd,
    expense: input.expense,
    usd_amount,
  };
}

export function questions(input) {
  const usd_amount = usdAmount(input);
  const e = input.expense;
  const base = `Policy:\n${input.policy_text}\n\nExpense: category=${e.category}, city=${e.city}, amount=${e.amount} ${e.currency} (= ${usd_amount === null ? "unknown" : usd_amount.toFixed(2)} USD), receipt_attached=${e.receipt_attached}, description="${e.description ?? ""}".`;

  return {
    policy_silent: {
      type: "noul",
      instructions: `${base}\nDoes the written policy fail to address this expense category/situation at all, so no rule (limit, ban, or receipt rule) clearly applies to it?`,
      criteria: {
        true: "The policy has no rule covering this category or situation; it is not addressed.",
        false: "The policy has a rule (limit, ban, or otherwise) that clearly covers this expense.",
      },
    },
    banned_category: {
      type: "noul",
      instructions: `${base}\nDoes the policy state that this expense's category (or what the description indicates it actually is, e.g. alcohol/entertainment) is never reimbursable, regardless of amount?`,
      criteria: {
        true: "Policy explicitly bans reimbursement for this category, no matter the amount.",
        false: "Policy does not ban this category outright.",
      },
    },
    over_limit: {
      type: "noul",
      instructions: `${base}\nUsing the policy's stated per-category limit (choosing the correct city tier, e.g. standard vs high-cost city, if the policy distinguishes them), does the USD amount of this expense exceed that limit?`,
      criteria: {
        true: "The USD amount exceeds the applicable policy limit for this category/city.",
        false: "The USD amount is within the applicable policy limit (or the policy sets no numeric limit for this category).",
      },
    },
    over_limit_action: {
      type: "choice",
      instructions: `${base}\nIf this expense exceeds its category limit, what does the policy say should happen to it?`,
      criteria: {
        needs_approval: "Policy says over-limit expenses require manager approval rather than automatic rejection.",
        reject: "Policy says over-limit expenses are simply rejected/disallowed.",
        not_specified: "Policy does not say what happens when this category's limit is exceeded.",
      },
    },
    receipt_required_missing: {
      type: "noul",
      instructions: `${base}\nDoes the policy require an itemised receipt for an expense of this size, and is such a receipt currently missing (receipt_attached is false) given the policy's rule?`,
      criteria: {
        true: "Policy requires an itemised receipt for this amount, and it is not attached.",
        false: "Either no itemised receipt is required for this amount, or one is attached.",
      },
    },
  };
}

export function decide(answers, input) {
  const policySilent = tri(answers.policy_silent?.noul);
  const banned = tri(answers.banned_category?.noul);
  const overLimit = tri(answers.over_limit?.noul);
  const receiptMissing = tri(answers.receipt_required_missing?.noul);
  const overLimitAction = answers.over_limit_action;

  if (policySilent === "ambiguous" || banned === "ambiguous") {
    return { decision: "abstain" };
  }
  if (policySilent === true) {
    return { decision: "abstain" };
  }
  if (banned === true) {
    return { decision: "reject" };
  }

  if (overLimit === "ambiguous" || receiptMissing === "ambiguous") {
    return { decision: "abstain" };
  }

  if (overLimit === true) {
    const action = overLimitAction?.choice;
    const conf = overLimitAction?.confidence ?? 0;
    if (action === "reject" && conf >= HIGH) {
      return { decision: "reject" };
    }
    // Default (needs_approval, not_specified, or low-confidence reject):
    // send to manager rather than auto-reject.
    return { decision: "needs_approval" };
  }

  if (receiptMissing === true) {
    return { decision: "needs_approval" };
  }

  return { decision: "approve" };
}
