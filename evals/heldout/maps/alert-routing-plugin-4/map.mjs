// Alert routing: identify affected service (from catalog) and decide page-vs-ticket.

const SERVICE_CONF_THRESHOLD = 0.55;
const SEVERITY_CONF_THRESHOLD = 0.65;

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

  const affectedServiceCriteria = {};
  for (const svc of services) {
    affectedServiceCriteria[svc] =
      `"${svc}" is the service that the text in \`alert\` explicitly reports as having the problem ` +
      `(the one whose error rate, latency, downtime, failed job, or resource exhaustion is described). ` +
      `Pick this only if the alert's own subject/target is "${svc}", not a service that is merely named ` +
      `as a dependency, upstream/downstream cause, related incident, or other context.`;
  }

  return {
    affected_service: {
      type: "choice",
      instructions:
        "Which entry in `catalog` (by its `service` name) is the service that `alert` is reporting a problem about? " +
        "The affected service is the one the alert's subject/target and metric describe, not any other service the " +
        "alert text mentions only as context, a dependency, or a related/downstream effect.",
      criteria: affectedServiceCriteria,
    },
    severity_bucket: {
      type: "choice",
      instructions: "What severity does the text in `alert` state or clearly imply for this alert?",
      criteria: {
        critical:
          "`alert` explicitly labels itself critical/fatal/sev-1/P0, or describes a total outage or " +
          "catastrophic failure with no qualification.",
        high:
          "`alert` explicitly labels itself high/severe/sev-2/P1, or describes a serious but partial " +
          "degradation, clearly below a critical/fatal/outage level.",
        other:
          "`alert` labels itself medium/low/warning/info/sev-3-or-lower/P2-or-lower, or gives no severity " +
          "indication beyond a routine threshold breach.",
      },
    },
  };
}

export function decide(answers, input) {
  const serviceAnswer = answers.affected_service;
  const severityAnswer = answers.severity_bucket;

  const serviceProb = serviceAnswer.probabilities?.[serviceAnswer.choice] ?? serviceAnswer.confidence;
  if (serviceProb < SERVICE_CONF_THRESHOLD) {
    return { team: "abstain", page_now: "abstain" };
  }

  const entry = input.catalog.find((c) => c.service === serviceAnswer.choice);
  if (!entry) {
    return { team: "abstain", page_now: "abstain" };
  }
  const team = entry.owner_team;

  const probs = severityAnswer.probabilities ?? {};
  const pCritical = probs.critical ?? 0;
  const pHigh = probs.high ?? 0;
  const pOther = probs.other ?? 0;

  let page_now;
  if (pCritical >= SEVERITY_CONF_THRESHOLD) {
    page_now = "yes";
  } else if (pHigh >= SEVERITY_CONF_THRESHOLD) {
    page_now = entry.tier === 1 ? "yes" : "no";
  } else if (pOther >= SEVERITY_CONF_THRESHOLD) {
    page_now = "no";
  } else {
    page_now = "abstain";
  }

  return { team, page_now };
}
