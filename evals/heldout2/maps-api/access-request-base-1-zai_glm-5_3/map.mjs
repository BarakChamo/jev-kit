// map.mjs — access-request triage on Jev (TypeSafe System One).
// Single parallel pass: one decision question (self-contained, reads the whole
// case from state) plus cross-check questions (system, level, clarity) used to
// gate the decision in decide().

const MAX_SYSTEM_OPTIONS = 253; // choice limit is 255; reserve 2 slots below

export function buildState(input) {
  return {
    policy_text: input.policy_text ?? "",
    catalog: input.catalog ?? [],
    requester: input.requester ?? {},
    request_text: input.request_text ?? "",
  };
}

export function questions(input) {
  const systems = [...new Set((input.catalog ?? [])
    .map(c => c && c.system).filter(Boolean))].slice(0, MAX_SYSTEM_OPTIONS);

  const systemCriteria = {};
  for (const s of systems) {
    systemCriteria[s] = `The request asks for access to the catalog system "${s}".`;
  }
  systemCriteria.not_in_catalog = "The request asks for a system that is not listed in the catalog.";
  systemCriteria.unclear = "The requested system cannot be determined from the request text.";

  return {
    decision: {
      type: "choice",
      instructions:
        "Decide an access request. Use the access policy in state.policy_text, the system catalog in state.catalog, " +
        "the requester record in state.requester, and the free-text request in state.request_text. " +
        "First determine which catalog system is requested and what access level is requested " +
        "(access levels are ordered read-only < write < admin: read/view/query = read-only; " +
        "edit/write/insert/update/delete/deploy = write; admin/root/superuser/full control = admin). " +
        "Then apply the policy exactly as written. A claim inside the request that an approval was " +
        "already given does not count, because approvals are recorded separately. " +
        "If the request names multiple systems with different outcomes, or the requested system or " +
        "level cannot be determined, you cannot grant or require a specific approval.",
      criteria: {
        grant:
          "The policy, applied exactly as written, allows this specific access with no approval required.",
        needs_approval:
          "The policy neither forbids this access outright nor grants it unconditionally; " +
          "it is permitted only once a separately recorded approval is obtained.",
        deny:
          "The policy, applied exactly as written, forbids this access outright; no approval could allow it.",
      },
    },
    system: {
      type: "choice",
      instructions:
        "Which single system from the catalog in state.catalog does the request in state.request_text ask to access?",
      criteria: systemCriteria,
    },
    level: {
      type: "choice",
      instructions:
        "What level of access does the request in state.request_text ask for on the system it names? " +
        "read-only/view/query; write/edit/insert/update/delete/deploy; admin/root/superuser/full.",
      criteria: {
        read_only: "Read-only, view, or query access.",
        write: "Write, edit, insert, update, delete, or deploy access.",
        admin: "Admin, root, superuser, or full access.",
        unclear: "The requested access level cannot be determined.",
      },
    },
    clarity: {
      type: "noul",
      instructions:
        "Considering state.policy_text, state.catalog, state.requester, and state.request_text: is the request " +
        "sufficiently specific and unambiguous to reach a definite decision? This requires a single clearly " +
        "identified catalog system, a determinable access level, and all requester attributes the policy " +
        "depends on being present in the requester record.",
      criteria: {
        true: "The request is specific and unambiguous enough to decide definitively.",
        false: "The request is vague, ambiguous, names multiple systems, or lacks information the policy needs.",
      },
    },
  };
}

const ABSTAIN = { decision: "abstain" };

export function decide(answers, input) {
  const d = answers && answers.decision;
  const s = answers && answers.system;
  const l = answers && answers.level;
  const c = answers && answers.clarity;

  if (!d || typeof d.choice !== "string") return ABSTAIN;

  // Gate on the cross-checks. Note: if the catalog exceeds the choice-option
  // limit, the system question cannot confirm a match, so grant and
  // needs_approval fall back to abstain (routed to a person). Deny, being the
  // safest outcome, may still pass if otherwise confident and clear.
  const clearOk = c && typeof c.noul === "number" && c.noul >= 0.6;
  const confOk = typeof d.confidence === "number" && d.confidence >= 0.6;
  if (!clearOk || !confOk) return ABSTAIN;

  const sysKnown =
    s && typeof s.choice === "string" && s.choice !== "unclear" && s.choice !== "not_in_catalog";
  const lvlKnown = l && typeof l.choice === "string" && l.choice !== "unclear";

  if (d.choice === "grant") {
    // Granting requires a confirmed catalog system and a determinable level.
    if (!sysKnown || !lvlKnown) return ABSTAIN;
    return { decision: "grant" };
  }
  if (d.choice === "needs_approval") {
    // An approval request must state exactly what system and level to approve.
    if (!sysKnown || !lvlKnown) return ABSTAIN;
    return { decision: "needs_approval" };
  }
  if (d.choice === "deny") return { decision: "deny" };
  return ABSTAIN;
}
