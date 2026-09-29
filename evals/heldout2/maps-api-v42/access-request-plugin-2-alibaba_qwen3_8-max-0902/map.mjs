const ACTION_GATE = 0.7;
const ADMIN_GATE = 0.75;
const MULTIPLE_GATE = 0.5;
const UNCLEAR_SYSTEM = "unclear_system";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function prob(answer, choice) {
  if (!answer || typeof choice !== "string") return 0;
  const p = answer.probabilities?.[choice];
  if (typeof p === "number" && Number.isFinite(p)) return p;
  const c = answer.confidence;
  return typeof c === "number" && Number.isFinite(c) ? c : 0;
}

function noulProb(answer) {
  return typeof answer?.noul === "number" && Number.isFinite(answer.noul)
    ? answer.noul
    : 0;
}

function truthy(value) {
  return value === true || value === 1 || value === "true" || value === "yes" || value === "on";
}

function employmentFacts(requester) {
  const text = String(requester?.employment ?? "").toLowerCase();
  const contractor = /contract/.test(text);
  const employee = !contractor && /employee|full[-\s]?time|internal|fte/.test(text);
  return { contractor, employee };
}

function isEngineer(role) {
  return /engineer/i.test(String(role ?? ""));
}

function isProduction(environment) {
  const e = String(environment ?? "").trim().toLowerCase();
  return e === "production" || e === "prod";
}

function systemOptions(input) {
  const catalog = asArray(input?.catalog);
  const counts = new Map();

  for (const entry of catalog) {
    const name = entry?.system;
    if (typeof name === "string" && name) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  const seen = new Set();
  const options = [];

  catalog.forEach((entry, i) => {
    const name = entry?.system;
    if (typeof name !== "string" || !name) return;

    let key = counts.get(name) > 1
      ? `${name} (${String(entry?.environment ?? "unknown")})`
      : name;

    if (seen.has(key)) key = `${key} #${i}`;
    seen.add(key);

    options.push({ key, environment: entry?.environment });
  });

  return options;
}

export function buildState(input) {
  return {
    policy_text: input?.policy_text ?? "",
    catalog: asArray(input?.catalog),
    requester: input?.requester ?? {},
    request_text: input?.request_text ?? "",
  };
}

export function questions(input) {
  const systemCriteria = {};

  for (const { key, environment } of systemOptions(input)) {
    systemCriteria[key] = `environment: ${environment ?? "unknown"}`;
  }

  systemCriteria[UNCLEAR_SYSTEM] =
    "No single system from `catalog` is clearly requested, more than one system is requested, or the named system is not in `catalog`.";

  return {
    requested_system: {
      type: "choice",
      instructions:
        "Which one system option from `catalog` is the requester asking to access in `request_text`? Choose the option key that matches the requested system. If the answer is not one clear system option, choose unclear_system.",
      criteria: systemCriteria,
    },
    access_level: {
      type: "choice",
      instructions:
        "What access level does `request_text` ask for? If it asks for read and write, choose write. If it asks for admin and any other level, choose admin.",
      criteria: {
        read: "view, query, select, read-only, or inspect without changing anything",
        write: "create, update, delete, modify, publish, deploy, or otherwise change data, code, or configuration",
        admin: "administrative, root, sudo, owner, full control, user management, or security administration",
        unclear: "the access level is not stated or cannot be determined from `request_text`",
      },
    },
    includes_admin: {
      type: "noul",
      instructions:
        "Does `request_text` include any request for administrative, root, sudo, owner, full-control, user-management, or security-admin access, even alongside other access?",
      criteria: {
        true: "`request_text` asks for any admin-like access",
        false: "`request_text` does not ask for admin-like access",
      },
    },
    asks_multiple_systems: {
      type: "noul",
      instructions:
        "Does `request_text` ask for access to more than one distinct system? Separate entries in `catalog` are distinct systems.",
      criteria: {
        true: "`request_text` asks for two or more systems",
        false: "`request_text` asks for at most one system",
      },
    },
  };
}

export function decide(answers, input) {
  const a = answers ?? {};

  const accessChoice = typeof a.access_level?.choice === "string" ? a.access_level.choice : "";
  const accessProb = prob(a.access_level, accessChoice);

  if (accessChoice === "admin" && accessProb >= ACTION_GATE) {
    return { decision: "deny" };
  }

  if (noulProb(a.includes_admin) >= ADMIN_GATE) {
    return { decision: "deny" };
  }

  if (noulProb(a.asks_multiple_systems) > MULTIPLE_GATE) {
    return { decision: "abstain" };
  }

  const systemChoice = typeof a.requested_system?.choice === "string" ? a.requested_system.choice : "";
  const systemProb = prob(a.requested_system, systemChoice);

  if (!systemChoice || systemChoice === UNCLEAR_SYSTEM || systemProb < ACTION_GATE) {
    return { decision: "abstain" };
  }

  const option = systemOptions(input).find((o) => o.key === systemChoice);
  if (!option || typeof option.environment !== "string" || !option.environment.trim()) {
    return { decision: "abstain" };
  }

  if (!accessChoice || accessChoice === "unclear" || accessProb < ACTION_GATE) {
    return { decision: "abstain" };
  }

  if (accessChoice === "admin") {
    return { decision: "deny" };
  }

  const { contractor, employee } = employmentFacts(input?.requester);
  if (!contractor && !employee) {
    return { decision: "abstain" };
  }

  if (isProduction(option.environment)) {
    if (contractor) {
      return { decision: "deny" };
    }

    if (accessChoice === "read") {
      if (employee && isEngineer(input?.requester?.role) && truthy(input?.requester?.on_call)) {
        return { decision: "grant" };
      }
      return { decision: "needs_approval" };
    }

    if (accessChoice === "write") {
      return { decision: "needs_approval" };
    }

    return { decision: "abstain" };
  }

  if (accessChoice === "read") {
    return { decision: "grant" };
  }

  if (accessChoice === "write") {
    return { decision: "needs_approval" };
  }

  return { decision: "abstain" };
}
