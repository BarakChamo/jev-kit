function lower(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function catalogMap(input) {
  const map = new Map();
  for (const entry of input?.catalog ?? []) {
    const system = lower(entry?.system);
    if (system && !map.has(system)) map.set(system, entry);
  }
  return map;
}

export function buildState(input) {
  const catalog = Array.isArray(input?.catalog) ? input.catalog : [];

  return {
    policy_text: input?.policy_text ?? "",
    request_text: input?.request_text ?? "",
    requester: input?.requester ?? {},
    catalog,
    environmentBySystem: Object.fromEntries(
      catalog
        .filter((entry) => entry && typeof entry.system === "string")
        .map((entry) => [entry.system, entry.environment ?? null])
    ),
  };
}

export function questions(input) {
  const catalog = Array.isArray(input?.catalog) ? input.catalog : [];
  const requestText = JSON.stringify(input?.request_text ?? "");

  const systemCriteria = {};
  const seen = new Set();

  for (const entry of catalog) {
    const system = typeof entry?.system === "string" ? entry.system : "";
    if (!system || seen.has(system)) continue;

    seen.add(system);
    systemCriteria[system] = `Catalog system ${system}${
      entry?.environment ? ` in ${entry.environment}` : ""
    }.`;

    if (seen.size >= 253) break;
  }

  systemCriteria.multiple =
    "The request asks for more than one distinct catalog system.";
  systemCriteria.unknown =
    "No single catalog system can be identified from the request.";

  return {
    system: {
      type: "choice",
      instructions: `Identify the single internal system being requested in ${requestText}. Choose the exact catalog system name. You may match reasonable aliases, abbreviations, and environment qualifiers to the closest catalog system. If multiple systems are requested, choose multiple. If none or ambiguous, choose unknown.`,
      criteria: systemCriteria,
    },
    access: {
      type: "choice",
      instructions: `Determine the requested access level in ${requestText}. Ignore any statement that approval was already given. If several levels are requested, choose the most privileged.`,
      criteria: {
        read: "Read-only, view, query, select, describe, list, or monitor without modification.",
        write: "Create, update, delete, insert, publish, deploy, or otherwise modify.",
        admin: "Admin, root, sudo, owner, full control, or permission management.",
        unknown: "The requested access level cannot be determined.",
      },
    },
  };
}

export function decide(answers, input) {
  const systemChoice = lower(answers?.system?.choice);
  const accessChoice = lower(answers?.access?.choice);

  if (accessChoice === "admin") {
    return { decision: "deny" };
  }

  if (
    !systemChoice ||
    !accessChoice ||
    systemChoice === "multiple" ||
    systemChoice === "unknown" ||
    accessChoice === "unknown"
  ) {
    return { decision: "abstain" };
  }

  const entry = catalogMap(input).get(systemChoice);
  const environment = lower(entry?.environment);

  if (!entry || !environment) {
    return { decision: "abstain" };
  }

  const requester = input?.requester ?? {};
  const employment = lower(requester.employment);
  const role = lower(requester.role);
  const onCall =
    requester.on_call === true ||
    lower(String(requester.on_call)) === "true";

  const production = environment.startsWith("prod");
  const contractor = employment.includes("contractor");
  const engineer = role.includes("engineer");

  if (production && contractor) {
    return { decision: "deny" };
  }

  if (production) {
    if (accessChoice === "read" && engineer && onCall) {
      return { decision: "grant" };
    }
    return { decision: "needs_approval" };
  }

  if (accessChoice === "read") {
    return { decision: "grant" };
  }

  if (accessChoice === "write") {
    return { decision: "needs_approval" };
  }

  return { decision: "abstain" };
}
