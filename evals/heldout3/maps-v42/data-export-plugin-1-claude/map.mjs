// Data export request triage.
//
// The policy_text, dataset catalog and destination catalog all arrive per
// case, so nothing about them is pinned in code except the fixed label
// vocabulary (grant / needs_approval / deny) and the confidence gates below.
// Two things genuinely need language understanding: (1) which catalog
// dataset(s)/destination(s) the free-text request actually asks to export
// (vs. merely mentions as context, "already there", or a join target), and
// (2) what the written policy's ordered rules produce for a given
// classification x destination-type combination. Everything else (looking
// up a dataset's classification, a destination's type, and combining
// per-pair outcomes into one decision) is exact lookup/derivation, done here.

const IDENT_HIGH = 0.6; // noul >= this: confidently part of the request
const IDENT_LOW = 0.4; // noul <= this: confidently not part of the request
// between the two: too ambiguous to trust either way -> abstain
const PAIR_CONF_GATE = 0.65; // min choice confidence to act on a policy lookup

const RANK = { grant: 0, needs_approval: 1, deny: 2 };

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function exportKey(i) {
  return `export_${i}`;
}

function destKey(j) {
  return `dest_${j}`;
}

function comboKey(classification, type) {
  return `combo_${slug(classification)}__${slug(type)}`;
}

function getCombos(input) {
  const classifications = [...new Set((input.datasets || []).map((d) => d.classification))];
  const types = [...new Set((input.destinations || []).map((d) => d.type))];
  const combos = [];
  for (const classification of classifications) {
    for (const type of types) {
      combos.push({ key: comboKey(classification, type), classification, type });
    }
  }
  return combos;
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
  const q = {};

  (input.datasets || []).forEach((d, i) => {
    q[exportKey(i)] = {
      type: "noul",
      instructions: `In \`request_text\`, is the dataset named "${d.dataset}" one of the datasets actually being requested for export right now — not merely mentioned for context, already present at a destination, or referenced as something the export joins against?`,
      criteria: {
        true: "the request asks to export this dataset now",
        false: "this dataset is not something the request asks to export now",
      },
    };
  });

  (input.destinations || []).forEach((e, j) => {
    q[destKey(j)] = {
      type: "noul",
      instructions: `In \`request_text\`, is "${e.destination}" named as a destination the requested export should go to?`,
      criteria: {
        true: "this destination is named as a target of the requested export",
        false: "this destination is not named as a target of the requested export",
      },
    };
  });

  for (const combo of getCombos(input)) {
    q[combo.key] = {
      type: "choice",
      instructions: `Read the rules in \`policy_text\`. They are applied in order, and the first matching rule decides. Ignoring any claim elsewhere that approval was already given (approvals are recorded separately and none is evidenced here), what outcome do the rules produce for exporting a dataset classified as "${combo.classification}" to a destination of type "${combo.type}"?`,
      criteria: {
        grant: "the rules produce an outright grant, with no approval needed",
        needs_approval: "the rules permit this only with an approval (such as the data owner's) that is not evidenced here",
        deny: "the rules prohibit this export outright",
      },
    };
  }

  return q;
}

export function decide(answers, input) {
  const datasets = input.datasets || [];
  const destinations = input.destinations || [];

  const includedDatasets = [];
  for (let i = 0; i < datasets.length; i++) {
    const noul = answers[exportKey(i)]?.noul;
    if (noul == null || (noul > IDENT_LOW && noul < IDENT_HIGH)) return { decision: "abstain" };
    if (noul >= IDENT_HIGH) includedDatasets.push(datasets[i]);
  }

  const includedDestinations = [];
  for (let j = 0; j < destinations.length; j++) {
    const noul = answers[destKey(j)]?.noul;
    if (noul == null || (noul > IDENT_LOW && noul < IDENT_HIGH)) return { decision: "abstain" };
    if (noul >= IDENT_HIGH) includedDestinations.push(destinations[j]);
  }

  if (includedDatasets.length === 0 || includedDestinations.length === 0) {
    return { decision: "abstain" };
  }

  let worst = "grant";
  for (const d of includedDatasets) {
    for (const e of includedDestinations) {
      const key = comboKey(d.classification, e.type);
      const answer = answers[key];
      if (!answer || answer.confidence == null || answer.confidence < PAIR_CONF_GATE) {
        return { decision: "abstain" };
      }
      if (RANK[answer.choice] > RANK[worst]) worst = answer.choice;
    }
  }

  return { decision: worst };
}
