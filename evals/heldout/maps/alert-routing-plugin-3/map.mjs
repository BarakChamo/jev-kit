const SERVICE_CONF_THRESHOLD = 0.6;
const SEVERITY_CONF_THRESHOLD = 0.6;

export function buildState(input) {
  return {
    alert: input.alert,
    catalog: (input.catalog || []).map((c) => ({
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
    serviceCriteria[c.service] =
      `the service that is actually alerting / whose own metric breached its threshold in \`alert\` is \`${c.service}\` — not a service that is merely named as context, a dependency, or a downstream/upstream effect`;
  }
  serviceCriteria["none"] =
    "no service listed in `catalog` is the one alerting in `alert` (the alerting service is missing from the catalog, or the alert does not clearly identify one alerting service)";

  return {
    affected_service: {
      type: "choice",
      instructions:
        "In `alert`, which service from `catalog` is the affected service — the one whose own error rate, latency, resource usage, or other metric triggered this alert? Services referenced only as context, as a dependency, or as a downstream consumer are not the affected service.",
      criteria: serviceCriteria,
    },
    severity: {
      type: "choice",
      instructions:
        "What severity or priority level does `alert` itself state or clearly imply, using whatever severity/priority indicator (e.g. a bracketed tag, a 'sev'/'P' level, or a plain-language severity word) appears in the text?",
      criteria: {
        critical:
          "alert explicitly states or clearly implies the highest urgency level, e.g. 'critical', 'sev0', 'sev1', 'P1', 'fatal', 'emergency'",
        high:
          "alert explicitly states or clearly implies a high-but-not-top urgency level, e.g. 'high', 'sev2', 'P2', 'major'",
        medium:
          "alert explicitly states or clearly implies a medium urgency level, e.g. 'medium', 'sev3', 'P3', 'warning'",
        low:
          "alert explicitly states or clearly implies a low urgency level, e.g. 'low', 'sev4', 'P4', 'info', 'minor'",
        none:
          "alert states no severity/priority indicator at all, or the indicator present does not map clearly to any of the above levels",
      },
    },
  };
}

export function decide(answers, input) {
  const catalog = input.catalog || [];

  const svcAnswer = answers.affected_service;
  const svcChoice = svcAnswer?.choice;
  const svcProb = svcAnswer?.probabilities?.[svcChoice] ?? 0;
  const entry = catalog.find((c) => c.service === svcChoice);

  const svcResolved =
    entry !== undefined && svcChoice !== "none" && svcProb >= SERVICE_CONF_THRESHOLD;

  const team = svcResolved ? entry.owner_team : "abstain";

  const sevAnswer = answers.severity;
  const sevChoice = sevAnswer?.choice;
  const sevProb = sevAnswer?.probabilities?.[sevChoice] ?? 0;
  const sevResolved = sevChoice !== "none" && sevProb >= SEVERITY_CONF_THRESHOLD;

  let page_now = "abstain";
  if (svcResolved && sevResolved) {
    if (sevChoice === "critical") {
      page_now = "yes";
    } else if (sevChoice === "high") {
      page_now = entry.tier === 1 ? "yes" : "no";
    } else {
      page_now = "no";
    }
  }

  return { team, page_now };
}
