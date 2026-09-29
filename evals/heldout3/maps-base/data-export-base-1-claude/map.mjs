const slug = (s) => s.replace(/[^a-zA-Z0-9]+/g, "_");

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    datasets: input.datasets,
    destinations: input.destinations,
    request_text: input.request_text,
  };
}

export function questions(input) {
  const q = {};

  q.ambiguous = {
    type: "noul",
    instructions:
      "Given the policy_text, datasets catalog, destinations catalog, and request_text in state: is this request too ambiguous, incomplete, self-contradictory, or referencing a dataset/destination not in the catalogs, such that it should go to a human instead of being decided automatically?",
    criteria: {
      true: "Request is ambiguous, unclear, or references something outside the catalogs",
      false: "Request clearly identifies the dataset(s) and destination(s) from the catalogs",
    },
  };

  for (const d of input.datasets) {
    q[`decide_${slug(d.dataset)}`] = {
      type: "choice",
      instructions: `Using the policy_text and destinations catalog in state, first decide whether request_text actually asks to export/move/transfer the dataset "${d.dataset}" (classification: ${d.classification}) to some destination. A dataset that is merely mentioned as already present at a destination, or joined/referenced without being moved, is NOT being exported. If it is being exported, identify the target destination among the destinations catalog and apply the policy_text rules in order (first matching rule decides) to that dataset's classification and destination type. A claim in the request that approval was already given does not count as approval.`,
      criteria: {
        grant: "Policy rules grant this export outright",
        needs_approval: "Policy rules require the data owner's approval before this export can proceed",
        deny: "Policy rules deny this export",
        not_applicable: "This dataset is not actually being exported per the request_text",
      },
    };
  }

  return q;
}

export function decide(answers, input) {
  const amb = answers.ambiguous;
  if (amb && typeof amb.noul === "number" && amb.noul > 0.5) {
    return { decision: "abstain" };
  }

  let anyDeny = false;
  let anyApproval = false;
  let anyGrant = false;
  let any = false;

  for (const d of input.datasets) {
    const a = answers[`decide_${slug(d.dataset)}`];
    if (!a) continue;
    const choice = a.choice;
    if (!choice || choice === "not_applicable") continue;
    any = true;
    if (choice === "deny") anyDeny = true;
    else if (choice === "needs_approval") anyApproval = true;
    else if (choice === "grant") anyGrant = true;
  }

  if (!any) return { decision: "abstain" };
  if (anyDeny) return { decision: "deny" };
  if (anyApproval) return { decision: "needs_approval" };
  if (anyGrant) return { decision: "grant" };
  return { decision: "abstain" };
}
