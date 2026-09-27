// Jev mapping for alert -> team / page_now routing.

const CONF_THRESHOLD = 0.6;

export function buildState(input) {
  return {
    alert: input.alert,
    catalog: input.catalog,
  };
}

export function questions(input) {
  const services = input.catalog.map((c) => c.service);

  const serviceCriteria = {};
  for (const c of input.catalog) {
    serviceCriteria[c.service] =
      `The alert is reporting a problem IN or ABOUT the service "${c.service}" itself (its own errors, latency, resource usage, health, etc.) — not merely mentioning it as related/downstream/upstream context.`;
  }
  serviceCriteria["none"] =
    "No listed service is clearly the one experiencing the problem (e.g. alert is vague, or refers only to unlisted infrastructure).";

  const severityCriteria = {
    critical: "The alert's severity is explicitly or clearly critical/sev1 (e.g. labeled CRITICAL, SEV1, P0, or describes a full outage).",
    high: "The alert's severity is explicitly or clearly high/sev2 (e.g. labeled HIGH, SEV2, P1) but not critical.",
    other: "The alert's severity is medium, low, warning, info, or otherwise not critical and not high.",
  };

  return {
    service: {
      type: "choice",
      instructions: `Given this alert:\n"${input.alert}"\n\nWhich service from the catalog is the one actually AFFECTED (experiencing the fault described), as opposed to a service merely mentioned as context, dependency, or downstream effect? Catalog services: ${services.join(", ")}.`,
      criteria: serviceCriteria,
    },
    severity: {
      type: "choice",
      instructions: `Classify the severity of this alert:\n"${input.alert}"`,
      criteria: severityCriteria,
    },
  };
}

export function decide(answers, input) {
  const serviceAns = answers.service;
  const severityAns = answers.severity;

  if (
    !serviceAns ||
    serviceAns.choice === "none" ||
    serviceAns.confidence < CONF_THRESHOLD
  ) {
    return { team: "abstain", page_now: "abstain" };
  }

  const entry = input.catalog.find((c) => c.service === serviceAns.choice);
  if (!entry) {
    return { team: "abstain", page_now: "abstain" };
  }

  const team = entry.owner_team;

  if (!severityAns || severityAns.confidence < CONF_THRESHOLD) {
    return { team, page_now: "abstain" };
  }

  let page_now = "no";
  if (severityAns.choice === "critical") {
    page_now = "yes";
  } else if (severityAns.choice === "high" && entry.tier === 1) {
    page_now = "yes";
  }

  return { team, page_now };
}
