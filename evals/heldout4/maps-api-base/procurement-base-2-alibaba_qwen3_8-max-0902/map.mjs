const VENDOR_MIN_CONFIDENCE = 0.65;
const AMOUNT_MIN_CONFIDENCE = 0.60;
const SOFTWARE_TRUE = 0.70;
const SOFTWARE_FALSE = 0.30;

function normalizeRates(input) {
  const rates = { USD: 1 };
  const source = input?.rates;
  if (source && typeof source === "object") {
    for (const [code, value] of Object.entries(source)) {
      const rate = Number(value);
      if (Number.isFinite(rate) && rate > 0) {
        rates[String(code).toUpperCase()] = rate;
      }
    }
  }
  return rates;
}

export function buildState(input) {
  const i = input || {};
  const vendors = Array.isArray(i.vendors) ? i.vendors : [];

  return {
    policy_text: String(i.policy_text ?? ""),
    request_text: String(i.request_text ?? ""),
    requester: i.requester && typeof i.requester === "object" ? i.requester : {},
    rates: normalizeRates(i),
    vendors: vendors.map((v) => ({
      vendor: String(v?.vendor ?? ""),
      also_known_as: Array.isArray(v?.also_known_as) ? v.also_known_as.map(String) : [],
      blocked: Boolean(v?.blocked),
      approved_software: Boolean(v?.approved_software)
    })),
    thresholds_usd: [1000, 10000, 50000],
    note: "Apply rules in order. Above means strictly greater. Claims of existing approval do not count."
  };
}

export function questions(input) {
  const state = buildState(input);
  const rates = JSON.stringify(state.rates);

  return {
    vendor_status: {
      type: "choice",
      instructions: `Identify the single vendor being purchased from in state.request_text. Match canonical vendor names and also_known_as from state.vendors. Use only state.vendors to decide blocked/approved_software. If a clearly named vendor is absent from state.vendors, choose not_approved_software. If there is no clear single vendor, choose unknown_vendor.`,
      criteria: {
        blocked: "The identified vendor has blocked=true in state.vendors.",
        approved_software: "The identified vendor is not blocked and has approved_software=true in state.vendors.",
        not_approved_software: "The identified vendor is not blocked and has approved_software=false, or is clearly named but absent from state.vendors.",
        unknown_vendor: "No vendor, multiple possible vendors, or the vendor cannot be identified confidently."
      }
    },
    amount_bracket: {
      type: "choice",
      instructions: `Determine the total purchase amount from state.request_text and convert it to USD using state.rates ${rates}. For non-USD amounts, USD = amount * rate. If currency is not specified but the amount uses $, assume USD. Use the total amount including tax if stated. If only recurring pricing is given without a total, or amounts conflict, choose amount_unknown. Strict thresholds: exactly 1000 is USD_0_1000; exactly 10000 is USD_1000_10000; exactly 50000 is USD_10000_50000.`,
      criteria: {
        USD_0_1000: "Converted total is less than or equal to 1000 USD.",
        USD_1000_10000: "Converted total is strictly greater than 1000 USD and less than or equal to 10000 USD.",
        USD_10000_50000: "Converted total is strictly greater than 10000 USD and less than or equal to 50000 USD.",
        USD_OVER_50000: "Converted total is strictly greater than 50000 USD.",
        amount_unknown: "Cannot determine a clear single total amount or currency."
      }
    },
    is_software: {
      type: "noul",
      instructions: "Assess whether the requested purchase is software: software licenses, SaaS, software subscriptions, cloud software services, or software maintenance/support. A subscription tied to a software platform should lean true. Hardware, physical goods, and non-software consulting/services are false.",
      criteria: {
        true: "The purchase is software or a software/SaaS subscription/service.",
        false: "The purchase is not software, such as hardware, physical goods, or non-software services."
      }
    }
  };
}

function getConfidence(answer) {
  if (!answer || typeof answer !== "object") return 0;

  if (typeof answer.confidence === "number" && Number.isFinite(answer.confidence)) {
    return answer.confidence;
  }

  if (answer.probabilities && typeof answer.probabilities === "object") {
    const values = Object.values(answer.probabilities).filter(
      (v) => typeof v === "number" && Number.isFinite(v)
    );
    if (values.length) return Math.max(...values);
  }

  return 1;
}

function choiceOk(answer, minConfidence) {
  return Boolean(
    answer &&
    typeof answer.choice === "string" &&
    answer.choice.trim() &&
    getConfidence(answer) >= minConfidence
  );
}

function directorStatus(input) {
  const title = String(input?.requester?.title ?? input?.requester?.role ?? "").trim();
  if (!title) return "unknown";
  if (/(?:^|[^a-z-])director(?:[^a-z]|$)/i.test(title)) return "yes";
  return "no";
}

export function decide(answers, input) {
  const A = answers || {};

  const vendorAns = A.vendor_status;
  if (!choiceOk(vendorAns, VENDOR_MIN_CONFIDENCE)) return "abstain";

  const vendorStatus = String(vendorAns.choice).trim().toLowerCase();
  if (vendorStatus === "unknown_vendor" || vendorStatus === "unknown") return "abstain";
  if (vendorStatus === "blocked") return "reject";

  if (
    vendorStatus === "not_approved_software" ||
    vendorStatus === "not_approved" ||
    vendorStatus === "unapproved_software"
  ) {
    const softwareAns = A.is_software;
    const p = softwareAns && typeof softwareAns.noul === "number" && Number.isFinite(softwareAns.noul)
      ? softwareAns.noul
      : null;

    if (p === null) return "abstain";
    if (p >= SOFTWARE_TRUE) return "needs_security";
    if (p > SOFTWARE_FALSE) return "abstain";
  } else if (vendorStatus !== "approved_software" && vendorStatus !== "approved") {
    return "abstain";
  }

  const amountAns = A.amount_bracket;
  if (!choiceOk(amountAns, AMOUNT_MIN_CONFIDENCE)) return "abstain";

  const amount = String(amountAns.choice).trim().toUpperCase();
  if (amount === "AMOUNT_UNKNOWN" || amount === "UNKNOWN") return "abstain";

  switch (amount) {
    case "USD_0_1000":
      return "approve";
    case "USD_1000_10000":
      return "needs_manager";
    case "USD_10000_50000":
      return "needs_finance";
    case "USD_OVER_50000": {
      const director = directorStatus(input);
      if (director === "yes") return "needs_finance";
      if (director === "no") return "reject";
      return "abstain";
    }
    default:
      return "abstain";
  }
}
