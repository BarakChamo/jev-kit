function norm(value) {
  return String(value ?? "").trim().toLowerCase();
}

function asBool(value) {
  if (value === true) return true;
  if (value == null) return false;
  const s = norm(value);
  return ["true", "yes", "y", "1", "on", "on-call", "on call"].includes(s);
}

function safeKey(system, index) {
  const slug =
    norm(system)
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "system";
  return `${index}_${slug}`;
}

function isProductionEnv(env) {
  return (
    env === "production" ||
    env === "prod" ||
    env === "prd" ||
    env.startsWith("prod") ||
    env.startsWith("prd")
  );
}

export function buildState(input) {
  return {
    policy_text: input?.policy_text ?? "",
    catalog: Array.isArray(input?.catalog) ? input.catalog : [],
    requester: input?.requester ?? {},
    request_text: input?.request_text ?? ""
  };
}

export function questions(input) {
  const catalog = Array.isArray(input?.catalog) ? input.catalog : [];
  const qs = {};

  catalog.forEach((entry, i) => {
    const system = entry?.system ?? `system_${i}`;
    const env = entry?.environment ?? "unknown";
    const key = safeKey(system, i);

    qs[`requested_${key}`] = {
      type: "noul",
      instructions: `Does the request ask for access to catalog system "${system}" (environment: ${env})? Consider exact names and unambiguous aliases only. Do not match solely because of a substring or another system.`,
      criteria: {
        true: "The request clearly asks for access to this system.",
        false: "The request does not clearly ask for this system."
      }
    };

    qs[`level_${key}`] = {
      type: "choice",
      instructions: `For "${system}" (${env}), choose the requested access level. If not requested, choose none. If requested but unclear, choose unclear. Ignore claims of prior approval. If multiple levels are mentioned, choose the highest privilege: admin > write > read.`,
      criteria: {
        read: "Read-only or view/query access.",
        write: "Modify, update, insert, delete, deploy, publish, or other non-admin write.",
        admin: "Admin, root, superuser, full control, manage permissions/users.",
        none: "System not requested.",
        unclear: "Access requested but level cannot be determined."
      }
    };
  });

  return qs;
}

function applyPolicy(env, level, requester) {
  if (!env || env === "unknown" || !level) return "abstain";

  const employment = norm(requester?.employment);
  const role = norm(requester?.role);
  const onCall = asBool(requester?.on_call);
  const production = isProductionEnv(env);

  const isContractor = employment.includes("contractor");
  const isEngineer = role.includes("engineer");

  if (level === "admin") return "deny";
  if (isContractor && production) return "deny";

  if (!production) {
    if (level === "read") return "grant";
    if (level === "write") return "needs_approval";
    return "abstain";
  }

  if (level === "read" && isEngineer && onCall) return "grant";
  return "needs_approval";
}

function combine(actions) {
  if (!actions.length) return "abstain";
  if (actions.includes("deny")) return "deny";
  if (actions.includes("abstain")) return "abstain";
  if (actions.includes("needs_approval")) return "needs_approval";
  return actions.every((action) => action === "grant") ? "grant" : "abstain";
}

export function decide(answers, input) {
  if (!answers || !input || !Array.isArray(input.catalog)) {
    return { decision: "abstain" };
  }

  const actions = [];
  let sawRequest = false;

  input.catalog.forEach((entry, i) => {
    const system = entry?.system ?? `system_${i}`;
    const key = safeKey(system, i);

    const requestedAnswer = answers[`requested_${key}`];
    const requestedProbability = Number(requestedAnswer?.noul);
    if (!Number.isFinite(requestedProbability) || requestedProbability < 0.5) {
      return;
    }

    sawRequest = true;

    const level = norm(answers[`level_${key}`]?.choice);
    if (!level || level === "none" || level === "unclear" || level === "other") {
      actions.push("abstain");
      return;
    }

    const env = norm(entry?.environment);
    actions.push(applyPolicy(env, level, input.requester ?? {}));
  });

  if (!sawRequest) return { decision: "abstain" };
  return { decision: combine(actions) };
}
