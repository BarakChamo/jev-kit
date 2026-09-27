// Alert routing: pick the affected service (and its owning team/tier) from the
// catalog, and decide whether to page now, per policy:
//   page now if severity is critical, or severity is high AND service tier == 1
//   otherwise: open a ticket

const TEAM_CONF_THRESHOLD = 0.55;
const SEVERITY_CONF_THRESHOLD = 0.55;

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
      `the affected service is "${entry.service}" (owner team: ${entry.owner_team}, tier: ${entry.tier})`;
  }
  serviceCriteria["unclear"] =
    "no single entry in `catalog` is clearly the affected service (e.g. the alert names none of them, or names several with no primary target)";

  return {
    affected_service: {
      type: "choice",
      instructions:
        "Which entry in `catalog` is the AFFECTED service — the one whose own health/metrics/errors `alert` is reporting on? Alerts sometimes name other services only as context, a dependency, or a downstream/upstream effect; those are NOT the affected service, only the one the alert's metric is actually about.",
      criteria: serviceCriteria,
    },
    severity: {
      type: "choice",
      instructions:
        "What severity does `alert` itself state or clearly indicate (e.g. an explicit CRITICAL/HIGH/MEDIUM/LOW/INFO/WARNING tag, or an equivalent like P1/P2/sev1/sev2)? Judge only the severity indicator in the alert text, not how severe the underlying issue sounds.",
      criteria: {
        critical: "the alert states or clearly indicates severity CRITICAL (e.g. 'CRITICAL', P1, sev1)",
        high: "the alert states or clearly indicates severity HIGH (e.g. 'HIGH', P2, sev2)",
        other: "the alert states a lower severity, e.g. medium, low, warning, or info",
        unclear: "no severity indicator can be determined from the alert text",
      },
    },
  };
}

export function decide(answers, input) {
  const serviceAns = answers.affected_service;
  const severityAns = answers.severity;

  const serviceConf = serviceAns.probabilities?.[serviceAns.choice] ?? serviceAns.confidence;
  const severityConf = severityAns.probabilities?.[severityAns.choice] ?? severityAns.confidence;

  const entry = input.catalog.find((e) => e.service === serviceAns.choice);

  const teamKnown =
    serviceAns.choice !== "unclear" && entry !== undefined && serviceConf >= TEAM_CONF_THRESHOLD;

  const team = teamKnown ? entry.owner_team : "abstain";

  const severityKnown = severityAns.choice !== "unclear" && severityConf >= SEVERITY_CONF_THRESHOLD;

  let page_now = "abstain";
  if (teamKnown && severityKnown) {
    if (severityAns.choice === "critical") {
      page_now = "yes";
    } else if (severityAns.choice === "high") {
      page_now = entry.tier === 1 ? "yes" : "no";
    } else {
      page_now = "no";
    }
  }

  return { team, page_now };
}
