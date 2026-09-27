const SERVICE_CONFIDENCE_GATE = 0.55;
const SEVERITY_CONFIDENCE_GATE = 0.55;

export function buildState(input) {
  return {
    alert: input.alert,
    catalog: input.catalog,
  };
}

export function questions(input) {
  const serviceCriteria = {};
  for (const entry of input.catalog) {
    serviceCriteria[entry.service] =
      `\`alert\` is reporting a problem (an error, a threshold breach, a failure, a latency/health issue) on the \`${entry.service}\` service itself — ` +
      `not merely mentioning \`${entry.service}\` as a dependency, upstream/downstream caller, or destination that the affected service talks to.`;
  }
  serviceCriteria["unclear"] =
    "no single service listed in `catalog` can be identified as the one `alert` is reporting a problem on.";

  return {
    affected_service: {
      type: "choice",
      instructions:
        "Which entry in `catalog` (by its `service` name) is the service that `alert` reports a problem on — the affected service? " +
        "Alerts sometimes mention other services only as context, dependencies, or destinations; those are not the affected service. " +
        "If no single service in `catalog` can be identified as the one being reported on, choose `unclear`.",
      criteria: serviceCriteria,
    },
    severity: {
      type: "choice",
      instructions:
        "What severity does `alert` state for itself, classified into these bands?",
      criteria: {
        critical:
          "`alert` states or clearly implies the highest severity, e.g. labeled CRITICAL, SEV1, P1, or equivalent top-severity wording.",
        high:
          "`alert` states or clearly implies a high but not top severity, e.g. labeled HIGH, SEV2, P2, or wording describing major impact short of the top tier.",
        other:
          "`alert` states or implies medium, low, informational, warning-only severity, or gives no clear severity indication.",
      },
    },
  };
}

export function decide(answers, input) {
  const serviceAnswer = answers.affected_service;
  const severityAnswer = answers.severity;

  const serviceProb = serviceAnswer.probabilities?.[serviceAnswer.choice] ?? serviceAnswer.confidence;
  const serviceResolved =
    serviceAnswer.choice !== "unclear" && serviceProb >= SERVICE_CONFIDENCE_GATE;

  const catalogEntry = serviceResolved
    ? input.catalog.find((e) => e.service === serviceAnswer.choice)
    : undefined;

  const team = catalogEntry ? catalogEntry.owner_team : "abstain";

  const severityProb =
    severityAnswer.probabilities?.[severityAnswer.choice] ?? severityAnswer.confidence;
  const severityResolved = severityProb >= SEVERITY_CONFIDENCE_GATE;

  let page_now;
  if (!severityResolved) {
    page_now = "abstain";
  } else if (severityAnswer.choice === "critical") {
    page_now = "yes";
  } else if (severityAnswer.choice === "high") {
    page_now = catalogEntry ? (catalogEntry.tier === 1 ? "yes" : "no") : "abstain";
  } else {
    page_now = "no";
  }

  return { team, page_now };
}
