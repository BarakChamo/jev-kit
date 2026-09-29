// Access-request triage on Jev.
//
// Structured facts (employment, role, on_call, catalog environments) come
// straight from input — never asked as questions. Jev is used only for the
// two genuinely free-text extractions (which system / which access level the
// request text asks for) and for reading the handful of yes/no clauses out of
// the policy text. All comparisons, lookups and rule application happen here
// in code.

const CHOICE_MIN_P = 0.6;
const NOUL_TRUE = 0.65;
const NOUL_FALSE = 0.35;

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    catalog: input.catalog,
    requester: input.requester,
    request_text: input.request_text,
  };
}

export function questions(input) {
  const systemCriteria = {};
  for (const entry of input.catalog) {
    systemCriteria[entry.system] =
      `request_text is asking for access to the catalog system named "${entry.system}" (environment: ${entry.environment}), by name or by an unambiguous description of it`;
  }
  systemCriteria.unclear =
    "request_text does not clearly identify exactly one system from `catalog`";

  return {
    system: {
      type: "choice",
      instructions:
        'Which entry in `catalog` is the requester in `request_text` asking to be given access to? Match by system name or by an unambiguous description (e.g. "the billing database" for billing-db). If more than one system is mentioned, or none can be confidently identified, choose unclear.',
      criteria: systemCriteria,
    },
    access_level: {
      type: "choice",
      instructions:
        "What level of access to the system does `request_text` ask for? Base this only on what is explicitly requested.",
      criteria: {
        read: "read-only, view, or query access; no ability to modify data",
        write:
          "ability to create or modify data (read-write), but not full administrative control",
        admin:
          "administrator, superuser, root, or other full administrative control",
        unclear:
          "the requested access level in request_text is not clearly one of read, write, or admin",
      },
    },
    admin_forbidden: {
      type: "noul",
      instructions:
        "Does the policy in `policy_text` state that admin access may never be granted through this request process, for anyone, with no exceptions?",
      criteria: {
        true: "policy_text contains an absolute, exceptionless prohibition on granting admin access this way",
        false: "policy_text contains no such absolute prohibition on admin access",
      },
    },
    contractor_prod_forbidden: {
      type: "noul",
      instructions:
        "Does the policy in `policy_text` state that contractors may never be granted access to production systems?",
      criteria: {
        true: "policy_text bars contractors from all access to production systems",
        false: "policy_text does not contain such a bar on contractor access to production",
      },
    },
    nonprod_read_auto_grant: {
      type: "noul",
      instructions:
        "Does the policy in `policy_text` state that read access to non-production systems is granted without requiring anyone's approval?",
      criteria: {
        true: "policy_text grants read access to non-production systems automatically, with no approval step",
        false: "policy_text does not state that non-production read access is auto-granted",
      },
    },
    nonprod_write_needs_manager_approval: {
      type: "noul",
      instructions:
        "Does the policy in `policy_text` state that write access to non-production systems requires the requester's manager's approval?",
      criteria: {
        true: "policy_text requires the requester's manager to approve write access to non-production systems",
        false: "policy_text does not require manager approval for non-production write access",
      },
    },
    prod_access_needs_security_approval: {
      type: "noul",
      instructions:
        "Does the policy in `policy_text` state that, as a general rule, any access to production systems requires security approval?",
      criteria: {
        true: "policy_text makes security approval the general requirement for production access",
        false: "policy_text does not make security approval the general requirement for production access",
      },
    },
    oncall_engineer_read_prod_exception: {
      type: "noul",
      instructions:
        "Does the policy in `policy_text` state an exception under which read access to production is granted, with no approval needed, specifically to engineers who are currently on call?",
      criteria: {
        true: "policy_text carves out an on-call-engineer exception granting read-only production access without approval",
        false: "policy_text contains no such on-call-engineer exception",
      },
    },
  };
}

function choiceProb(ans) {
  return ans.probabilities?.[ans.choice] ?? ans.confidence ?? 0;
}
function isTrue(ans) {
  return ans.noul >= NOUL_TRUE;
}
function isFalse(ans) {
  return ans.noul <= NOUL_FALSE;
}

export function decide(answers, input) {
  const abstain = { decision: "abstain" };

  const sysAns = answers.system;
  if (sysAns.choice === "unclear" || choiceProb(sysAns) < CHOICE_MIN_P) {
    return abstain;
  }
  const entry = input.catalog.find((e) => e.system === sysAns.choice);
  if (!entry) return abstain;
  const environment = entry.environment;

  const levelAns = answers.access_level;
  if (levelAns.choice === "unclear" || choiceProb(levelAns) < CHOICE_MIN_P) {
    return abstain;
  }
  const level = levelAns.choice;

  const employment = input.requester.employment;
  const role = input.requester.role;
  const onCall = input.requester.on_call === true;

  if (level === "admin") {
    if (isTrue(answers.admin_forbidden)) return { decision: "deny" };
    return abstain;
  }

  const isProd = environment === "production";

  if (isProd && employment === "contractor") {
    const flag = answers.contractor_prod_forbidden;
    if (isTrue(flag)) return { decision: "deny" };
    if (!isFalse(flag)) return abstain;
    // false: policy has no contractor bar, fall through to general production rules
  }

  if (!isProd) {
    if (level === "read") {
      const flag = answers.nonprod_read_auto_grant;
      if (isTrue(flag)) return { decision: "grant" };
      if (isFalse(flag)) return { decision: "needs_approval" };
      return abstain;
    }
    if (level === "write") {
      const flag = answers.nonprod_write_needs_manager_approval;
      if (isTrue(flag)) return { decision: "needs_approval" };
      if (isFalse(flag)) return { decision: "grant" };
      return abstain;
    }
    return abstain;
  }

  // production
  if (level === "read" && role === "engineer" && onCall) {
    const exception = answers.oncall_engineer_read_prod_exception;
    if (isTrue(exception)) return { decision: "grant" };
  }

  const secFlag = answers.prod_access_needs_security_approval;
  if (isTrue(secFlag)) return { decision: "needs_approval" };
  return abstain;
}
