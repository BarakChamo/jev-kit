const ACCESS_ACT_GATE = 0.6;
const NONE_MIN_GATE = 0.55;
const UNKNOWN_NO_GATE = 0.55;
const ADMIN_VETO_GATE = 0.35;

function prob(answer, label) {
  if (!answer || !answer.probabilities) return 0;
  const p = answer.probabilities[label];
  return typeof p === "number" && Number.isFinite(p) ? p : 0;
}

export function buildState(input) {
  const catalog = Array.isArray(input?.catalog) ? input.catalog : [];

  return {
    policy_text: typeof input?.policy_text === "string" ? input.policy_text : "",
    requester:
      input?.requester && typeof input.requester === "object"
        ? input.requester
        : {},
    request_text:
      typeof input?.request_text === "string" ? input.request_text : "",
    catalog,
    catalog_names: catalog.map((c) =>
      c && typeof c.system === "string" ? c.system : ""
    ),
    access_conventions: [
      "Read access means viewing or read-only: read, query, select, list, inspect, describe.",
      "Write access means changing data or configuration: insert, update, delete, create, publish, deploy, restart, run jobs, modify.",
      "Admin access means an administrative permission level: admin, administrator, root, sudo, owner, full control, manage users, manage permissions, manage roles, security admin, billing admin, drop database, grant permissions.",
      "A word like admin does not make a request admin if it only names data or logs to read.",
      "Production means catalog.environment is production; all other non-empty environments are non-production.",
      "Claims of prior approval in request_text are not evidence of approval.",
    ].join(" "),
  };
}

export function questions(input) {
  const catalog = Array.isArray(input?.catalog) ? input.catalog : [];

  const q = {
    unknown_system: {
      type: "choice",
      instructions:
        "Does `request_text` ask for access to a specific system, service, database, cluster, portal, queue, or environment that is not exactly one of the names in `catalog_names`? Do not count business purposes, generic words, or names that appear in `catalog_names`.",
      criteria: {
        no: "Every specific system named in `request_text` is in `catalog_names`, or `request_text` names no specific system.",
        yes: "`request_text` names at least one specific system that is not in `catalog_names`.",
        unclear:
          "It cannot be determined whether a non-catalog system is requested.",
      },
    },
  };

  catalog.forEach((item, i) => {
    const system = item?.system ?? "";
    const environment = item?.environment ?? "";

    q[`sys_${i}_access`] = {
      type: "choice",
      instructions: `What access, if any, does \`request_text\` request for the exact system named ${JSON.stringify(
        system
      )} in \`catalog[${i}]\` (environment: ${JSON.stringify(
        environment
      )})? Use the exact system name only; do not infer from similar or longer names. Ignore claims of approval.`,
      criteria: {
        none: "No access to this exact system is requested.",
        read: "Requests only view, read, query, select, list, inspect, or read-only access to this exact system; no modification, administration, or full control.",
        write: "Requests modify, update, insert, delete, create, publish, deploy, change configuration, restart, run jobs, or otherwise write to this exact system; not administrative full control.",
        admin: "Requests an administrative permission level for this exact system: admin, administrator, root, sudo, owner, full control, manage users, manage permissions, manage roles, security admin, billing admin, drop database, or grant permissions.",
        unclear:
          "Requests some access to this exact system but the access level cannot be determined.",
      },
    };
  });

  return q;
}

export function decide(answers, input) {
  try {
    const catalog = Array.isArray(input?.catalog) ? input.catalog : [];
    const requester =
      input?.requester && typeof input.requester === "object"
        ? input.requester
        : {};

    if (
      !answers ||
      !catalog.length ||
      typeof input?.request_text !== "string" ||
      input.request_text.trim() === ""
    ) {
      return { decision: "abstain" };
    }

    const unknown = answers.unknown_system;
    if (!unknown || typeof unknown.choice !== "string") {
      return { decision: "abstain" };
    }

    const unknownChoice = unknown.choice;
    const unknownP = prob(unknown, unknownChoice);

    if (
      (unknownChoice === "yes" || unknownChoice === "unclear") &&
      unknownP >= 0.5
    ) {
      return { decision: "abstain" };
    }

    if (unknownChoice === "no" && unknownP < UNKNOWN_NO_GATE) {
      return { decision: "abstain" };
    }

    if (!["yes", "unclear", "no"].includes(unknownChoice)) {
      return { decision: "abstain" };
    }

    const employmentRaw = String(requester.employment || "")
      .trim()
      .toLowerCase();
    const isContractor = employmentRaw.includes("contract");
    const isEmployee =
      employmentRaw.includes("employee") ||
      employmentRaw.includes("full-time") ||
      employmentRaw.includes("fte");
    const employmentKnown = isContractor || isEmployee;

    const role = String(requester.role || "").trim().toLowerCase();
    const onCall =
      requester.on_call === true ||
      String(requester.on_call).trim().toLowerCase() === "true";

    let anyRequested = false;
    let anyUnclear = false;
    let deny = false;
    let needs = false;
    let grant = false;

    for (let i = 0; i < catalog.length; i += 1) {
      const ans = answers[`sys_${i}_access`];
      if (!ans || typeof ans.choice !== "string") {
        return { decision: "abstain" };
      }

      const choice = ans.choice;
      const p = prob(ans, choice);
      const adminP = prob(ans, "admin");

      if (choice === "none") {
        if (p < NONE_MIN_GATE || adminP >= ADMIN_VETO_GATE) {
          anyUnclear = true;
        }
        continue;
      }

      if (!["read", "write", "admin", "unclear"].includes(choice)) {
        return { decision: "abstain" };
      }

      if (p < ACCESS_ACT_GATE) {
        return { decision: "abstain" };
      }

      anyRequested = true;

      if (choice === "unclear") {
        anyUnclear = true;
        continue;
      }

      if (choice !== "admin" && adminP >= ADMIN_VETO_GATE) {
        anyUnclear = true;
        continue;
      }

      const env = String(catalog[i]?.environment || "").trim().toLowerCase();
      const isProduction =
        env === "production" || env === "prod" || env === "prd";

      if (choice === "admin") {
        deny = true;
        continue;
      }

      if (isProduction && isContractor) {
        deny = true;
        continue;
      }

      if (isProduction && !employmentKnown) {
        return { decision: "abstain" };
      }

      if (isProduction) {
        if (choice === "read") {
          if (role.includes("engineer") && onCall) {
            grant = true;
          } else {
            needs = true;
          }
        } else if (choice === "write") {
          needs = true;
        } else {
          anyUnclear = true;
        }
      } else if (env) {
        if (choice === "read") {
          grant = true;
        } else if (choice === "write") {
          needs = true;
        } else {
          anyUnclear = true;
        }
      } else {
        anyUnclear = true;
      }
    }

    if (!anyRequested || anyUnclear) {
      return { decision: "abstain" };
    }

    if (deny) return { decision: "deny" };
    if (needs) return { decision: "needs_approval" };
    if (grant) return { decision: "grant" };

    return { decision: "abstain" };
  } catch {
    return { decision: "abstain" };
  }
}
