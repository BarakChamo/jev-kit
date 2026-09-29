// Access-request decision map.
//
// Strategy: the written policy is arbitrary text that may vary case to case, so we
// don't hard-code its specific thresholds/approvers. Instead we ask Jev whether each
// of the canonical clause *shapes* shown in the example policy is present (admin ban,
// contractor+production ban, free non-prod read, non-prod write approval, production
// approval + on-call read exception), plus a catch-all for any other relevant clause
// we didn't model. Facts about the request itself (which system, what access level)
// are extracted separately. Everything is then combined deterministically in code.

const TRUE_THRESH = 0.65;
const FALSE_THRESH = 0.35;
const isTrue = (p) => typeof p === "number" && p >= TRUE_THRESH;
const isFalse = (p) => typeof p === "number" && p <= FALSE_THRESH;

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    catalog: input.catalog,
    requester: input.requester,
    request_text: input.request_text,
  };
}

export function questions(input) {
  const requester = input.requester || {};
  const catalog = input.catalog || [];

  const systemOptions = {};
  for (const entry of catalog) {
    systemOptions[entry.system] =
      `The request asks for access to the "${entry.system}" system (environment: ${entry.environment}) listed in \`catalog\`.`;
  }
  systemOptions["multiple"] =
    "The request clearly asks for access to more than one system in `catalog`, or to a whole category of systems.";
  systemOptions["unclear"] =
    "No single system listed in `catalog` is clearly identified as the target of the request.";

  return {
    target_system: {
      type: "choice",
      instructions:
        "Which single system listed in `catalog` does the request in `request_text` ask for access to?",
      criteria: systemOptions,
    },
    access_level: {
      type: "choice",
      instructions:
        "What level of access does `request_text` ask for on the target system?",
      criteria: {
        read: "read-only, view, or query access",
        write: "write, modify, update, or edit access (not full admin)",
        admin: "admin, root, superuser, or full administrative access",
        unclear:
          "the requested access level is not clearly one of read, write, or admin",
      },
    },
    admin_never_allowed: {
      type: "noul",
      instructions:
        "Does `policy_text` state that admin access is never granted through this request process, for anyone?",
      criteria: {
        true: "policy_text bans granting admin access outright",
        false: "policy_text contains no such blanket ban on admin access",
      },
    },
    contractor_prod_banned: {
      type: "noul",
      instructions:
        "Does `policy_text` state that contractors may never be granted access to production systems?",
      criteria: {
        true: "policy_text bans contractor access to production systems",
        false: "policy_text contains no such ban",
      },
    },
    nonprod_read_free: {
      type: "noul",
      instructions:
        "Does `policy_text` state that read access to non-production systems is granted without requiring anyone's approval?",
      criteria: {
        true: "policy_text grants non-production read access with no approval needed",
        false: "policy_text does not say this",
      },
    },
    nonprod_write_needs_approval: {
      type: "noul",
      instructions:
        "Does `policy_text` state that write access to non-production systems requires someone's approval (e.g. a manager) before being granted?",
      criteria: {
        true: "policy_text requires approval for non-production write access",
        false: "policy_text does not say this",
      },
    },
    prod_access_needs_approval: {
      type: "noul",
      instructions:
        "Does `policy_text` state that access to production systems in general requires approval (e.g. security approval) before being granted?",
      criteria: {
        true: "policy_text requires approval for production access as a general rule",
        false: "policy_text does not say this",
      },
    },
    oncall_read_exception: {
      type: "noul",
      instructions: `Does \`policy_text\` grant an exception letting a requester with role "${requester.role}" who is currently on call (on_call: ${requester.on_call}) get read access to a production system without needing approval?`,
      criteria: {
        true: "policy_text grants this specific requester such an on-call exception for production read access",
        false: "policy_text grants no such exception for this requester",
      },
    },
    extra_unhandled_clause: {
      type: "noul",
      instructions:
        "Beyond (a) banning admin access, (b) restricting contractors from production systems, (c) granting free read access to non-production systems, (d) requiring approval for non-production write access, and (e) requiring approval for production access with a possible on-call exception, does `policy_text` contain any OTHER rule, condition, or exception that could change the decision for this specific request (the system, access level, and requester described in the state)?",
      criteria: {
        true: "policy_text has another rule not covered by (a)-(e) that is relevant to this request",
        false: "policy_text has no other rule relevant to this request",
      },
    },
  };
}

export function decide(answers, input) {
  const sys = answers.target_system;
  const acc = answers.access_level;
  if (!sys || !acc) return { decision: "abstain" };

  if (
    sys.choice === "multiple" ||
    sys.choice === "unclear" ||
    (sys.confidence ?? 1) < 0.6
  ) {
    return { decision: "abstain" };
  }
  if (acc.choice === "unclear" || (acc.confidence ?? 1) < 0.6) {
    return { decision: "abstain" };
  }

  const entry = (input.catalog || []).find((c) => c.system === sys.choice);
  if (!entry) return { decision: "abstain" };
  const environment = entry.environment;
  const access = acc.choice;

  const extra = answers.extra_unhandled_clause?.noul;
  if (isTrue(extra)) return { decision: "abstain" };

  if (access === "admin") {
    return isTrue(answers.admin_never_allowed?.noul)
      ? { decision: "deny" }
      : { decision: "abstain" };
  }

  const employment = input.requester?.employment;
  if (employment === "contractor" && environment === "production") {
    const banned = answers.contractor_prod_banned?.noul;
    if (isTrue(banned)) return { decision: "deny" };
    if (!isFalse(banned)) return { decision: "abstain" };
    // explicitly false: no contractor-specific ban, fall through to production rules below
  }

  if (environment !== "production") {
    if (access === "read") {
      return isTrue(answers.nonprod_read_free?.noul)
        ? { decision: "grant" }
        : { decision: "abstain" };
    }
    if (access === "write") {
      return isTrue(answers.nonprod_write_needs_approval?.noul)
        ? { decision: "needs_approval" }
        : { decision: "abstain" };
    }
    return { decision: "abstain" };
  }

  // production
  const onCall = input.requester?.on_call === true;
  if (
    access === "read" &&
    onCall &&
    isTrue(answers.oncall_read_exception?.noul)
  ) {
    return { decision: "grant" };
  }
  return isTrue(answers.prod_access_needs_approval?.noul)
    ? { decision: "needs_approval" }
    : { decision: "abstain" };
}
