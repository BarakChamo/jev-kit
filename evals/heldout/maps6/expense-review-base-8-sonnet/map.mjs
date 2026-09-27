// map.mjs — expense line triage on Jev.
//
// Deterministic work (FX conversion, sanity checks) happens in plain JS.
// Jev is only asked to interpret the written policy against the expense
// (prohibited categories, receipt rules, limit comparison) and to flag
// anything that needs a human instead of an automated call.

function amountUsd(input) {
  const e = input && input.expense;
  if (!e || typeof e.amount !== "number" || !e.currency) return null;
  const rate = input.fx_to_usd ? input.fx_to_usd[e.currency] : undefined;
  if (typeof rate !== "number") return null;
  return Math.round(e.amount * rate * 100) / 100;
}

export function buildState(input) {
  const expense = (input && input.expense) || {};
  const usd = amountUsd(input);
  return {
    policy_text: input && input.policy_text,
    expense,
    amount_usd: usd
  };
}

function context(input) {
  const state = buildState(input);
  const e = state.expense;
  const amountLine =
    state.amount_usd !== null
      ? `Amount: ${e.amount} ${e.currency} (~${state.amount_usd} USD at the given FX rate).`
      : `Amount: ${e.amount} ${e.currency} (USD equivalent could not be computed).`;

  return (
    `Policy:\n${state.policy_text}\n\n` +
    `Expense line:\nCategory: ${e.category}\nCity: ${e.city}\n${amountLine}\n` +
    `Receipt attached: ${e.receipt_attached ? "yes" : "no"}\n` +
    `Description: ${e.description || "(none)"}`
  );
}

export function questions(input) {
  const ctx = context(input);
  return {
    prohibited_expense: {
      type: "choice",
      instructions:
        `${ctx}\n\nDoes the written policy make this expense category/item never ` +
        `reimbursable regardless of amount or approval (e.g. alcohol, entertainment, ` +
        `or another item the policy explicitly bars)?`,
      criteria: {
        yes: "Policy explicitly and unconditionally bars this category/item from reimbursement.",
        no: "Policy does not bar this item outright; at most amount limits or receipt rules apply.",
        unclear: "Policy text does not clearly address whether this item is barred."
      }
    },
    receipt_required_and_missing: {
      type: "choice",
      instructions:
        `${ctx}\n\nPer the policy's receipt rule, is an itemised receipt required for ` +
        `an expense like this, and none is attached?`,
      criteria: {
        yes: "Policy requires an itemised receipt for an expense of this size/type, and none is attached.",
        no: "Either no itemised receipt is required here, or one is attached.",
        unclear: "The policy does not clearly state the receipt requirement for this case."
      }
    },
    within_limit: {
      type: "choice",
      instructions:
        `${ctx}\n\nCompare the USD amount to the policy's limit for this expense ` +
        `category and city tier. Is the amount within that limit?`,
      criteria: {
        yes: "The USD amount is at or below the applicable policy limit for this category/city.",
        no: "The USD amount exceeds the applicable policy limit for this category/city.",
        unclear: "The policy does not clearly specify an applicable limit for this category/city."
      }
    },
    needs_human: {
      type: "noul",
      instructions:
        `${ctx}\n\nSetting aside the checks above, is there anything else about this ` +
        `case (description/category mismatch, signs of policy circumvention, missing ` +
        `info, an edge case the policy doesn't cover, etc.) that means a human manager ` +
        `should look at it rather than an automated system deciding?`,
      criteria: {
        true: "There is a genuine reason a human should review this beyond the standard checks.",
        false: "Nothing beyond the standard checks; clear enough for an automated decision."
      }
    }
  };
}

const CONF_MIN = 0.6;

function confidentChoice(answer) {
  return (
    answer &&
    answer.type === "choice" &&
    answer.choice !== "unclear" &&
    typeof answer.confidence === "number" &&
    answer.confidence >= CONF_MIN
  );
}

export function decide(answers, input) {
  const e = input && input.expense;
  if (!e || typeof e.amount !== "number" || !e.currency) {
    return { decision: "abstain" };
  }
  const rate = input.fx_to_usd ? input.fx_to_usd[e.currency] : undefined;
  if (typeof rate !== "number") {
    return { decision: "abstain" }; // can't verify limits without a USD amount
  }

  const prohibited = answers && answers.prohibited_expense;
  const receipt = answers && answers.receipt_required_and_missing;
  const limit = answers && answers.within_limit;
  const needsHuman = answers && answers.needs_human;

  if (!prohibited || !receipt || !limit || !needsHuman) {
    return { decision: "abstain" };
  }
  if (needsHuman.type === "noul" && needsHuman.noul >= 0.5) {
    return { decision: "abstain" };
  }
  if (!confidentChoice(prohibited) || !confidentChoice(receipt) || !confidentChoice(limit)) {
    return { decision: "abstain" };
  }

  if (prohibited.choice === "yes") return { decision: "reject" };
  if (receipt.choice === "yes") return { decision: "needs_approval" };
  if (limit.choice === "no") return { decision: "needs_approval" };
  if (prohibited.choice === "no" && receipt.choice === "no" && limit.choice === "yes") {
    return { decision: "approve" };
  }
  return { decision: "abstain" };
}
