// map.mjs — expense line triage against a per-case written policy, via Jev.

function toUsd(amount, currency, fx_to_usd) {
  const rate = fx_to_usd?.[currency];
  if (typeof rate !== "number" || !Number.isFinite(rate)) return null;
  return Math.round(amount * rate * 100) / 100;
}

export function buildState(input) {
  const { policy_text, fx_to_usd, expense } = input;
  const usd_amount = toUsd(expense.amount, expense.currency, fx_to_usd);
  return {
    policy_text,
    expense: {
      ...expense,
      usd_amount, // pre-converted; use this for any USD-denominated limit in the policy
    },
  };
}

export function questions(input) {
  return {
    policy_covers: {
      type: "noul",
      instructions:
        "Look at state.policy_text and state.expense. Does the policy text contain a clear, on-point rule " +
        "covering this expense's category (and city, if the policy distinguishes cities) that is sufficient " +
        "to determine approve / needs_approval / reject without guessing or inventing a rule the text doesn't state?",
      criteria: {
        true: "The policy clearly addresses this category/situation (directly or via an unambiguous general rule).",
        false: "The policy is silent, only tangentially related, or genuinely ambiguous about this category/situation.",
      },
    },
    decision: {
      type: "choice",
      instructions:
        "You are auditing one expense line against the company's own written travel & expense policy in " +
        "state.policy_text. Use ONLY rules stated in policy_text — do not assume rules from a different, generic " +
        "policy. state.expense.usd_amount is the amount already converted to USD with the given FX rates; use it " +
        "for any USD limit in the policy. Check: whether the category is ever reimbursable at all; the applicable " +
        "per-diem/per-night/per-trip limit for the expense's city (standard vs. high-cost, if the policy lists such " +
        "cities); receipt/documentation requirements; and any explicit statement about whether exceeding a limit " +
        "is rejected outright or instead requires manager approval. Pick the single best decision.",
      criteria: {
        approve:
          "Fully compliant with policy_text: within every applicable limit, category is reimbursable, and any " +
          "documentation requirement is met.",
        needs_approval:
          "policy_text states or implies a manager must approve this (e.g. a limit is exceeded but the policy " +
          "calls for approval rather than rejection, or a required receipt/itemisation is missing), or applying " +
          "the policy to this specific case is a close/borderline call a manager should review.",
        reject:
          "policy_text explicitly says this category or type of expense is never reimbursable / is rejected, " +
          "regardless of amount or approval.",
      },
    },
  };
}

const CONFIDENCE_FLOOR = 0.6;
const COVERAGE_FLOOR = 0.5;

export function decide(answers, input) {
  const usd_amount = toUsd(
    input.expense.amount,
    input.expense.currency,
    input.fx_to_usd
  );
  if (usd_amount === null) return { decision: "abstain" };

  const covers = answers?.policy_covers?.noul;
  if (typeof covers !== "number" || covers < COVERAGE_FLOOR) {
    return { decision: "abstain" };
  }

  const decision = answers?.decision;
  if (!decision || typeof decision.confidence !== "number") {
    return { decision: "abstain" };
  }
  if (decision.confidence < CONFIDENCE_FLOOR) {
    return { decision: "abstain" };
  }

  if (
    decision.choice === "approve" ||
    decision.choice === "needs_approval" ||
    decision.choice === "reject"
  ) {
    return { decision: decision.choice };
  }

  return { decision: "abstain" };
}
