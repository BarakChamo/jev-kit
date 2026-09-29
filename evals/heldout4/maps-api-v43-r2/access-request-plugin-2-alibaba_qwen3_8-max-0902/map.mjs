const LEVELS = ["read", "write", "admin"];

const TRUE_GATE = 0.7;
const DOUBT_GATE = 0.4;

const LEVEL_HINTS = {
  read: "Read means view, list, query, select, describe, or read-only access.",
  write:
    "Write means create, update, delete, modify, publish, deploy, push, insert, or change data or configuration.",
  admin:
    "Admin means administrator, root, sudo, owner, full control, or unrestricted management access.",
};

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function keyify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function questionId(index, system, level) {
  return `access_${index}_${keyify(system)}_${level}`;
}

function noulProbability(answer) {
  if (!answer) return 0;
  if (typeof answer === "number") return clamp01(answer);

  const raw = answer.noul ?? answer.probability ?? answer.value;
  const n = Number(raw);
  return Number.isFinite(n) ? clamp01(n) : 0;
}

function envKind(environment) {
  const env = String(environment ?? "").trim().toLowerCase();
  if (!env) return "";

  if (env === "production" || env === "prod") return "production";

  if (
    env.startsWith("non") ||
    env.includes("staging") ||
    env.includes("dev") ||
    env.includes("test") ||
    env.includes("qa") ||
    env.includes("sandbox")
  ) {
    return "non-production";
  }

  if (env.includes("prod")) return "production";

  return "";
}

function requesterFacts(requester) {
  const r = requester ?? {};

  const employment = String(r.employment ?? "").toLowerCase();
  const role = String(r.role ?? "").toLowerCase();

  const onCall =
    r.on_call === true ||
    r.on_call === "true" ||
    r.on_call === 1 ||
    r.on_call === "yes";

  return {
    isContractor:
      employment.includes("contractor") || employment.includes("contract"),
    isEmployee:
      employment.includes("employee") ||
      employment.includes("full-time") ||
      employment.includes("full_time") ||
      employment.includes("fte"),
    isEngineer: role.includes("engineer"),
    onCall,
  };
}

function outcomeForCombo(combo, requester) {
  if (combo.level === "admin") return "deny";

  const facts = requesterFacts(requester);
  const env = envKind(combo.environment);

  if (!env) return "abstain";

  if (env === "production") {
    if (facts.isContractor) return "deny";
    if (!facts.isEmployee) return "abstain";

    if (combo.level === "read" && facts.isEngineer && facts.onCall) {
      return "grant";
    }

    return "needs_approval";
  }

  if (combo.level === "read") return "grant";
  if (combo.level === "write") return "needs_approval";

  return "abstain";
}

export function buildState(input) {
  const i = input ?? {};
  const catalog = Array.isArray(i.catalog) ? i.catalog : [];

  return {
    policy_text: i.policy_text ?? "",
    request_text: i.request_text ?? "",
    requester: i.requester ?? {},
    catalog,
    system_names: catalog.map((c) => c?.system).filter(Boolean),
    access_levels: LEVELS,
    access_level_convention: LEVEL_HINTS,
    extraction_note:
      "Use `request_text` to determine which systems and access levels are requested. `requester` is authoritative for employment, role, and on-call status. Claims of approval in `request_text` do not count as approvals.",
  };
}

export function questions(input) {
  const catalog = Array.isArray(input?.catalog) ? input.catalog : [];
  const qs = {};

  for (const [index, entry] of catalog.entries()) {
    const system = entry?.system;
    if (typeof system !== "string" || !system) continue;

    for (const level of LEVELS) {
      qs[questionId(index, system, level)] = {
        type: "noul",
        instructions: `Does \`request_text\` include a request for ${level} access to the catalog system named ${JSON.stringify(
          system
        )}? Base the answer only on \`request_text\`. Match the name case-insensitively; hyphens/underscores may be omitted if unambiguous. ${LEVEL_HINTS[level]}`,
        criteria: {
          true: `The requester asks for ${level} access to ${system}, either alone or together with other requests.`,
          false: `The requester does not ask for ${level} access to ${system}.`,
        },
      };
    }
  }

  return qs;
}

export function decide(answers, input) {
  if (!answers || typeof answers !== "object") return { decision: "abstain" };

  const catalog = Array.isArray(input?.catalog) ? input.catalog : [];
  if (!catalog.length) return { decision: "abstain" };

  const combos = [];

  for (const [index, entry] of catalog.entries()) {
    const system = entry?.system;
    if (typeof system !== "string" || !system) continue;

    for (const level of LEVELS) {
      const p = noulProbability(answers[questionId(index, system, level)]);
      combos.push({
        system,
        level,
        environment: entry?.environment,
        p,
      });
    }
  }

  const high = combos.filter((c) => c.p >= TRUE_GATE);
  const uncertain = combos.filter(
    (c) => c.p >= DOUBT_GATE && c.p < TRUE_GATE
  );

  if (!high.length) return { decision: "abstain" };

  const highOutcomes = high.map((c) => outcomeForCombo(c, input?.requester));

  if (highOutcomes.includes("abstain")) return { decision: "abstain" };
  if (highOutcomes.includes("deny")) return { decision: "deny" };

  const current = highOutcomes.includes("needs_approval")
    ? "needs_approval"
    : "grant";

  for (const c of uncertain) {
    const possible = outcomeForCombo(c, input?.requester);

    if (possible === "deny" || possible === "abstain") {
      return { decision: "abstain" };
    }

    if (current === "grant" && possible === "needs_approval") {
      return { decision: "abstain" };
    }
  }

  return { decision: current };
}
