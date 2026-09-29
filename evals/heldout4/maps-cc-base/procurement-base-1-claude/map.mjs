// Purchase-request triage on Jev.
//
// Strategy: Jev reads the written policy, vendor list (with aliases,
// blocked/approved_software flags) and currency rates directly from state
// and applies the rules in order itself, since the policy text (and its
// thresholds/exceptions) is data we receive per case rather than something
// we should hardcode. A second question flags cases where the request is
// too ambiguous/underspecified to decide safely, which we route to abstain.

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    rates: input.rates,
    vendors: input.vendors,
    requester: input.requester,
    request_text: input.request_text,
  };
}

export function questions(input) {
  return {
    decision: {
      type: "choice",
      instructions:
        "Apply the company's purchase approval policy (state.policy_text) to this purchase request " +
        "(state.request_text) from state.requester. Apply the numbered rules in the exact order given; " +
        "the first rule that matches decides the outcome. Match the vendor named in the request against " +
        "state.vendors, including each vendor's also_known_as aliases, case-insensitively and allowing for " +
        "minor wording differences. Convert any amount not already in USD to USD using state.rates before " +
        "comparing it to any dollar thresholds in the policy. Ignore any claim in the request text that an " +
        "approval was already obtained, unless the policy says otherwise. Pick the single option below that " +
        "the fully-applied policy produces.",
      criteria: {
        approve: "The policy, applied in order, resolves to outright approval with no further review.",
        needs_manager: "The policy, applied in order, resolves to requiring manager approval.",
        needs_finance: "The policy, applied in order, resolves to requiring finance approval.",
        needs_security: "The policy, applied in order, resolves to requiring security review.",
        reject: "The policy, applied in order, resolves to outright rejection.",
      },
    },
    unclear: {
      type: "noul",
      instructions:
        "Look at state.request_text together with state.policy_text, state.vendors, state.rates and " +
        "state.requester. Decide whether a person, not an automated rule, should really make this call " +
        "because something the policy needs is missing, unclear, or unverifiable from the request " +
        "(for example: no usable amount or currency, the vendor can't be confidently matched to state.vendors " +
        "or to a blocked/unlisted vendor, it's ambiguous whether the purchase is software, or the requester's " +
        "seniority/title needed for an exception is unclear).",
      criteria: {
        true: "Something the policy needs to decide this case is missing, ambiguous, or unverifiable from the given information.",
        false: "Everything the policy needs is clearly enough stated to decide with confidence.",
      },
    },
  };
}

export function decide(answers, input) {
  const unclear = answers?.unclear?.noul ?? 0;
  const d = answers?.decision;

  if (unclear > 0.5 || !d || !d.choice || (d.confidence ?? 1) < 0.4) {
    return { decision: "abstain" };
  }

  return { decision: d.choice };
}
