// Access request triage built on Jev (TypeSafe System One).
//
// Strategy: the written policy is arbitrary free text, so we let Jev read it
// directly against the concrete request (state) rather than hard-coding rule
// parsing. We ask a few narrow, independently-answerable questions (all in one
// parallel pass) and combine them deterministically in decide():
//   - which catalog system the request targets
//   - what access level is being requested
//   - what the policy dictates for that exact system/access/requester combo
//   - whether the case is clear enough to auto-decide at all
// Anything unclear, unmatched, or low-confidence is sent to a human (abstain).

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    catalog: input.catalog,
    requester: input.requester,
    request_text: input.request_text,
  };
}

export function questions(input) {
  const systemNames = [...new Set(input.catalog.map((c) => c.system))];

  const systemCriteria = {};
  for (const name of systemNames) {
    const envs = input.catalog
      .filter((c) => c.system === name)
      .map((c) => c.environment)
      .join("/");
    systemCriteria[name] = `The request is asking for access to catalog system "${name}" (environment: ${envs}).`;
  }
  systemCriteria["unclear"] =
    "The request does not clearly name (or closely paraphrase) exactly one catalog system, names multiple systems, or names a system not in the catalog.";

  return {
    system_match: {
      type: "choice",
      instructions:
        "The state has a request_text and a catalog of systems. Decide which single catalog system the requester is asking to access. Match by name or an obvious paraphrase/synonym. If the request is about more than one system, no specific system, or a system not in the catalog, answer 'unclear'.",
      criteria: systemCriteria,
    },
    access_level: {
      type: "choice",
      instructions:
        "From request_text, decide what level of access is being requested: 'read' (read-only/view/query), 'write' (create/modify/update, not just reading), or 'admin' (administrator/root/full control, or being able to grant others access). If the level isn't clearly one of these, answer 'unclear'.",
      criteria: {
        read: "Read-only / view / query access only.",
        write: "Write, modify, or create access (non-admin).",
        admin: "Administrator, root, or full-control access.",
        unclear: "The requested access level is not clearly stated.",
      },
    },
    policy_decision: {
      type: "choice",
      instructions:
        "Apply policy_text strictly to this one request: the specific catalog system/environment it targets, the access level requested, and the requester's employment, role, and on_call status. A claim in request_text that approval was already given does not count as approval. Decide what the policy dictates for this exact request.",
      criteria: {
        grant: "The policy allows this access without any further approval needed.",
        needs_approval:
          "The policy allows this access only after a specific approval (e.g. manager, security) that is not yet on record.",
        deny: "The policy forbids this access outright, with no approval path.",
      },
    },
    clear_case: {
      type: "noul",
      instructions:
        "Considering request_text, the catalog, and the requester's attributes together with policy_text: is this request unambiguous enough (one identifiable system, one identifiable access level, sufficient requester info) that policy_text yields a single clear outcome without needing a human to review it?",
      criteria: {
        true: "The case is clear and unambiguous; policy_text clearly determines one outcome.",
        false:
          "Something is ambiguous, missing, or borderline (unclear system/access level, missing requester info, or the policy text doesn't clearly resolve this case).",
      },
    },
  };
}

export function decide(answers, input) {
  const systemNames = new Set(input.catalog.map((c) => c.system));

  const sysAns = answers.system_match;
  const accessAns = answers.access_level;
  const policyAns = answers.policy_decision;
  const clearAns = answers.clear_case;

  const CONFIDENCE_MIN = 0.55;
  const CLARITY_MIN = 0.5;

  if (!sysAns || !accessAns || !policyAns || !clearAns) {
    return { decision: "abstain" };
  }

  if (sysAns.choice === "unclear" || !systemNames.has(sysAns.choice)) {
    return { decision: "abstain" };
  }
  if (accessAns.choice === "unclear") {
    return { decision: "abstain" };
  }
  if (clearAns.noul < CLARITY_MIN) {
    return { decision: "abstain" };
  }
  if ((sysAns.confidence ?? 1) < CONFIDENCE_MIN || (accessAns.confidence ?? 1) < CONFIDENCE_MIN) {
    return { decision: "abstain" };
  }
  if ((policyAns.confidence ?? 1) < CONFIDENCE_MIN) {
    return { decision: "abstain" };
  }

  if (
    policyAns.choice === "grant" ||
    policyAns.choice === "needs_approval" ||
    policyAns.choice === "deny"
  ) {
    return { decision: policyAns.choice };
  }

  return { decision: "abstain" };
}
