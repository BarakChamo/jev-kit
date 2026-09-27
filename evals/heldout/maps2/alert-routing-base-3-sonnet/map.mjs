// map.mjs - Jev mapping for alert routing (team ownership + page-now decision)

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
      `The alert is reporting a problem IN or WITH "${c.service}" itself ` +
      `(owned by ${c.owner_team}, tier ${c.tier}) — the metric, error, or ` +
      `failure described is happening to this service, not a dependency it merely mentions.`;
  }
  serviceCriteria["unclear"] =
    "The service actually experiencing the problem is not one of the listed catalog services, " +
    "or the alert text does not make it clear which single service is affected.";

  const severityCriteria = {
    critical:
      "The alert is explicitly labeled critical/CRIT/sev-1, or describes a full outage / total failure / complete loss of function.",
    high:
      "The alert is explicitly labeled high/major/sev-2, or describes a significant degradation (e.g. elevated error rate, breached threshold) that is not a total outage.",
    medium:
      "The alert is explicitly labeled medium/warning/sev-3, or describes a moderate issue with limited impact.",
    low:
      "The alert is explicitly labeled low/info/sev-4, or describes a minor issue with little to no user impact.",
    unclear:
      "The alert's severity cannot be confidently determined from its text (no explicit level and impact description is ambiguous).",
  };

  return {
    service: {
      type: "choice",
      instructions:
        "Given the alert and the service catalog, identify the single catalog service that is actually " +
        "affected (i.e. the one experiencing the reported problem). Alerts sometimes name other services " +
        "only as context, dependencies, or downstream/upstream references — those are NOT the affected " +
        "service. If you cannot confidently pin down one catalog service as the affected one, choose 'unclear'.\n\n" +
        `Alert: ${input.alert}`,
      criteria: serviceCriteria,
    },
    severity: {
      type: "choice",
      instructions:
        "Determine the severity level of this alert, using any explicit severity label in the text " +
        "(e.g. [CRITICAL], [HIGH], sev-1) as the strongest signal, and the described impact otherwise. " +
        "If it truly cannot be determined, choose 'unclear'.\n\n" +
        `Alert: ${input.alert}`,
      criteria: severityCriteria,
    },
  };
}

const CONFIDENCE_THRESHOLD = 0.6;

export function decide(answers, input) {
  const serviceAns = answers.service;
  const severityAns = answers.severity;

  const serviceName = serviceAns?.choice;
  const serviceConfident =
    serviceName &&
    serviceName !== "unclear" &&
    (serviceAns.confidence ?? 0) >= CONFIDENCE_THRESHOLD;

  const catalogEntry = serviceConfident
    ? input.catalog.find((c) => c.service === serviceName)
    : undefined;

  const team = catalogEntry ? catalogEntry.owner_team : "abstain";

  const severity = severityAns?.choice;
  const severityConfident =
    severity &&
    severity !== "unclear" &&
    (severityAns.confidence ?? 0) >= CONFIDENCE_THRESHOLD;

  let page_now = "abstain";
  if (catalogEntry && severityConfident) {
    if (severity === "critical") {
      page_now = "yes";
    } else if (severity === "high") {
      page_now = catalogEntry.tier === 1 ? "yes" : "no";
    } else {
      page_now = "no";
    }
  }

  return { team, page_now };
}
