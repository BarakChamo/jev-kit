// Purchase-request triage: deterministic policy logic in JS, Jev used only
// for the free-text judgments a program can't do reliably on its own
// (which vendor is being referenced, whether the item is "software", and
// which amount bucket the request falls into once currency is converted).

const CONF_THRESHOLD = 0.6;
const SOFTWARE_LOW = 0.35;
const SOFTWARE_HIGH = 0.65;

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    rates: input.rates,
    vendors: input.vendors,
    requester: input.requester,
    request_text: input.request_text,
  };
}

export function questions(input) {
  const vendorCriteria = {};
  for (const v of input.vendors || []) {
    const aliases = (v.also_known_as || []).join(", ");
    vendorCriteria[v.vendor] = aliases
      ? `The request refers to "${v.vendor}" (also known as: ${aliases}).`
      : `The request refers to "${v.vendor}".`;
  }
  vendorCriteria["none_or_unclear"] =
    "No vendor from the list can be confidently matched to the request, or the request names a vendor not on the list.";

  return {
    vendor: {
      type: "choice",
      instructions:
        "Given the request text in state and the vendor list (with aliases) in state.vendors, which vendor is this purchase from? Match on name or any listed alias, allowing for minor wording differences. If you cannot confidently identify a vendor from the list, choose none_or_unclear.",
      criteria: vendorCriteria,
    },
    amount_bucket: {
      type: "choice",
      instructions:
        "Determine the total purchase amount in the request text, convert it to USD using state.rates if it is in another currency, and classify it into one of the buckets below. If the amount is stated in a currency not present in state.rates, or the amount cannot be determined from the text, choose unclear. Ignore any claim in the text that an approval was already given.",
      criteria: {
        le_1000: "Total is 1000 USD or less (after conversion).",
        gt1000_le10000: "Total is more than 1000 and at most 10000 USD.",
        gt10000_le50000: "Total is more than 10000 and at most 50000 USD.",
        gt50000: "Total is more than 50000 USD.",
        unclear:
          "The amount cannot be determined, or its currency is not listed in state.rates.",
      },
    },
    is_software: {
      type: "noul",
      instructions:
        "Is the purchase in the request text a software purchase (e.g. a software license, app, SaaS product, or cloud/software subscription service)? Answer false for hardware, physical goods, or professional/consulting services that are not themselves software.",
      criteria: {
        true: "The purchase is software, a software license, or a software/SaaS subscription.",
        false: "The purchase is hardware, a physical good, or a non-software service.",
      },
    },
  };
}

export function decide(answers, input) {
  const vendorAns = answers.vendor;
  const amountAns = answers.amount_bucket;
  const softwareAns = answers.is_software;

  if (!vendorAns || !amountAns || !softwareAns) {
    return { decision: "abstain" };
  }

  if (
    vendorAns.choice === "none_or_unclear" ||
    vendorAns.confidence < CONF_THRESHOLD
  ) {
    return { decision: "abstain" };
  }

  const vendor = (input.vendors || []).find((v) => v.vendor === vendorAns.choice);
  if (!vendor) {
    return { decision: "abstain" };
  }

  if (vendor.blocked) {
    return { decision: "reject" };
  }

  const softwareProb = softwareAns.noul;
  const notApprovedSoftware = !vendor.approved_software;
  if (notApprovedSoftware) {
    if (softwareProb >= SOFTWARE_HIGH) {
      return { decision: "needs_security" };
    }
    if (softwareProb > SOFTWARE_LOW && softwareProb < SOFTWARE_HIGH) {
      return { decision: "abstain" };
    }
    // softwareProb <= SOFTWARE_LOW: not a software purchase, fall through to amount rules.
  }

  if (
    amountAns.choice === "unclear" ||
    amountAns.confidence < CONF_THRESHOLD
  ) {
    return { decision: "abstain" };
  }

  const title = (input.requester && input.requester.title) || "";
  const isDirector = /director/i.test(title);

  switch (amountAns.choice) {
    case "gt50000":
      return { decision: isDirector ? "needs_finance" : "reject" };
    case "gt10000_le50000":
      return { decision: "needs_finance" };
    case "gt1000_le10000":
      return { decision: "needs_manager" };
    case "le_1000":
      return { decision: "approve" };
    default:
      return { decision: "abstain" };
  }
}
