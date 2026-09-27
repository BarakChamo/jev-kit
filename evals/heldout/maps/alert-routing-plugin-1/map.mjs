// Alert routing: which team owns the affected service, and whether to page now.
// Policy: page now iff severity is critical, or severity is high and the affected service is tier 1.

const SERVICE_CONF_THRESHOLD = 0.6;
const SEVERITY_CONF_THRESHOLD = 0.6;

export function buildState(input) {
  return {
    alert: input.alert,
    catalog: input.catalog.map((c) => ({
      service: c.service,
      owner_team: c.owner_team,
      tier: c.tier,
    })),
  };
}

export function questions(input) {
  const services = input.catalog.map((c) => c.service);

  const serviceCriteria = {};
  for (const s of services) {
    serviceCriteria[s] =
      `The alert states that ${s} itself is experiencing the reported condition ` +
      `(its own error rate, latency, failures, saturation, etc. breaching a threshold), ` +
      `not merely named as an upstream/downstream dependency or background context.`;
  }
  serviceCriteria["unclear"] =
    "No single service in the catalog is clearly the one whose own metric breached: " +
    "the alert only names services as context, names several services jointly with no " +
    "single one singled out as breaching, or names a service that is not in the catalog.";

  return {
    affected_service: {
      type: "choice",
      instructions:
        "Read `alert` in the state. Which service in `catalog` is the AFFECTED service, i.e. " +
        "the one whose own metric or condition triggered this alert? Other services may be " +
        "mentioned only as context (e.g. a downstream call, a dependency, a related system) " +
        "and must not be picked just because they are named.",
      criteria: serviceCriteria,
    },
    severity: {
      type: "choice",
      instructions:
        "Read `alert` in the state. What severity does the alert itself state for this " +
        "condition (e.g. a leading tag like [CRITICAL]/[HIGH]/[WARN], or an explicit severity " +
        "field)?",
      criteria: {
        critical: "The alert explicitly states critical severity (e.g. 'critical', 'sev1', 'emergency').",
        high: "The alert explicitly states high severity (e.g. 'high', 'sev2', 'major').",
        other: "Any other stated severity (medium, low, warning, info) or no clear severity stated.",
      },
    },
  };
}

export function decide(answers, input) {
  const serviceAns = answers.affected_service;
  const severityAns = answers.severity;

  const servicePicked = serviceAns?.choice;
  const serviceP = serviceAns?.probabilities?.[servicePicked] ?? 0;
  const serviceOk = servicePicked && servicePicked !== "unclear" && serviceP >= SERVICE_CONF_THRESHOLD;

  const entry = serviceOk ? input.catalog.find((c) => c.service === servicePicked) : undefined;
  const team = entry ? entry.owner_team : "abstain";

  const severityPicked = severityAns?.choice;
  const severityP = severityAns?.probabilities?.[severityPicked] ?? 0;
  const severityOk = severityPicked && severityP >= SEVERITY_CONF_THRESHOLD;

  let page_now = "abstain";
  if (entry && severityOk) {
    if (severityPicked === "critical") {
      page_now = "yes";
    } else if (severityPicked === "high") {
      page_now = entry.tier === 1 ? "yes" : "no";
    } else {
      page_now = "no";
    }
  }

  return { team, page_now };
}
