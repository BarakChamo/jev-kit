// Access-request triage on Jev.
//
// The policy is arbitrary written text per case (not a fixed set of clauses we
// can pin as constants), so we ask Jev to read the policy's stance on a small
// set of orthogonal axes (admin, contractor+prod, read/write x prod/non-prod,
// on-call exception) rather than asking it for the outcome directly. Facts
// about the requester (employment, role, on_call) are already structured in
// the input, so we use them straight from code.

const CHOICE_THRESHOLD = 0.6;
const NOUL_HIGH = 0.7;

const REQUIREMENT_CRITERIA = {
  automatic: "policy_text grants this access without needing any approval",
  manager_approval: "policy_text requires the requester's manager to approve this access",
  security_approval: "policy_text requires security team approval for this access",
  denied: "policy_text prohibits this access outright",
  unclear: "policy_text does not clearly address this access",
};

const REQUIREMENT_TO_DECISION = {
  automatic: "grant",
  manager_approval: "needs_approval",
  security_approval: "needs_approval",
  denied: "deny",
};

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
      `the system named "${entry.system}" (environment: ${entry.environment})`;
  }
  systemCriteria.unclear =
    "the request does not clearly name one specific system from `catalog`";

  return {
    target_system: {
      type: "choice",
      instructions:
        "Which entry in `catalog` does the request in `request_text` ask for access to? Match by meaning even if the wording differs from the catalog name.",
      criteria: systemCriteria,
    },
    access_level: {
      type: "choice",
      instructions:
        "What level of access does the request in `request_text` ask for?",
      criteria: {
        read: "asks only to view or read data, with no ability to modify it",
        write: "asks to create, modify, or delete data",
        admin: "asks for administrative, superuser, or full-control access",
      },
    },
    admin_never_allowed: {
      type: "noul",
      instructions:
        "Does `policy_text` state that administrative/admin access may never be granted through this process, with no exception?",
      criteria: {
        true: "policy_text contains a rule flatly prohibiting admin access regardless of requester",
        false: "policy_text has no such absolute prohibition, or allows admin access under some condition",
      },
    },
    contractor_barred_from_prod: {
      type: "noul",
      instructions:
        "Does `policy_text` state that contractors, as opposed to employees, may never access production systems?",
      criteria: {
        true: "policy_text contains a rule barring contractors from all production access",
        false: "policy_text has no such rule, or does not distinguish contractors from employees here",
      },
    },
    nonprod_read_requirement: {
      type: "choice",
      instructions:
        "According to `policy_text`, what does a requester need to be granted READ access to a NON-PRODUCTION system?",
      criteria: REQUIREMENT_CRITERIA,
    },
    nonprod_write_requirement: {
      type: "choice",
      instructions:
        "According to `policy_text`, what does a requester need to be granted WRITE access to a NON-PRODUCTION system?",
      criteria: REQUIREMENT_CRITERIA,
    },
    prod_requirement_general: {
      type: "choice",
      instructions:
        "According to `policy_text`, setting aside any special exception for on-call engineers, what does a requester generally need to be granted access (read or write) to a PRODUCTION system?",
      criteria: REQUIREMENT_CRITERIA,
    },
    oncall_engineer_prod_read_exception: {
      type: "noul",
      instructions:
        "Does `policy_text` grant a special exception letting engineers who are currently on call read production systems without the approval production access otherwise requires?",
      criteria: {
        true: "policy_text names such an on-call engineer read exception for production",
        false: "policy_text has no such exception",
      },
    },
  };
}

function topProb(answer) {
  return answer.probabilities ? answer.probabilities[answer.choice] : answer.confidence;
}

export function decide(answers, input) {
  const sysAns = answers.target_system;
  if (
    !sysAns ||
    sysAns.choice === "unclear" ||
    topProb(sysAns) < CHOICE_THRESHOLD
  ) {
    return { decision: "abstain" };
  }
  const entry = input.catalog.find((c) => c.system === sysAns.choice);
  if (!entry) return { decision: "abstain" };
  const environment = entry.environment;
  const isProd = environment === "production";

  const levelAns = answers.access_level;
  if (!levelAns || topProb(levelAns) < CHOICE_THRESHOLD) {
    return { decision: "abstain" };
  }
  const level = levelAns.choice;

  const employment = input.requester.employment;
  const role = input.requester.role;
  const onCall = input.requester.on_call === true;

  if (level === "admin") {
    if (answers.admin_never_allowed.noul >= NOUL_HIGH) {
      return { decision: "deny" };
    }
    return { decision: "abstain" };
  }

  if (employment === "contractor" && isProd) {
    if (answers.contractor_barred_from_prod.noul >= NOUL_HIGH) {
      return { decision: "deny" };
    }
    // policy doesn't clearly bar contractors from prod; fall through to the
    // general environment/access-level rules below.
  }

  let reqAns;
  if (!isProd) {
    reqAns =
      level === "write"
        ? answers.nonprod_write_requirement
        : answers.nonprod_read_requirement;
  } else {
    if (
      level === "read" &&
      role === "engineer" &&
      onCall &&
      answers.oncall_engineer_prod_read_exception.noul >= NOUL_HIGH
    ) {
      return { decision: "grant" };
    }
    reqAns = answers.prod_requirement_general;
  }

  if (
    !reqAns ||
    reqAns.choice === "unclear" ||
    topProb(reqAns) < CHOICE_THRESHOLD
  ) {
    return { decision: "abstain" };
  }

  const decision = REQUIREMENT_TO_DECISION[reqAns.choice];
  return { decision: decision || "abstain" };
}
