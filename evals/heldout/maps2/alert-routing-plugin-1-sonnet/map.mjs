// Jev map for alert routing: pick the affected service, read its declared severity,
// then derive team + page_now in code from the catalog and the policy.

const CONFIDENCE_GATE = 0.6;

export function buildState(input) {
  return {
    alert: input.alert,
    catalog: input.catalog,
  };
}

export function questions(input) {
  const serviceCriteria = {};
  for (const c of input.catalog) {
    serviceCriteria[c.service] =
      `the problem described in \`alert\` (the error, latency, failure, etc.) is happening in ${c.service} itself`;
  }
  serviceCriteria.none =
    "no listed service is described as the one experiencing the problem in `alert`; every catalog service, if mentioned at all, appears only as context, a dependency, or a caller";

  return {
    affected_service: {
      type: "choice",
      instructions:
        "Which service from the catalog is the one actually experiencing the problem reported in `alert` (the affected/alerting service), as opposed to a service that `alert` merely names for context, as a downstream dependency, or as a caller?",
      criteria: serviceCriteria,
    },
    severity: {
      type: "choice",
      instructions:
        "What severity does `alert` declare for itself (an explicit tag or keyword such as CRITICAL, HIGH, SEV1/P1, SEV2/P2, WARNING, MEDIUM, LOW, INFO)?",
      criteria: {
        critical: "`alert` explicitly declares critical severity (e.g. CRITICAL, SEV1, P1)",
        high: "`alert` explicitly declares high severity (e.g. HIGH, SEV2, P2)",
        other:
          "`alert` declares a lower severity (medium, low, warning, info) or no severity matching critical or high",
      },
    },
  };
}

function topProb(answer) {
  if (answer.probabilities && answer.choice in answer.probabilities) {
    return answer.probabilities[answer.choice];
  }
  return answer.confidence;
}

export function decide(answers, input) {
  const serviceAns = answers.affected_service;
  const severityAns = answers.severity;

  if (
    !serviceAns ||
    serviceAns.choice === "none" ||
    topProb(serviceAns) < CONFIDENCE_GATE
  ) {
    return { team: "abstain", page_now: "abstain" };
  }

  const entry = input.catalog.find((c) => c.service === serviceAns.choice);
  if (!entry) {
    return { team: "abstain", page_now: "abstain" };
  }

  const team = entry.owner_team;

  if (!severityAns || topProb(severityAns) < CONFIDENCE_GATE) {
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
