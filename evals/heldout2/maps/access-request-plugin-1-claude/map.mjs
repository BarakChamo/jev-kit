// Jev map for internal access-request triage.
//
// Design notes:
// - The request itself (which system, what access level) is extracted from
//   `request_text`, scoped to that field.
// - The policy's substantive provisions are extracted from `policy_text` as
//   separate present-tense facts, scoped to that field, so request_text can
//   never inject "the policy says X" into a policy question (rule 2).
// - Requester attributes (employment, role, on_call) come straight from the
//   structured input; they are already reliable facts and are not re-asked.
// - The decision is assembled in code from these atomic facts (rule 12).
//   Low-confidence or contradictory facts always fall toward needs_approval
//   or abstain, never toward grant (rule 13).

const CHOICE_CONF_MIN = 0.6;
const NOUL_TRUE = 0.7;
const NOUL_FALSE = 0.3;

function noulState(p) {
  if (typeof p !== "number") return "uncertain";
  if (p >= NOUL_TRUE) return true;
  if (p <= NOUL_FALSE) return false;
  return "uncertain";
}

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    catalog: input.catalog,
    requester: input.requester,
    request_text: input.request_text,
  };
}

export function questions(input) {
  const systemOptions = {};
  for (const entry of input.catalog || []) {
    systemOptions[entry.system] =
      `the request in \`request_text\` is asking for access to the "${entry.system}" system (environment: ${entry.environment})`;
  }
  systemOptions["multiple_systems"] =
    "request_text clearly asks for access to more than one distinct system in the catalog";
  systemOptions["unclear"] =
    "request_text does not clearly name one system that appears in `catalog`";

  return {
    target_system: {
      type: "choice",
      instructions:
        "Which system listed in `catalog` is the request in `request_text` asking for access to?",
      criteria: systemOptions,
    },
    access_level: {
      type: "choice",
      instructions:
        "What level of access does `request_text` ask for on the target system?",
      criteria: {
        read: "read-only / view / query access, no ability to modify data or config",
        write: "the ability to create, modify or delete data or configuration",
        admin: "administrator, root, superuser, or the ability to grant others access",
        unclear: "request_text does not state a clear access level",
      },
    },
    policy_bars_admin: {
      type: "noul",
      instructions:
        "Does `policy_text` state that admin-level (or root/superuser) access may never be granted through this process, regardless of who requests it?",
      criteria: {
        true: "policy_text contains an unconditional bar on granting admin access this way",
        false: "policy_text has no such unconditional bar on admin access",
      },
    },
    policy_bars_contractor_prod: {
      type: "noul",
      instructions:
        "Does `policy_text` state that contractors (requesters who are not employees) may never be given access to production systems?",
      criteria: {
        true: "policy_text unconditionally bars contractor access to production systems",
        false: "policy_text has no such bar on contractor access to production",
      },
    },
    policy_prod_requires_security: {
      type: "noul",
      instructions:
        "Does `policy_text` state, as a general rule, that any access to production systems needs approval from a security role or team?",
      criteria: {
        true: "policy_text requires security approval for production access as a general rule",
        false: "policy_text does not require security approval for production access in general",
      },
    },
    policy_oncall_read_prod_exception: {
      type: "noul",
      instructions:
        "Does `policy_text` state an exception granting read-only access to production systems, without further approval, for engineers who are currently on call?",
      criteria: {
        true: "policy_text states this on-call engineer read exception for production",
        false: "policy_text states no such on-call exception",
      },
    },
    policy_nonprod_read_free: {
      type: "noul",
      instructions:
        "Does `policy_text` state that read access to non-production systems is granted without needing approval?",
      criteria: {
        true: "policy_text grants non-production read access without approval",
        false: "policy_text does not say non-production read access is approval-free",
      },
    },
    policy_nonprod_write_needs_manager: {
      type: "noul",
      instructions:
        "Does `policy_text` state that write access to non-production systems needs the requester's manager's approval?",
      criteria: {
        true: "policy_text requires the requester's manager to approve non-production write access",
        false: "policy_text does not require manager approval for non-production write access",
      },
    },
  };
}

export function decide(answers, input) {
  const targetAns = answers.target_system;
  const levelAns = answers.access_level;

  if (
    !targetAns ||
    !levelAns ||
    targetAns.confidence < CHOICE_CONF_MIN ||
    levelAns.confidence < CHOICE_CONF_MIN ||
    targetAns.choice === "unclear" ||
    targetAns.choice === "multiple_systems" ||
    levelAns.choice === "unclear"
  ) {
    return { decision: "abstain" };
  }

  const catalogEntry = (input.catalog || []).find(
    (c) => c.system === targetAns.choice
  );
  if (!catalogEntry) return { decision: "abstain" };

  const isProd = catalogEntry.environment === "production";
  const level = levelAns.choice;

  const employment = (input.requester?.employment || "").toLowerCase();
  const isContractor = employment !== "employee";
  const role = (input.requester?.role || "").toLowerCase();
  const isOnCall = input.requester?.on_call === true;

  const barsAdmin = noulState(answers.policy_bars_admin?.noul);
  const barsContractorProd = noulState(answers.policy_bars_contractor_prod?.noul);
  const prodNeedsSecurity = noulState(answers.policy_prod_requires_security?.noul);
  const oncallReadException = noulState(answers.policy_oncall_read_prod_exception?.noul);
  const nonprodReadFree = noulState(answers.policy_nonprod_read_free?.noul);
  const nonprodWriteNeedsManager = noulState(
    answers.policy_nonprod_write_needs_manager?.noul
  );

  // Admin is highest-priority and most restrictive.
  if (level === "admin") {
    if (barsAdmin === true) return { decision: "deny" };
    return { decision: "abstain" };
  }

  if (isProd) {
    if (isContractor && barsContractorProd === true) {
      return { decision: "deny" };
    }

    const onCallReadGrant =
      level === "read" &&
      isOnCall &&
      role === "engineer" &&
      oncallReadException === true;

    if (onCallReadGrant) {
      return { decision: "grant" };
    }

    if (isContractor && barsContractorProd === "uncertain") {
      return { decision: "abstain" };
    }

    if (prodNeedsSecurity === true) return { decision: "needs_approval" };
    if (prodNeedsSecurity === false) return { decision: "abstain" };
    return { decision: "abstain" };
  }

  // Non-production.
  if (level === "read") {
    if (nonprodReadFree === true) return { decision: "grant" };
    if (nonprodReadFree === false) return { decision: "needs_approval" };
    return { decision: "abstain" };
  }

  if (level === "write") {
    if (nonprodWriteNeedsManager === true) return { decision: "needs_approval" };
    if (nonprodWriteNeedsManager === false) return { decision: "grant" };
    return { decision: "abstain" };
  }

  return { decision: "abstain" };
}
