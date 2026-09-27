// map.mjs
// Routes monitoring alerts to an owning team and decides whether to page now.

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
      `The alert is directly reporting a problem in the "${entry.service}" service itself ` +
      `(owner team: ${entry.owner_team}, tier: ${entry.tier}) — not a service merely mentioned as ` +
      `context, a dependency, or a downstream/upstream effect.`;
  }
  serviceCriteria["unclear"] =
    "No single service in the catalog is clearly the one whose own failure/error the alert is " +
    "reporting — e.g. the alert names no catalog service as the primary subject, names a service " +
    "not in the catalog, or plausibly implicates multiple services with no clear primary target.";

  const severityCriteria = {
    critical: "The alert explicitly states or clearly implies a critical/sev-1/P0 severity level.",
    high: "The alert explicitly states or clearly implies a high/sev-2/P1 severity level (but not critical).",
    medium: "The alert explicitly states or clearly implies a medium/sev-3/P2/warning severity level.",
    low: "The alert explicitly states or clearly implies a low/sev-4/informational severity level.",
    unknown: "The alert's severity level cannot be confidently determined from the text.",
  };

  return {
    service: {
      type: "choice",
      instructions:
        "Given the alert text and the service catalog, identify the single service that the alert " +
        "is reporting a problem IN — the affected/failing service. Alerts sometimes mention other " +
        "services only as context (e.g. a dependency causing the issue, or a downstream impact); " +
        "those are NOT the affected service. Choose 'unclear' if you cannot confidently pick one " +
        "single catalog service as the primary subject of the alert.\n\nAlert: " +
        (input.alert || ""),
      criteria: serviceCriteria,
    },
    severity: {
      type: "choice",
      instructions:
        "Classify the severity level of this alert based on its text (explicit labels like " +
        "[CRITICAL]/[HIGH], or wording such as error rates vs. thresholds, outage language, etc.).\n\n" +
        "Alert: " + (input.alert || ""),
      criteria: severityCriteria,
    },
  };
}

export function decide(answers, input) {
  const catalog = input.catalog || [];
  const svcAns = answers.service;
  const sevAns = answers.severity;

  const SERVICE_CONF_THRESHOLD = 0.6;
  const SEVERITY_CONF_THRESHOLD = 0.6;

  if (
    !svcAns ||
    svcAns.choice === "unclear" ||
    typeof svcAns.confidence !== "number" ||
    svcAns.confidence < SERVICE_CONF_THRESHOLD
  ) {
    return { team: "abstain", page_now: "abstain" };
  }

  const entry = catalog.find((e) => e.service === svcAns.choice);
  if (!entry) {
    return { team: "abstain", page_now: "abstain" };
  }

  const team = entry.owner_team;

  if (
    !sevAns ||
    sevAns.choice === "unknown" ||
    typeof sevAns.confidence !== "number" ||
    sevAns.confidence < SEVERITY_CONF_THRESHOLD
  ) {
    return { team, page_now: "abstain" };
  }

  let page_now;
  if (sevAns.choice === "critical") {
    page_now = "yes";
  } else if (sevAns.choice === "high" && entry.tier === 1) {
    page_now = "yes";
  } else {
    page_now = "no";
  }

  return { team, page_now };
}
