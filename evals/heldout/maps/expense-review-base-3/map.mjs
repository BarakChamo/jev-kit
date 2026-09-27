// map.mjs — expense line review on Jev

export function buildState(input) {
  const { policy_text, expense, fx_to_usd } = input;
  const rate = fx_to_usd ? fx_to_usd[expense?.currency] : undefined;
  const usd_amount =
    typeof rate === "number" && typeof expense?.amount === "number"
      ? Math.round(expense.amount * rate * 100) / 100
      : null;

  return {
    policy_text,
    expense: {
      category: expense?.category,
      city: expense?.city,
      amount: expense?.amount,
      currency: expense?.currency,
      usd_amount,
      receipt_attached: expense?.receipt_attached,
      description: expense?.description,
    },
  };
}

export function questions(input) {
  return {
    decision: {
      type: "choice",
      instructions:
        "Given policy_text and the expense in state (amounts already converted to USD as usd_amount), decide how this expense line should be handled. Apply the policy's numeric limits (using usd_amount), its receipt/documentation rules, and any blanket exclusions exactly as written in policy_text.",
      criteria: {
        approve:
          "The expense is fully compliant: not a blanket-excluded category, within all applicable policy limits, and meets any receipt/documentation requirement.",
        needs_approval:
          "The expense is not blanket-excluded, but it exceeds a policy limit, is missing a required receipt/itemisation, or otherwise needs manager sign-off per the policy — it is not an outright violation.",
        reject:
          "policy_text states this category or type of expense (e.g. alcohol, entertainment, personal items) is never reimbursable, regardless of amount, receipts, or approval.",
      },
    },
    ambiguous: {
      type: "noul",
      instructions:
        "Given policy_text and the expense in state, is there real ambiguity or missing/inconsistent information (unclear category or city cost tier, vague or suspicious description, contradictory policy wording, an unusual or out-of-scope situation) such that an automated system should NOT decide this case and it should instead go to a human reviewer?",
      criteria: {
        true: "Yes, there is real ambiguity or missing information that warrants human review rather than an automatic decision.",
        false: "No, the facts and policy are clear enough to decide automatically.",
      },
    },
  };
}

export function decide(answers, input) {
  const expense = input?.expense;
  const rate = input?.fx_to_usd ? input.fx_to_usd[expense?.currency] : undefined;

  if (
    !expense ||
    typeof expense.amount !== "number" ||
    expense.amount < 0 ||
    typeof rate !== "number"
  ) {
    return { decision: "abstain" };
  }

  const ambiguous = answers?.ambiguous?.noul ?? 1;
  if (ambiguous > 0.6) {
    return { decision: "abstain" };
  }

  const decisionAnswer = answers?.decision;
  const choice = decisionAnswer?.choice;
  const confidence = decisionAnswer?.confidence ?? 0;

  if (!choice || confidence < 0.55) {
    return { decision: "abstain" };
  }

  if (choice === "approve" || choice === "needs_approval" || choice === "reject") {
    return { decision: choice };
  }

  return { decision: "abstain" };
}
