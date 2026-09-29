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
  for (const item of (input.catalog || [])) {
    systemCriteria[item.system] = `the system "${item.system}" (${item.environment} environment)`;
  }
  systemCriteria.none_or_other = "a system not listed in the catalog, or no specific system is named";
  systemCriteria.ambiguous = "multiple systems are requested or the target system is genuinely unclear";

  return {
    target_system: {
      type: "choice",
      instructions: "Which system from `catalog` is requested in `request_text`?",
      criteria: systemCriteria,
    },
    access_level: {
      type: "choice",
      instructions: "What level of access to the system is requested in `request_text`?",
      criteria: {
        read: "strictly read-only, query, view, fetch, or inspect access without write or modify permissions",
        write: "write, edit, modify, update, insert, deploy, or delete permissions (including read/write access), without admin privileges",
        admin: "administrative, root, superuser, or full management privileges",
        ambiguous: "the access level is unspecified, unclear, or genuinely open to multiple interpretations",
      },
    },
    includes_admin: {
      type: "noul",
      instructions: "Does the request in `request_text` include any request for admin, root, superuser, or administrative privileges, even as part of a larger request?",
      criteria: {
        true: "the text requests or includes administrative, root, superuser, or elevated privileges",
        false: "no administrative, root, or superuser privileges are requested",
      },
    },
  };
}

export function decide(answers, input) {
  if (!answers || !input) {
    return { decision: "abstain" };
  }

  // 1. Admin check (Rule 1: Nobody may be granted admin access through this form)
  const adminNoul = answers.includes_admin?.noul ?? 0;
  if (adminNoul >= 0.7) {
    return { decision: "deny" };
  }
  if (adminNoul >= 0.35) {
    return { decision: "abstain" };
  }

  // 2. Access level check
  const accessChoice = answers.access_level?.choice;
  const accessProb = answers.access_level?.probabilities?.[accessChoice] ?? answers.access_level?.confidence ?? 0;
  if (!accessChoice || accessChoice === "ambiguous" || accessProb < 0.7) {
    return { decision: "abstain" };
  }
  if (accessChoice === "admin") {
    return { decision: "deny" };
  }
  if (accessChoice !== "read" && accessChoice !== "write") {
    return { decision: "abstain" };
  }

  // 3. Target system check
  const systemChoice = answers.target_system?.choice;
  const systemProb = answers.target_system?.probabilities?.[systemChoice] ?? answers.target_system?.confidence ?? 0;
  if (!systemChoice || systemChoice === "none_or_other" || systemChoice === "ambiguous" || systemProb < 0.7) {
    return { decision: "abstain" };
  }

  const catalogEntry = (input.catalog || []).find((c) => c.system === systemChoice);
  if (!catalogEntry) {
    return { decision: "abstain" };
  }

  // 4. Requester profile check
  const requester = input.requester;
  if (!requester || typeof requester !== "object") {
    return { decision: "abstain" };
  }

  const employment = (requester.employment || "").toLowerCase().trim();
  const role = (requester.role || "").toLowerCase().trim();
  const onCall = Boolean(requester.on_call);

  const isContractor = employment === "contractor";
  const isEmployee = employment === "employee";
  if (!isContractor && !isEmployee) {
    return { decision: "abstain" };
  }

  const isEngineer = role === "engineer";
  const isProduction = (catalogEntry.environment || "").toLowerCase().trim() === "production";

  // 5. Evaluate policy rules
  // Rule 2: Contractors may never access production systems.
  if (isContractor && isProduction) {
    return { decision: "deny" };
  }

  // Non-production systems:
  // Rule 3: Read access to non-production systems is granted without approval.
  // Rule 4: Write access to non-production systems needs the requester's manager's approval.
  if (!isProduction) {
    if (accessChoice === "read") {
      return { decision: "grant" };
    }
    if (accessChoice === "write") {
      return { decision: "needs_approval" };
    }
  }

  // Production systems:
  // Rule 5: Any access to production systems needs security approval,
  // except read access to production for engineers who are currently on call, which is granted.
  if (isProduction) {
    if (accessChoice === "read" && isEngineer && onCall) {
      return { decision: "grant" };
    }
    return { decision: "needs_approval" };
  }

  return { decision: "abstain" };
}
