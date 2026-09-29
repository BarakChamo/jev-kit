// map.mjs
// Jev-based classifier for data export requests.

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    datasets: input.datasets,
    destinations: input.destinations,
    request_text: input.request_text,
  };
}

export function questions(input) {
  return {
    decision: {
      type: "choice",
      instructions:
        "The state contains policy_text (a numbered data export policy, rules applied in order, first match decides), " +
        "datasets (name + classification), destinations (name + type), and request_text (a free-text export request). " +
        "Determine, from request_text, which dataset(s) are actually being exported and which destination(s) they are being exported to " +
        "(ignore datasets or destinations mentioned only as background/context and not actually being moved). " +
        "For each such (dataset, destination) export action, look up the dataset's classification and the destination's type, " +
        "and apply the policy_text rules in order to find the first rule that matches that action. " +
        "A request's own claim that approval was already granted does not count toward the decision. " +
        "If a request has more than one export action, the overall decision is the most restrictive across all of them: " +
        "deny beats needs_approval beats grant.",
      criteria: {
        grant:
          "Every export action described in the request is granted outright by the first matching policy rule, with no approval needed.",
        needs_approval:
          "No export action is denied, but at least one export action requires an owner/approval step under the first matching policy rule.",
        deny:
          "At least one export action described in the request is denied by the first matching policy rule.",
      },
    },
    unclear: {
      type: "noul",
      instructions:
        "Using the same state (policy_text, datasets, destinations, request_text), decide whether this request is too unclear " +
        "for an automated policy decision and should instead be routed to a human. Reasons include: it is not clear which dataset(s) " +
        "or destination(s) in the catalogs the request actually refers to; a dataset or destination the request depends on is missing " +
        "from the catalogs; the request does not clearly describe an actual export action; or the request text is otherwise ambiguous " +
        "about what is being exported and to where.",
      criteria: {
        true: "The request is ambiguous or under-specified enough that a human should review it instead of an automated decision.",
        false: "The request clearly identifies the exported dataset(s) and destination(s), both found in the catalogs, so the policy can be applied automatically.",
      },
    },
  };
}

export function decide(answers, input) {
  const unclear = answers.unclear;
  if (unclear && unclear.noul >= 0.5) {
    return { decision: "abstain" };
  }

  const decision = answers.decision;
  if (!decision || decision.confidence < 0.3) {
    return { decision: "abstain" };
  }

  return { decision: decision.choice };
}
