// Jev mapping for alert -> team routing / page decision.

const SERVICE_CONF_THRESHOLD = 0.55;
const SEVERITY_CONF_THRESHOLD = 0.55;

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
  const serviceNames = input.catalog.map((c) => c.service);

  const serviceCriteria = {};
  for (const c of input.catalog) {
    serviceCriteria[c.service] =
      `The alert is reporting a problem originating in / measured on the "${c.service}" service itself (not merely mentioned as related context, upstream/downstream dependency, or cause).`;
  }
  serviceCriteria["none"] =
    "No service in the catalog is clearly the one experiencing the reported problem (e.g. the alert names an unlisted service, or it is too ambiguous to tell).";

  const q = {
    affected_service: {
      type: "choice",
      instructions:
        `Given this alert: "${input.alert}"\n` +
        `Which service from the catalog is the one actually AFFECTED (i.e. the one experiencing the fault/error/condition described)? ` +
        `Services mentioned only as context, cause, or downstream/upstream reference are NOT the affected service. ` +
        `If you cannot confidently tell which catalog service is affected, choose "none".`,
      criteria: serviceCriteria,
    },
    severity: {
      type: "choice",
      instructions:
        `Given this alert: "${input.alert}"\n` +
        `Classify the severity level as stated or clearly implied by the alert text itself.`,
      criteria: {
        critical: "The alert explicitly states or clearly implies critical/sev1 severity.",
        high: "The alert explicitly states or clearly implies high/sev2 severity (but not critical).",
        other: "The alert states a lower severity (medium/low/info) or severity cannot be clearly determined.",
      },
    },
  };

  return q;
}

export function decide(answers, input) {
  const serviceAns = answers.affected_service;
  const severityAns = answers.severity;

  let team = "abstain";
  let matchedTier = null;

  if (
    serviceAns &&
    serviceAns.type === "choice" &&
    serviceAns.choice !== "none" &&
    serviceAns.confidence >= SERVICE_CONF_THRESHOLD
  ) {
    const entry = input.catalog.find((c) => c.service === serviceAns.choice);
    if (entry) {
      team = entry.owner_team;
      matchedTier = entry.tier;
    }
  }

  let page_now = "abstain";

  if (severityAns && severityAns.type === "choice" && severityAns.confidence >= SEVERITY_CONF_THRESHOLD) {
    if (severityAns.choice === "critical") {
      page_now = "yes";
    } else if (severityAns.choice === "high") {
      if (matchedTier !== null) {
        page_now = matchedTier === 1 ? "yes" : "no";
      } else {
        page_now = "abstain";
      }
    } else {
      page_now = "no";
    }
  }

  return { team, page_now };
}
