// map.mjs
// Routes monitoring alerts: identify affected service (from catalog) and decide page-now vs ticket.

export function buildState(input) {
  return {
    alert: input.alert,
    catalog: input.catalog,
  };
}

export function questions(input) {
  const catalog = input.catalog || [];

  const serviceCriteria = {};
  for (const entry of catalog) {
    serviceCriteria[entry.service] =
      `The alert is reporting a problem IN the "${entry.service}" service itself ` +
      `(owned by ${entry.owner_team}, tier ${entry.tier}) — i.e. this is the service whose ` +
      `metric/error/failure the alert is about.`;
  }
  serviceCriteria["none_or_unclear"] =
    "No service in the catalog is clearly the one experiencing the problem, or it is " +
    "ambiguous which of several catalog services is the actual affected service " +
    "(e.g. two services are equally plausible, or the alert only names services as " +
    "context/downstream dependencies rather than as the source of the problem).";

  const severityCriteria = {
    critical:
      "The alert explicitly states or clearly implies critical severity (e.g. labeled " +
      "CRITICAL/SEV1/P1, a full outage, or a critical error condition).",
    high:
      "The alert explicitly states or clearly implies high severity (e.g. labeled " +
      "HIGH/SEV2/P2) but is not critical.",
    other:
      "The alert is medium, low, warning, informational severity, or its severity is " +
      "not clearly critical or high.",
  };

  return {
    service: {
      type: "choice",
      instructions:
        "Given the alert text and the service catalog, identify which single catalog " +
        "service is the one actually affected (experiencing the reported problem), as " +
        "opposed to services merely mentioned for context, as a dependency, or downstream " +
        "impact.",
      criteria: serviceCriteria,
    },
    severity: {
      type: "choice",
      instructions:
        "Determine the severity level stated or clearly implied by the alert text.",
      criteria: severityCriteria,
    },
  };
}

export function decide(answers, input) {
  const catalog = input.catalog || [];
  const serviceAns = answers.service;
  const severityAns = answers.severity;

  const CONF_THRESHOLD = 0.55;

  let entry = null;
  if (
    serviceAns &&
    serviceAns.choice &&
    serviceAns.choice !== "none_or_unclear" &&
    serviceAns.confidence >= CONF_THRESHOLD
  ) {
    entry = catalog.find((e) => e.service === serviceAns.choice) || null;
  }

  const team = entry ? entry.owner_team : "abstain";

  let severity = null;
  if (severityAns && severityAns.confidence >= CONF_THRESHOLD) {
    severity = severityAns.choice;
  }

  let page_now = "abstain";
  if (severity === "critical") {
    page_now = "yes";
  } else if (severity === "high") {
    if (entry) {
      page_now = entry.tier === 1 ? "yes" : "no";
    } else {
      page_now = "abstain";
    }
  } else if (severity === "other") {
    page_now = "no";
  }

  return { team, page_now };
}
