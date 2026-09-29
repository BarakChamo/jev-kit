const SYSTEM_AMBIGUOUS = "__system_ambiguous__";
const ACCESS_AMBIGUOUS = "__access_ambiguous__";
const GATE = 0.8;

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    catalog: input.catalog,
    requester: input.requester,
    request_text: input.request_text,
  };
}

export function questions(input) {
  const catalog = Array.isArray(input.catalog) ? input.catalog : [];

  const systemCriteria = {};
  for (const entry of catalog) {
    if (!entry || entry.system == null) continue;
    const id = String(entry.system);
    systemCriteria[id] = `${id} (${entry.environment ?? "unknown environment"})`;
  }

  systemCriteria[SYSTEM_AMBIGUOUS] =
    "the request does not name exactly one system in `catalog`";

  return {
    requested_system: {
      type: "choice",
      instructions: "Which single system named in `catalog` does `request_text` ask access to? Choose `__system_ambiguous__` if the request names no catalog system, names multiple systems, or is unclear about the system.",
      criteria: systemCriteria,
    },
    access_type: {
      type: "choice",
      instructions: "What kind of access does `request_text` ask for? Choose `__access_ambiguous__` if the request does not state one level clearly, or asks for multiple levels.",
      criteria: {
        read: "read-only, view, query, list, export, or otherwise see data",
        write: "write, edit, update, delete, create, modify, or otherwise change data or configuration",
        admin: "admin, administrator, root, owner, full control, or ability to manage the system and its permissions",
        [ACCESS_AMBIGUOUS]: "the request does not state one level clearly, or asks for multiple levels",
      },
    },
  };
}

export function decide(answers, input) {
  const systemAnswer = answers?.requested_system;
  const accessAnswer = answers?.access_type;

  if (!systemAnswer?.choice || !accessAnswer?.choice) {
    return { decision: "abstain" };
  }

  const systemChoice = systemAnswer.choice;
  const accessChoice = accessAnswer.choice;

  if (systemChoice === SYSTEM_AMBIGUOUS || accessChoice === ACCESS_AMBIGUOUS) {
    return { decision: "abstain" };
  }

  const systemP = systemAnswer.probabilities?.[systemChoice];
  const accessP = accessAnswer.probabilities?.[accessChoice];

  if (typeof systemP !== "number" || typeof accessP !== "number") {
    return { decision: "abstain" };
  }

  if (systemP < GATE || accessP < GATE) {
    return { decision: "abstain" };
  }

  const catalog = Array.isArray(input?.catalog) ? input.catalog : [];
  const system = catalog.find(
    (entry) => entry && String(entry.system) === systemChoice,
  );

  if (!system?.environment) {
    return { decision: "abstain" };
  }

  const environment = String(system.environment).toLowerCase();
  const employment = String(input?.requester?.employment ?? "").toLowerCase();
  const role = String(input?.requester?.role ?? "").toLowerCase();
  const onCall = input?.requester?.on_call === true;

  // Policy rule 1: nobody gets admin access through this form.
  if (accessChoice === "admin") {
    return { decision: "deny" };
  }

  if (accessChoice !== "read" && accessChoice !== "write") {
    return { decision: "abstain" };
  }

  if (employment !== "employee" && employment !== "contractor") {
    return { decision: "abstain" };
  }

  const isProduction = environment === "production";

  // Policy rule 2: contractors may never access production systems.
  if (employment === "contractor" && isProduction) {
    return { decision: "deny" };
  }

  if (isProduction) {
    if (accessChoice === "read") {
      // Policy rule 5 exception: read production is granted for on-call engineers.
      if (employment === "employee" && role === "engineer" && onCall) {
        return { decision: "grant" };
      }
      return { decision: "needs_approval" };
    }
    // Policy rule 5: any other production access needs security approval.
    return { decision: "needs_approval" };
  }

  // Policy rule 3: read access to non-production is granted.
  if (accessChoice === "read") {
    return { decision: "grant" };
  }

  // Policy rule 4: write access to non-production needs manager approval.
  return { decision: "needs_approval" };
}
