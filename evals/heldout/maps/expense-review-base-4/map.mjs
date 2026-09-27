// map.mjs — expense line triage on Jev (TypeSafe System One)

export function buildState(input) {
  const { policy_text, fx_to_usd, expense } = input;
  const rate = fx_to_usd ? fx_to_usd[expense.currency] : undefined;
  const usd_amount =
    typeof rate === "number" ? Math.round(expense.amount * rate * 100) / 100 : null;

  return {
    policy_text,
    fx_to_usd,
    expense,
    usd_amount, // pre-converted so Jev never has to do currency arithmetic
  };
}

export function questions(input) {
  return {
    outcome: {
      type: "choice",
      instructions:
        "You are an expense compliance reviewer. Using policy_text (the full written travel & expense policy), fx_to_usd, and expense (the submitted line, with usd_amount already converted to USD) from state, decide the correct action for this single expense line under the policy exactly as written. Apply the policy's per-category and per-city limits, its receipt/itemization rules, and any absolute prohibitions it states. Do not invent rules the policy text does not contain, and do not apply limits from a different category or city than the one on this expense. If the policy says an overage goes to manager approval rather than rejection, choose needs_approval, not reject.",
      criteria: {
        approve:
          "The expense fully complies with the policy: within all limits that apply to it, receipt requirements (if any) are met, and it is not a prohibited category.",
        needs_approval:
          "The expense exceeds a limit or fails a receipt requirement, but the policy directs that kind of violation to manager approval rather than outright rejection, or the situation is borderline in a way the policy implies a manager should judge.",
        reject:
          "The policy explicitly and unconditionally disallows this expense (e.g. a category it states is never reimbursable), or it is clearly non-compliant with no path to approval under the policy text.",
      },
    },
    unclear: {
      type: "noul",
      instructions:
        "Using the same policy_text and expense from state, assess whether the written policy is genuinely silent, ambiguous, or internally conflicting about how to treat this specific expense (its category, its city's cost tier, or its particular situation), such that a careful reviewer could not confidently apply a single rule from the text alone.",
      criteria: {
        true: "The policy text does not clearly address this expense's category, city tier, or situation, or the applicable rule is ambiguous or conflicting.",
        false: "The policy text clearly covers this expense and its correct treatment can be determined from it alone.",
      },
    },
  };
}

export function decide(answers, input) {
  const expense = input?.expense;
  const rate = input?.fx_to_usd ? input.fx_to_usd[expense?.currency] : undefined;
  if (typeof rate !== "number") {
    return { decision: "abstain" }; // can't value the expense in USD
  }

  const unclear = answers?.unclear?.noul;
  if (typeof unclear !== "number" || unclear >= 0.5) {
    return { decision: "abstain" };
  }

  const outcome = answers?.outcome;
  const choice = outcome?.choice;
  if (!["approve", "needs_approval", "reject"].includes(choice)) {
    return { decision: "abstain" };
  }

  const confidence = outcome?.confidence ?? 0;
  const probs = outcome?.probabilities ? Object.values(outcome.probabilities) : [];
  const topProb = probs.length ? Math.max(...probs) : confidence;
  if (confidence < 0.6 || topProb < 0.55) {
    return { decision: "abstain" };
  }

  return { decision: choice };
}
