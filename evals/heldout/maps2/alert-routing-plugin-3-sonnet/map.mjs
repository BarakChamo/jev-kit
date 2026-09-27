const SERVICE_PROB_MIN = 0.6;
const SEVERITY_PROB_MIN = 0.6;

export function buildState(input) {
  return { alert: input.alert, catalog: input.catalog };
}

export function questions(input) {
  const serviceCriteria = {};
  for (const c of input.catalog) {
    serviceCriteria[c.service] =
      `The alert in \`alert\` is reporting a problem occurring in the ${c.service} service itself ` +
      `(the thing that is failing, erroring, degraded, or triggering the alert) — not a service it ` +
      `merely mentions as a dependency, downstream consumer, or related context.`;
  }
  serviceCriteria.none =
    "No single service in the catalog list is clearly the one the alert reports a problem in, " +
    "or the service the alert is about is not present in the catalog.";

  return {
    affected_service: {
      type: "choice",
      instructions:
        "Read the alert in `alert`. Alerts sometimes name other services only as context " +
        "(e.g. a downstream dependency, an upstream cause, or a related system) — those are not the " +
        "affected service. Which service, from the catalog in `catalog`, is the one the alert is " +
        "actually reporting a problem in?",
      criteria: serviceCriteria,
    },
    severity: {
      type: "choice",
      instructions:
        "Read the alert in `alert`. What severity level does it explicitly state or unambiguously " +
        "indicate for this event?",
      criteria: {
        critical:
          "The alert explicitly labels itself critical (e.g. '[CRITICAL]'), or describes a complete " +
          "outage / total failure with no qualifier of a lesser severity.",
        high:
          "The alert explicitly labels itself high/severe, or describes a serious but partial " +
          "degradation (e.g. elevated error rate, latency, partial outage) without being labeled critical.",
        medium:
          "The alert explicitly labels itself medium/warning, or describes a moderate, non-urgent issue.",
        low:
          "The alert explicitly labels itself low/info, or describes a minor or informational issue.",
        unknown:
          "The alert states no severity level and its text does not clearly indicate one of the above.",
      },
    },
  };
}

export function decide(answers, input) {
  const svc = answers.affected_service;
  const sev = answers.severity;

  const svcEntry = input.catalog.find((c) => c.service === svc.choice);
  const svcResolved =
    svc.choice !== "none" && !!svcEntry && (svc.probabilities?.[svc.choice] ?? svc.confidence) >= SERVICE_PROB_MIN;

  const sevResolved =
    sev.choice !== "unknown" && (sev.probabilities?.[sev.choice] ?? sev.confidence) >= SEVERITY_PROB_MIN;

  const team = svcResolved ? svcEntry.owner_team : "abstain";

  let page_now = "abstain";
  if (sevResolved) {
    if (sev.choice === "critical") {
      page_now = "yes";
    } else if (sev.choice === "high") {
      page_now = svcResolved ? (svcEntry.tier === 1 ? "yes" : "no") : "abstain";
    } else {
      page_now = "no";
    }
  }

  return { team, page_now };
}
