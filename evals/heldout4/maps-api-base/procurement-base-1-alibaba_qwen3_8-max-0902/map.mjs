const CONF = 0.6;

function getRates(input) {
  return input?.rates && typeof input.rates === "object" && !Array.isArray(input.rates)
    ? input.rates
    : { USD: 1 };
}

function normalizeState(input) {
  const rates = getRates(input);
  const vendors = Array.isArray(input?.vendors)
    ? input.vendors.map((v) => ({
        name: v?.vendor ?? v?.name ?? "",
        aliases: Array.isArray(v?.also_known_as) ? v.also_known_as : [],
        blocked: Boolean(v?.blocked),
        approved_software: Boolean(v?.approved_software)
      }))
    : [];

  return {
    policy_text: input?.policy_text ?? "",
    rates,
    vendors,
    requester: input?.requester ?? null,
    request_text: input?.request_text ?? ""
  };
}

export function buildState(input) {
  return normalizeState(input);
}

export function questions(input) {
  const rates = getRates(input);
  const currencies = Object.keys(rates).join(", ") || "USD";

  return {
    vendor_category: {
      type: "choice",
      instructions:
        "Using state.request_text and state.vendors, identify the vendor being purchased. Match vendor name or aliases. Choose one vendor status. If multiple vendors are requested or the vendor is ambiguous, choose unclear.",
      criteria: {
        blocked: "The single requested vendor is in state.vendors and blocked is true.",
        approved:
          "The single requested vendor is in state.vendors, blocked is false, and approved_software is true.",
        not_approved:
          "The single requested vendor is in state.vendors with blocked false and approved_software false, or a vendor is clearly mentioned but not in state.vendors.",
        unclear: "No clear single vendor can be identified."
      }
    },
    software_category: {
      type: "choice",
      instructions:
        "Decide whether the purchase is a software purchase. Software includes licenses, subscriptions, SaaS, custom software, and software support or maintenance. If software and non-software are bundled and software is material, choose software.",
      criteria: {
        software: "The purchase is primarily software or a software subscription/service.",
        not_software: "The purchase is primarily hardware, physical goods, or non-software services.",
        unclear: "Cannot determine whether the purchase includes software."
      }
    },
    amount_category: {
      type: "choice",
      instructions: `Determine the total purchase amount in USD from state.request_text. If unit price and quantity are clear, use quantity * unit price. Convert non-USD currencies using state.rates: USD = amount * rate. Available currencies: ${currencies}. If no currency is stated, assume USD. If a currency is not in state.rates, choose unclear. If the amount is missing, ambiguous, recurring without a stated term, or has multiple possible totals, choose unclear. Thresholds are inclusive at the top of the lower category.`,
      criteria: {
        le1000: "Total is less than or equal to 1000 USD.",
        le10000: "Total is greater than 1000 USD and less than or equal to 10000 USD.",
        le50000: "Total is greater than 10000 USD and less than or equal to 50000 USD.",
        gt50000: "Total is greater than 50000 USD.",
        unclear: "Cannot determine a single total USD amount."
      }
    }
  };
}

function getChoice(answers, id) {
  const a = answers?.[id];
  if (!a || typeof a.choice !== "string") return null;

  let conf = NaN;
  if (a.confidence !== undefined && a.confidence !== null) {
    conf = Number(a.confidence);
  }
  if (!Number.isFinite(conf) && a.probabilities) {
    conf = Number(a.probabilities[a.choice]);
  }
  if (!Number.isFinite(conf)) conf = 1;

  conf = Math.max(0, Math.min(1, conf));
  return { choice: a.choice, conf };
}

function isDirector(input) {
  const title = input?.requester?.title;
  if (typeof title !== "string" || title.trim() === "") return null;
  return /\bdirector\b/i.test(title);
}

export function decide(answers, input) {
  const vendor = getChoice(answers, "vendor_category");
  if (!vendor || vendor.choice === "unclear" || vendor.conf < CONF) {
    return { decision: "abstain" };
  }

  if (vendor.choice === "blocked") {
    return { decision: "reject" };
  }

  if (vendor.choice === "not_approved") {
    const software = getChoice(answers, "software_category");
    if (!software || software.choice === "unclear" || software.conf < CONF) {
      return { decision: "abstain" };
    }
    if (software.choice === "software") {
      return { decision: "needs_security" };
    }
    if (software.choice !== "not_software") {
      return { decision: "abstain" };
    }
  } else if (vendor.choice !== "approved") {
    return { decision: "abstain" };
  }

  const amount = getChoice(answers, "amount_category");
  if (!amount || amount.choice === "unclear" || amount.conf < CONF) {
    return { decision: "abstain" };
  }

  if (amount.choice === "gt50000") {
    const director = isDirector(input);
    if (director === true) return { decision: "needs_finance" };
    if (director === false) return { decision: "reject" };
    return { decision: "abstain" };
  }

  if (amount.choice === "le50000") return { decision: "needs_finance" };
  if (amount.choice === "le10000") return { decision: "needs_manager" };
  if (amount.choice === "le1000") return { decision: "approve" };

  return { decision: "abstain" };
}
