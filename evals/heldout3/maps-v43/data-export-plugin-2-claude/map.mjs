// Data export request triage.
//
// Policy structure (as given in policy_text, applied in this fixed order):
//   1. destination.type === "personal"                         -> deny
//   2. dataset.classification === "restricted" && dest not internal -> deny
//   3. dataset.classification === "restricted" && dest === internal -> needs_approval
//   4. dataset.classification === "internal"   && dest === approved_vendor -> needs_approval
//      dataset.classification === "internal"   && dest === external       -> deny
//   5. dataset.classification === "internal"   && dest === internal        -> grant
//   6. dataset.classification === "public"     && dest !== personal        -> grant
//
// Jev only resolves the free-text request against the catalogs: which datasets
// are actually being exported (not just referenced/joined against), and which
// destination(s) are named as export targets. The policy matrix itself is
// applied in code (it is fixed policy, not a per-case fact).

const DATASET_THRESHOLD = 0.6;
const DEST_THRESHOLD = 0.6;

export function buildState(input) {
  return {
    request_text: input.request_text,
    datasets: input.datasets,
    destinations: input.destinations,
  };
}

export function questions(input) {
  const q = {};

  input.datasets.forEach((ds, i) => {
    q[`ds_${i}`] = {
      type: "noul",
      instructions: `Does request_text explicitly ask to export the dataset named "${ds.dataset}" (send, copy, or move it to some destination)? Answer false if it is only mentioned as related context, something already present at the destination, or something joined against, without itself being asked to be exported.`,
      criteria: {
        true: `request_text asks to export "${ds.dataset}" itself`,
        false: `"${ds.dataset}" is not itself being exported by this request`,
      },
    };
  });

  input.destinations.forEach((dest, i) => {
    q[`dest_${i}`] = {
      type: "noul",
      instructions: `Does request_text name "${dest.destination}" as a destination it wants data exported to?`,
      criteria: {
        true: `"${dest.destination}" is named as an export target in request_text`,
        false: `"${dest.destination}" is not named as an export target in request_text`,
      },
    };
  });

  return q;
}

function ruleFor(classification, destType) {
  if (destType === "personal") return "deny"; // rule 1
  if (classification === "restricted") {
    return destType === "internal" ? "needs_approval" : "deny"; // rules 2/3
  }
  if (classification === "internal") {
    if (destType === "internal") return "grant"; // rule 5
    if (destType === "approved_vendor") return "needs_approval"; // rule 4
    return "deny"; // rule 4, external
  }
  if (classification === "public") return "grant"; // rule 6
  return null; // unrecognized classification
}

const SEVERITY = { grant: 1, needs_approval: 2, deny: 3 };

export function decide(answers, input) {
  const includedDatasets = input.datasets.filter(
    (_, i) => answers[`ds_${i}`]?.noul >= DATASET_THRESHOLD
  );
  const includedDestinations = input.destinations.filter(
    (_, i) => answers[`dest_${i}`]?.noul >= DEST_THRESHOLD
  );

  if (includedDatasets.length === 0 || includedDestinations.length === 0) {
    return { decision: "abstain" };
  }

  let worst = "grant";
  for (const ds of includedDatasets) {
    for (const dest of includedDestinations) {
      const verdict = ruleFor(ds.classification, dest.type);
      if (verdict === null) return { decision: "abstain" };
      if (SEVERITY[verdict] > SEVERITY[worst]) worst = verdict;
    }
  }

  return { decision: worst };
}
