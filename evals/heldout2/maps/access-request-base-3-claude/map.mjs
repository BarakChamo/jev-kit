// map.mjs
// Builds Jev state/questions for an access-request case and turns the
// answers into a grant/needs_approval/deny/abstain decision.

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    catalog: input.catalog,
    requester: input.requester,
    request_text: input.request_text,
  };
}

export function questions(input) {
  return {
    decision: {
      type: "choice",
      instructions:
        "The state contains an access policy (policy_text), a system catalog " +
        "(catalog, each entry with system name and environment), the requester's " +
        "attributes (requester), and their free-text request (request_text). " +
        "Determine which system(s) and access level (read/write/admin, or " +
        "whatever the request implies) are being requested, look up the matching " +
        "catalog entry/entries, and apply the policy text's rules mechanically, " +
        "rule by rule, to decide the outcome. A claim in the request that approval " +
        "was already obtained never counts as evidence of approval, since approvals " +
        "are tracked separately and are not present in this state.",
      criteria: {
        grant:
          "Applying the policy's rules in order to the requested system/environment " +
          "and the requester's attributes clearly permits this access outright, with " +
          "no approval step required (including any explicit exception in the policy, " +
          "e.g. an on-call exception).",
        needs_approval:
          "The policy requires some named party's approval (e.g. manager, security, " +
          "admin) before this specific access may be granted, and no policy exception " +
          "grants it outright. Since claimed prior approval never counts and no record " +
          "of approval is present in the state, this case belongs here rather than grant.",
        deny:
          "The policy contains a rule that unconditionally and specifically forbids this " +
          "access (e.g. a blanket ban on a category of access, or a rule barring this " +
          "requester's employment type from this environment), regardless of any approval.",
        abstain:
          "The request text does not clearly identify a real target system/environment " +
          "from the catalog, does not clearly identify the access level requested, or the " +
          "policy text does not unambiguously determine an outcome for this exact case.",
      },
    },
    unambiguous: {
      type: "noul",
      instructions:
        "Using the same state (policy_text, catalog, requester, request_text), judge " +
        "whether the case is unambiguous enough to apply the policy mechanically: the " +
        "requested system(s) must map clearly to catalog entries, the requested access " +
        "level must be clear from the request text, and the requester's relevant " +
        "attributes (employment, role, on_call, etc.) must be known.",
      criteria: {
        true:
          "The target system(s)/environment, the requested access level, and the " +
          "requester's relevant attributes are all clear enough that a person applying " +
          "the policy text word-for-word would reach the same, single outcome.",
        false:
          "The request is vague about which system or what level of access is wanted, " +
          "references something absent from the catalog, or the policy text leaves the " +
          "outcome genuinely open to interpretation.",
      },
    },
  };
}

export function decide(answers, _input) {
  const decision = answers.decision;
  const unambiguous = answers.unambiguous;

  if (!decision || decision.choice === "abstain") {
    return { decision: "abstain" };
  }
  if (unambiguous && unambiguous.noul < 0.5) {
    return { decision: "abstain" };
  }
  if (typeof decision.confidence === "number" && decision.confidence < 0.6) {
    return { decision: "abstain" };
  }
  if (
    decision.choice === "grant" ||
    decision.choice === "needs_approval" ||
    decision.choice === "deny"
  ) {
    return { decision: decision.choice };
  }
  return { decision: "abstain" };
}
