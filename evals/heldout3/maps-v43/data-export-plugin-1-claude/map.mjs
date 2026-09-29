// Data export request triage: grant | needs_approval | deny | abstain
//
// Approach: never ask Jev for the request's final outcome directly. Instead:
//   1. Ask, per catalog dataset, whether the request exports it (vs. merely
//      references/joins it) — noul per item (rule 10).
//   2. Ask, per catalog destination, whether the request sends data there —
//      noul per item.
//   3. Ask, per (classification, destination-type) combination that appears
//      in the catalogs, what the *policy text* (not the request) resolves to
//      — a choice, scoped to `policy_text` only.
//   4. In code: resolve which datasets/destinations the request actually
//      names (gated on confidence), then take the most restrictive combo
//      outcome across every named dataset x named destination pair.
//
// No approval-record field exists in the input, and the policy says a claim
// of prior approval in the request text does not count — so any combo that
// resolves to "needs_approval" can never be silently upgraded to "grant".

const NOUL_TRUE = 0.6;
const NOUL_FALSE = 0.4;
const CHOICE_CONF = 0.6;

function slug(s) {
  return String(s).replace(/[^a-zA-Z0-9]+/g, "_");
}

function ruleId(classification, type) {
  return `rule_${slug(classification)}_${slug(type)}`;
}

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    datasets: input.datasets,
    destinations: input.destinations,
    request_text: input.request_text,
  };
}

export function questions(input) {
  const qs = {};

  input.datasets.forEach((d, i) => {
    qs[`export_ds_${i}`] = {
      type: "noul",
      instructions: `Does the request in \`request_text\` ask to export or send out the dataset named "${d.dataset}" itself (as opposed to merely referencing it, joining against it, or noting that it already exists at a destination)?`,
      criteria: {
        true: `The request asks to export/send "${d.dataset}" itself somewhere.`,
        false: `The request does not ask to export "${d.dataset}" itself — it is at most mentioned, referenced, or joined against.`,
      },
    };
  });

  input.destinations.forEach((t, i) => {
    qs[`to_dest_${i}`] = {
      type: "noul",
      instructions: `Does the request in \`request_text\` ask to export data to the destination described as "${t.destination}"?`,
      criteria: {
        true: `The request asks to send data to "${t.destination}".`,
        false: `The request does not ask to send data to "${t.destination}".`,
      },
    };
  });

  const classifications = [...new Set(input.datasets.map((d) => d.classification))];
  const types = [...new Set(input.destinations.map((t) => t.type))];

  for (const cls of classifications) {
    for (const typ of types) {
      qs[ruleId(cls, typ)] = {
        type: "choice",
        instructions: `Read \`policy_text\` only. Its rules are applied in order, and the first rule that matches decides. Under those rules (ignore the specific request), what is the outcome of exporting a dataset classified as "${cls}" to a destination whose type is "${typ}"?`,
        criteria: {
          grant: "The first matching rule grants this export outright, with no approval needed.",
          needs_approval: "The first matching rule allows this export only with the data owner's (or another named approver's) approval.",
          deny: "The first matching rule denies or prohibits this export.",
          unclear: "The policy text does not clearly state a rule covering this exact combination.",
        },
      };
    }
  }

  return qs;
}

export function decide(answers, input) {
  const exportedIdx = [];
  for (let i = 0; i < input.datasets.length; i++) {
    const a = answers[`export_ds_${i}`];
    if (!a) continue;
    if (a.noul >= NOUL_TRUE) exportedIdx.push(i);
    else if (a.noul > NOUL_FALSE) return { decision: "abstain" };
  }
  if (exportedIdx.length === 0) return { decision: "abstain" };

  const destIdx = [];
  for (let i = 0; i < input.destinations.length; i++) {
    const a = answers[`to_dest_${i}`];
    if (!a) continue;
    if (a.noul >= NOUL_TRUE) destIdx.push(i);
    else if (a.noul > NOUL_FALSE) return { decision: "abstain" };
  }
  if (destIdx.length === 0) return { decision: "abstain" };

  const classifications = [...new Set(exportedIdx.map((i) => input.datasets[i].classification))];
  const types = [...new Set(destIdx.map((i) => input.destinations[i].type))];

  const severity = { grant: 1, needs_approval: 2, deny: 3 };
  let worst = 0;

  for (const cls of classifications) {
    for (const typ of types) {
      const a = answers[ruleId(cls, typ)];
      if (!a || a.choice === "unclear" || a.confidence < CHOICE_CONF) {
        return { decision: "abstain" };
      }
      const sev = severity[a.choice];
      if (sev === undefined) return { decision: "abstain" };
      if (sev > worst) worst = sev;
    }
  }

  if (worst === 0) return { decision: "abstain" };
  const label = Object.keys(severity).find((k) => severity[k] === worst);
  return { decision: label };
}
