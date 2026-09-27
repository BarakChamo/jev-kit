// map.mjs — expense line triage on Jev (TypeSafe System One)

const VALID_DECISIONS = new Set(["approve", "needs_approval", "reject"]);

export function buildState(input) {
  const { policy_text, fx_to_usd, expense } = input;
  const rate = fx_to_usd && expense.currency in fx_to_usd ? fx_to_usd[expense.currency] : null;
  const usd_amount = rate != null ? Math.round(expense.amount * rate * 100) / 100 : null;

  return {
    policy_text,
    expense: {
      ...expense,
      usd_amount,
      fx_rate: rate,
    },
  };
}

export function questions(_input) {
  return {
    decision: {
      type: "choice",
      instructions:
        "Audit one expense line (state.expense) against the written policy in state.policy_text. " +
        "The USD-converted amount is state.expense.usd_amount (already converted with the given FX rate); " +
        "use it to compare against any USD limits in the policy — do not re-derive currency conversion yourself. " +
        "If state.expense.fx_rate is null, the currency could not be converted; do not guess a USD figure, treat the limit check as unresolved and prefer needs_approval. " +
        "Pick exactly one: approve, needs_approval, or reject, based strictly on what the policy text says, including any explicit statement about whether overages/missing receipts are rejected or sent to a manager.",
      criteria: {
        approve:
          "The expense clearly complies with every applicable rule in the policy (amount within limit for its category/city, receipt requirements satisfied, not a prohibited category) — no reason for manager review.",
        needs_approval:
          "The policy explicitly routes this situation to manager approval rather than rejection or auto-approval — e.g. amount exceeds a stated limit but the policy says overages need approval (not rejection), or a required itemised receipt is missing and the policy sends that to approval, or an FX rate is missing so the limit can't be confirmed.",
        reject:
          "The policy unconditionally and explicitly forbids this expense (e.g. alcohol, entertainment, or another category the text says is never reimbursable), with no approval override mentioned.",
      },
    },
    ambiguous: {
      type: "noul",
      instructions:
        "Look at state.policy_text and state.expense together. Is the policy genuinely silent, unclear, self-contradictory, or missing information needed to decide this specific line (e.g. it doesn't mention this expense category or city tier, the limit that applies is not determinable, or two rules conflict)? " +
        "Answer false if an ordinary careful reader of the policy could confidently reach one clear outcome for this line.",
      criteria: {
        true: "The policy text does not clearly cover this case, or key facts needed to apply it are missing/contradictory, so a human should decide.",
        false: "The policy text clearly covers this case and a single correct outcome can be determined from it.",
      },
    },
  };
}

export function decide(answers, _input) {
  const decision = answers && answers.decision;
  const ambiguous = answers && answers.ambiguous;

  if (!decision || !VALID_DECISIONS.has(decision.choice)) {
    return { decision: "abstain" };
  }
  if (typeof decision.confidence === "number" && decision.confidence < 0.55) {
    return { decision: "abstain" };
  }
  if (ambiguous && typeof ambiguous.noul === "number" && ambiguous.noul >= 0.5) {
    return { decision: "abstain" };
  }

  return { decision: decision.choice };
}
