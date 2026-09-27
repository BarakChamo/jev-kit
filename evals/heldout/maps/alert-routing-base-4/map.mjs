const SERVICE_CONFIDENCE_THRESHOLD = 0.55;
const SEVERITY_CONFIDENCE_THRESHOLD = 0.55;

export function buildState(input) {
  return {
    alert: input.alert,
    catalog: (input.catalog || []).map(c => ({
      service: c.service,
      owner_team: c.owner_team,
      tier: c.tier,
    })),
  };
}

export function questions(input) {
  const catalog = input.catalog || [];

  const serviceCriteria = {};
  for (const c of catalog) {
    serviceCriteria[c.service] = `The service named "${c.service}" (tier ${c.tier}, owned by ${c.owner_team}) is the one actually experiencing the fault described in the alert.`;
  }

  return {
    service: {
      type: "choice",
      instructions:
        `Alert: "${input.alert}"\n\n` +
        "Which service from the catalog is the AFFECTED service — the one that is actually failing, erroring, or breaching a threshold in this alert? " +
        "Some alerts mention other services only as context, dependencies, or downstream/upstream references; do not pick those. Pick the service the alert is actually about.",
      criteria: serviceCriteria,
    },
    severity: {
      type: "choice",
      instructions:
        `Alert: "${input.alert}"\n\n` +
        "What severity level does this alert indicate? Look for an explicit tag (e.g. [CRITICAL], [HIGH], [WARN], [INFO]) or infer from wording/impact if no explicit tag is present.",
      criteria: {
        critical: "The alert is explicitly tagged critical/sev1, or describes a severe, active outage-level failure.",
        high: "The alert is explicitly tagged high/sev2, or describes a serious but non-outage-level degradation.",
        medium: "The alert is explicitly tagged medium/warning/sev3, or describes a moderate issue.",
        low: "The alert is explicitly tagged low/informational/sev4, or describes a minor issue.",
      },
    },
  };
}

export function decide(answers, input) {
  const catalog = input.catalog || [];
  const serviceAns = answers.service;
  const severityAns = answers.severity;

  if (!serviceAns || !severityAns) {
    return { team: "abstain", page_now: "abstain" };
  }

  const entry = catalog.find(c => c.service === serviceAns.choice);

  if (!entry || (serviceAns.confidence ?? 0) < SERVICE_CONFIDENCE_THRESHOLD) {
    return { team: "abstain", page_now: "abstain" };
  }

  const team = entry.owner_team;

  if ((severityAns.confidence ?? 0) < SEVERITY_CONFIDENCE_THRESHOLD) {
    return { team, page_now: "abstain" };
  }

  const severity = severityAns.choice;
  const isCritical = severity === "critical";
  const isHighTier1 = severity === "high" && entry.tier === 1;
  const page_now = isCritical || isHighTier1 ? "yes" : "no";

  return { team, page_now };
}
