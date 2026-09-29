// map.mjs — Jev question map for data export request triage.
//
// The policy always reduces to the same fixed matrix over the controlled
// vocabularies given in the catalogs:
//   dataset classification ∈ {restricted, internal, public}
//   destination type       ∈ {personal, external, approved_vendor, internal}
// Those facts are already structured data in the catalogs — no need to ask
// Jev for them. What Jev is needed for is figuring out, from the free-text
// request, WHICH catalog dataset(s) and destination(s) the request actually
// asks to move (as opposed to merely mentioning for context).

const SLUG = (s) => String(s).replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const INVOLVED_THRESHOLD = 0.6;
const EXCLUDED_THRESHOLD = 0.4;
const AMBIGUOUS_THRESHOLD = 0.5;

function datasetKey(d) {
  return `ds_${SLUG(d.dataset)}`;
}
function destKey(d) {
  return `dest_${SLUG(d.destination)}`;
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

  for (const d of input.datasets) {
    q[datasetKey(d)] = {
      type: "noul",
      instructions:
        `Does \`request_text\` ask to export the dataset named "${d.dataset}" (one of the entries ` +
        `in \`datasets\`)? Answer true only if the request is asking to move or send that dataset ` +
        `itself somewhere. Answer false if the dataset is only mentioned for context (e.g. it is ` +
        `joined against, referenced, or already present at the destination) and is not itself being exported.`,
      criteria: {
        true: `"${d.dataset}" is one of the datasets the request asks to export`,
        false: `"${d.dataset}" is not being exported by this request, even if mentioned`,
      },
    };
  }

  for (const t of input.destinations) {
    q[destKey(t)] = {
      type: "noul",
      instructions:
        `Does \`request_text\` ask for data to be exported to the destination named "${t.destination}" ` +
        `(one of the entries in \`destinations\`)? Answer true only if that destination is where the ` +
        `export is being sent. Answer false if it is only mentioned for context and is not the export target.`,
      criteria: {
        true: `"${t.destination}" is a destination the request asks to export to`,
        false: `"${t.destination}" is not an export target of this request, even if mentioned`,
      },
    };
  }

  q.ambiguous = {
    type: "noul",
    instructions:
      "Reading `request_text` against the entries listed in `datasets` and `destinations`, is it " +
      "genuinely unclear which cataloged dataset(s) and/or which cataloged destination(s) the request " +
      "is asking to move data between? Answer true only for real ambiguity (e.g. no destination stated, " +
      "or a description that could match more than one catalog entry), not merely because the wording is informal.",
    criteria: {
      true: "which dataset(s) and/or destination(s) are meant is genuinely unclear",
      false: "the dataset(s) and destination(s) meant can be identified from the catalogs",
    },
  };

  return q;
}

function severity(decision) {
  return { grant: 1, needs_approval: 2, deny: 3 }[decision] ?? 0;
}

function decideForPair(classification, destType) {
  if (destType === "personal") return "deny";
  if (classification === "restricted") {
    return destType === "internal" ? "needs_approval" : "deny"; // external, approved_vendor
  }
  if (classification === "internal") {
    if (destType === "approved_vendor") return "needs_approval";
    if (destType === "internal") return "grant";
    return "deny"; // external
  }
  if (classification === "public") return "grant";
  return null; // unrecognized classification/type -> caller should abstain
}

export function decide(answers, input) {
  if ((answers.ambiguous?.noul ?? 0) >= AMBIGUOUS_THRESHOLD) {
    return { decision: "abstain" };
  }

  const involvedDatasets = [];
  for (const d of input.datasets) {
    const p = answers[datasetKey(d)]?.noul ?? 0;
    if (p >= INVOLVED_THRESHOLD) involvedDatasets.push(d);
    else if (p > EXCLUDED_THRESHOLD) return { decision: "abstain" }; // unresolved middle ground
  }

  const involvedDestinations = [];
  for (const t of input.destinations) {
    const p = answers[destKey(t)]?.noul ?? 0;
    if (p >= INVOLVED_THRESHOLD) involvedDestinations.push(t);
    else if (p > EXCLUDED_THRESHOLD) return { decision: "abstain" }; // unresolved middle ground
  }

  if (involvedDatasets.length === 0 || involvedDestinations.length === 0) {
    return { decision: "abstain" };
  }

  let worst = 0;
  for (const d of involvedDatasets) {
    for (const t of involvedDestinations) {
      const outcome = decideForPair(d.classification, t.type);
      if (outcome === null) return { decision: "abstain" };
      worst = Math.max(worst, severity(outcome));
    }
  }

  return { decision: Object.keys({ grant: 1, needs_approval: 2, deny: 3 }).find((k) => severity(k) === worst) };
}
