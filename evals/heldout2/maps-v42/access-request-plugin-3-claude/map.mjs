// Access request triage on Jev.
//
// Fixed structural facts (which system, what access level, who is asking) are
// extracted with `choice` questions. Whether the written policy grants,
// restricts, or gates each combination is read directly off `policy_text`
// with present-tense `noul` questions ("does the policy state X"), never
// derived by us guessing at clause numbers. All combining logic — including
// the safe "needs_approval" fallback for anything the policy doesn't clearly
// settle — happens in decide().

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    catalog: input.catalog,
    requester: input.requester,
    request_text: input.request_text,
  };
}

export function questions(input) {
  const catalog = input.catalog || [];

  const systemCriteria = {};
  for (const entry of catalog) {
    systemCriteria[entry.system] =
      `the request is asking for access to the "${entry.system}" system, a ${entry.environment} system`;
  }
  systemCriteria.unclear =
    "request_text does not clearly name one system from catalog, or names a system not in catalog";

  return {
    target_system: {
      type: "choice",
      instructions:
        "Which system in `catalog` is the requester asking for access to in `request_text`?",
      criteria: systemCriteria,
    },
    access_level: {
      type: "choice",
      instructions:
        "What level of access is the requester asking for in `request_text`?",
      criteria: {
        read: "read-only, view, or query access",
        write: "write, edit, or modify access",
        admin: "administrator, root, or full-control access",
        unclear: "request_text does not clearly state read, write, or admin",
      },
    },
    admin_never_allowed: {
      type: "noul",
      instructions:
        "Does `policy_text` state that admin access may never be granted through this request process, for anyone?",
      criteria: {
        true: "policy_text states admin access is never granted this way",
        false: "policy_text does not state this",
      },
    },
    contractor_prod_denied: {
      type: "noul",
      instructions:
        "Does `policy_text` state that contractors (as distinct from employees) may never access production systems?",
      criteria: {
        true: "policy_text states contractors may never access production systems",
        false: "policy_text does not state this",
      },
    },
    nonprod_read_auto_grant: {
      type: "noul",
      instructions:
        "Does `policy_text` state that read access to non-production systems is granted without needing anyone's approval?",
      criteria: {
        true: "policy_text grants read access to non-production systems without approval",
        false: "policy_text does not state this",
      },
    },
    nonprod_write_needs_manager: {
      type: "noul",
      instructions:
        "Does `policy_text` state that write access to non-production systems requires the requester's manager's approval?",
      criteria: {
        true: "policy_text requires the requester's manager's approval for write access to non-production systems",
        false: "policy_text does not state this",
      },
    },
    prod_needs_security: {
      type: "noul",
      instructions:
        "Does `policy_text` state that any access to production systems requires security approval?",
      criteria: {
        true: "policy_text requires security approval for access to production systems",
        false: "policy_text does not state this",
      },
    },
    prod_oncall_engineer_read_exempt: {
      type: "noul",
      instructions:
        "Does `policy_text` state an exception granting read access to production systems, without approval, to engineers who are currently on call?",
      criteria: {
        true: "policy_text states this on-call engineer read exception for production",
        false: "policy_text does not state this exception",
      },
    },
  };
}

function noulLabel(answers, id, lo = 0.35, hi = 0.65) {
  const v = answers[id]?.noul;
  if (v === undefined) return "unclear";
  if (v >= hi) return "true";
  if (v <= lo) return "false";
  return "unclear";
}

export function decide(answers, input) {
  const requester = input.requester || {};
  const catalog = input.catalog || [];

  const sys = answers.target_system;
  const lvl = answers.access_level;

  if (!sys || sys.choice === "unclear" || sys.confidence < 0.6) {
    return { decision: "abstain" };
  }
  if (!lvl || lvl.choice === "unclear" || lvl.confidence < 0.6) {
    return { decision: "abstain" };
  }

  const entry = catalog.find((c) => c.system === sys.choice);
  if (!entry) return { decision: "abstain" };

  const isProd = entry.environment === "production";
  const accessLevel = lvl.choice;
  const isContractor = String(requester.employment).toLowerCase() === "contractor";
  const isEngineer = String(requester.role).toLowerCase() === "engineer";
  const isOnCall = !!requester.on_call;

  // Admin is checked first: policy bans on admin apply regardless of
  // environment or employment type.
  if (accessLevel === "admin") {
    return noulLabel(answers, "admin_never_allowed") === "true"
      ? { decision: "deny" }
      : { decision: "needs_approval" };
  }

  // Contractor + production is a hard restriction where the policy states
  // it; where the policy is silent or ambiguous on it, escalate rather than
  // risk a wrong grant.
  if (isProd && isContractor) {
    const banned = noulLabel(answers, "contractor_prod_denied");
    if (banned === "true") return { decision: "deny" };
    if (banned === "unclear") return { decision: "needs_approval" };
  }

  if (!isProd) {
    if (accessLevel === "read" && noulLabel(answers, "nonprod_read_auto_grant") === "true") {
      return { decision: "grant" };
    }
    if (accessLevel === "write" && noulLabel(answers, "nonprod_write_needs_manager") === "true") {
      return { decision: "needs_approval" };
    }
    return { decision: "needs_approval" };
  }

  // Production.
  if (
    accessLevel === "read" &&
    isEngineer &&
    isOnCall &&
    noulLabel(answers, "prod_oncall_engineer_read_exempt") === "true"
  ) {
    return { decision: "grant" };
  }

  return { decision: "needs_approval" };
}
