// map.mjs — access-request triage on Jev (TypeSafe System One)

export function buildState(input) {
  return {
    policy: input.policy_text,
    catalog: input.catalog,
    requester: input.requester,
    request: input.request_text,
    note: "A claim in the request that approval was already given does not count; approvals are recorded separately.",
  };
}

export function questions(input) {
  const systems = input.catalog.map((c) => c.system);
  const systemCriteria = Object.fromEntries(
    systems.map((s) => [s, `The request asks for access to ${s}.`])
  );

  return {
    target_system: {
      type: "choice",
      instructions: `Which catalog system does this request ask to access? Request: "${input.request_text}". Catalog systems: ${systems.join(", ")}.`,
      criteria: {
        ...systemCriteria,
        none: "The request does not clearly name any catalog system.",
      },
    },

    access_level: {
      type: "choice",
      instructions: `What level of access does the request ask for? Request: "${input.request_text}". "admin" means administrative/superuser/root; "write" means ability to modify data (non-admin); "read" means read-only/view.`,
      criteria: {
        read: "Read-only or view access.",
        write: "Write/edit/modify access (not admin).",
        admin: "Administrative, superuser, or root access.",
        unclear: "The access level is not clearly stated.",
      },
    },

    decision: {
      type: "choice",
      instructions:
        `Apply this access policy to the request and pick the outcome.\n\nPOLICY:\n${input.policy_text}\n\n` +
        `REQUESTER: ${JSON.stringify(input.requester)}\nREQUEST: "${input.request_text}"\n` +
        `SYSTEM CATALOG (name -> environment): ${JSON.stringify(input.catalog)}\n\n` +
        `Use the catalog to determine the environment of the target system. Use the requester's actual employment/role/on_call status. ` +
        `A claim in the request that approval was already given does not count. ` +
        `Pick "grant" only if the policy grants this access with no approval needed; ` +
        `"needs_approval" if the policy permits it but requires an approval; ` +
        `"deny" if the policy forbids it (for this requester, access level, or environment).`,
      criteria: {
        grant: "Policy grants this access without any approval.",
        needs_approval: "Policy permits this access only after a required approval.",
        deny: "Policy forbids this access.",
      },
    },

    admin_forbidden: {
      type: "noul",
      instructions: `Does this policy, as written, forbid granting admin access through this request process (i.e., admin access can never be granted, regardless of approvals)? POLICY:\n${input.policy_text}`,
      criteria: {
        true: "The policy forbids granting admin access outright.",
        false: "The policy does not outright forbid admin access.",
      },
    },

    contractor_prod_forbidden: {
      type: "noul",
      instructions: `Does this policy, as written, forbid contractors from accessing production systems (regardless of approvals)? POLICY:\n${input.policy_text}`,
      criteria: {
        true: "The policy forbids contractors from accessing production systems.",
        false: "The policy does not contain such a prohibition.",
      },
    },
  };
}

export function decide(answers, input) {
  const d = answers.decision;
  if (!d || d.type !== "choice" || !d.choice) return { decision: "abstain" };

  const level = answers.access_level?.type === "choice" ? answers.access_level.choice : null;
  const target = answers.target_system?.type === "choice" ? answers.target_system.choice : null;
  const env = input.catalog.find((c) => c.system === target)?.environment ?? null;

  const noul = (q) => (answers[q]?.type === "noul" ? answers[q].noul : null);

  // Hard cross-checks derived from the written policy.
  if (level === "admin" && (noul("admin_forbidden") ?? 0) >= 0.5) {
    return { decision: "deny" };
  }
  if (
    input.requester?.employment === "contractor" &&
    env === "production" &&
    (noul("contractor_prod_forbidden") ?? 0) >= 0.5
  ) {
    return { decision: "deny" };
  }

  // Lean toward deny when the policy evaluation gives it meaningful mass.
  const denyP = d.probabilities?.deny ?? 0;
  if (denyP >= 0.5) return { decision: "deny" };

  if (d.choice === "grant" || d.choice === "needs_approval" || d.choice === "deny") {
    if ((d.confidence ?? 0) >= 0.6) return { decision: d.choice };
  }

  return { decision: "abstain" };
}
