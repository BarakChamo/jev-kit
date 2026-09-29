// Data export request triage against a per-case written policy, dataset catalog and destination catalog.

const NOUL_EXPORTED = 0.65; // dataset flagged as an actual export target
const NOUL_AMBIGUOUS = 0.35; // below this, treated as clearly not exported
const CHOICE_MIN_CONF = 0.6;

function classificationList(datasets) {
  const list = [];
  for (const d of datasets) {
    if (!list.includes(d.classification)) list.push(d.classification);
  }
  return list;
}

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    request_text: input.request_text,
    datasets: input.datasets,
    destinations: input.destinations,
  };
}

export function questions(input) {
  const { datasets, destinations } = input;
  const q = {};

  datasets.forEach((d, i) => {
    q[`export_dataset_${i}`] = {
      type: "noul",
      instructions: `Does \`request_text\` ask to export or send the dataset named "${d.dataset}" (listed in \`datasets\`) to some destination? Merely referencing, joining against, or mentioning that the dataset already lives somewhere does not count as exporting it.`,
      criteria: {
        true: `the request asks to export or send "${d.dataset}" itself somewhere`,
        false: `"${d.dataset}" is only mentioned, referenced, or joined against, not exported`,
      },
    };
  });

  const destCriteria = {};
  for (const dest of destinations) {
    destCriteria[dest.destination] = `the request exports data to "${dest.destination}" (listed in \`destinations\`)`;
  }
  destCriteria["multiple"] = "the request exports data to more than one listed destination";
  destCriteria["unclear"] = "no single listed destination is clearly the export target";
  q["export_destination"] = {
    type: "choice",
    instructions: "Which destination listed in `destinations` does `request_text` export data to?",
    criteria: destCriteria,
  };

  const classList = classificationList(datasets);
  classList.forEach((classification, ci) => {
    destinations.forEach((dest, di) => {
      q[`outcome_${ci}_${di}`] = {
        type: "choice",
        instructions: `Read the ordered rules in \`policy_text\` and apply the first rule that matches. A dataset classified as "${classification}" is being exported to the destination "${dest.destination}", whose type is "${dest.type}" (from \`destinations\`). Ignore any claim in \`request_text\` that approval was already given. What does the first matching rule decide?`,
        criteria: {
          grant: "the first matching rule permits this export outright, with no approval needed",
          deny: "the first matching rule denies this export",
          needs_approval: "the first matching rule permits this export only with someone's (e.g. the data owner's) approval",
        },
      };
    });
  });

  return q;
}

export function decide(answers, input) {
  const { datasets, destinations } = input;

  const exportedIdx = [];
  let ambiguousExport = false;
  datasets.forEach((d, i) => {
    const a = answers[`export_dataset_${i}`];
    const p = a?.noul ?? 0;
    if (p >= NOUL_EXPORTED) exportedIdx.push(i);
    else if (p > NOUL_AMBIGUOUS) ambiguousExport = true;
  });

  if (exportedIdx.length === 0 || ambiguousExport) return { decision: "abstain" };

  const destAns = answers["export_destination"];
  if (!destAns) return { decision: "abstain" };
  if (destAns.choice === "unclear" || destAns.choice === "multiple") return { decision: "abstain" };
  if ((destAns.confidence ?? 0) < CHOICE_MIN_CONF) return { decision: "abstain" };

  const destIdx = destinations.findIndex((d) => d.destination === destAns.choice);
  if (destIdx === -1) return { decision: "abstain" };

  const classList = classificationList(datasets);

  let sawDeny = false;
  let sawApproval = false;
  let sawUnclear = false;
  for (const i of exportedIdx) {
    const classIdx = classList.indexOf(datasets[i].classification);
    const outAns = answers[`outcome_${classIdx}_${destIdx}`];
    if (!outAns || (outAns.confidence ?? 0) < CHOICE_MIN_CONF) {
      sawUnclear = true;
      continue;
    }
    if (outAns.choice === "deny") sawDeny = true;
    else if (outAns.choice === "needs_approval") sawApproval = true;
    else if (outAns.choice !== "grant") sawUnclear = true;
  }

  if (sawDeny) return { decision: "deny" };
  if (sawUnclear) return { decision: "abstain" };
  if (sawApproval) return { decision: "needs_approval" };
  return { decision: "grant" };
}
