// map.mjs
// Routes monitoring alerts to owning teams and decides paging vs ticketing.

export function buildState(input) {
  return {
    alert: input.alert,
    catalog: input.catalog,
  };
}

export function questions(input) {
  const services = input.catalog.map((c) => c.service);

  const serviceCriteria = {};
  for (const s of services) {
    serviceCriteria[s] = `The alert is reporting a problem (error rate, latency, failure, outage, resource issue, etc.) that is happening IN the "${s}" service itself. This is the service whose own metrics/behavior triggered the alert, not a service it merely calls, depends on, or that is only mentioned for context.`;
  }
  serviceCriteria["unclear"] = "The alert does not clearly and unambiguously identify exactly one service from the catalog as the one experiencing the problem (e.g. no cataloged service is named, multiple services seem equally implicated as the source, or the wording is too vague to pick a single affected service).";

  const severityCriteria = {
    critical: "The alert's severity is explicitly or clearly critical (e.g. labeled CRITICAL, P1, sev1, or describes a full outage/major user-facing failure).",
    high: "The alert's severity is explicitly or clearly high (e.g. labeled HIGH, P2, sev2) but not critical.",
    other: "The alert's severity is medium, low, warning, info, unspecified, or otherwise not clearly critical or high.",
  };

  return {
    service: {
      type: "choice",
      instructions: `Given this alert: "${input.alert}"\n\nWhich cataloged service is the one actually experiencing/reporting the problem described in the alert? Other services may be mentioned only as context, dependencies, or downstream/upstream references — pick the service the alert is fundamentally about. If this cannot be determined confidently for exactly one cataloged service, choose "unclear".`,
      criteria: serviceCriteria,
    },
    severity: {
      type: "choice",
      instructions: `Given this alert: "${input.alert}"\n\nClassify the severity of the alert as stated or clearly implied by its text.`,
      criteria: severityCriteria,
    },
  };
}

export function decide(answers, input) {
  const CONF_THRESHOLD = 0.55;

  const serviceAns = answers.service;
  const severityAns = answers.severity;

  if (
    !serviceAns ||
    serviceAns.choice === "unclear" ||
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

  const severity = severityAns.choice;
  const page_now =
    severity === "critical" || (severity === "high" && entry.tier === 1)
      ? "yes"
      : "no";

  return { team, page_now };
}
