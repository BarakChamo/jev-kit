const VENDOR_STATUS = "vendor_status";
const SOFTWARE = "software";
const AMOUNT = "usd_amount";
const MIN_CONF = 0.6;

function arr(x) {
  return Array.isArray(x) ? x : x == null ? [] : [x];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function buildState(input) {
  const i = input ?? {};

  const rates = { USD: 1 };
  for (const [code, rate] of Object.entries(i.rates ?? {})) {
    const n = Number(rate);
    if (Number.isFinite(n)) rates[String(code).toUpperCase()] = n;
  }

  const vendors = arr(i.vendors).map((v) => ({
    name: v?.vendor ?? "",
    aliases: unique([v?.vendor, ...arr(v?.also_known_as)]),
    blocked: Boolean(v?.blocked),
    approved_software: Boolean(v?.approved_software)
  }));

  return {
    policy: i.policy_text ?? "",
    request_text: String(i.request_text ?? ""),
    requester: i.requester ?? {},
    rates,
    thresholds_usd: [1000, 10000, 50000],
    vendors,
    blocked_aliases: unique(vendors.filter((v) => v.blocked).flatMap((v) => v.aliases)),
    approved_software_aliases: unique(
      vendors.filter((v) => !v.blocked && v.approved_software).flatMap((v) => v.aliases)
    ),
    listed_aliases: unique(vendors.flatMap((v) => v.aliases))
  };
}

export function questions(input) {
  return {
    [VENDOR_STATUS]: {
      type: "choice",
      instructions:
        "Identify the vendor/supplier in state.request_text. Match names/aliases against state.listed_aliases, state.blocked_aliases, and state.approved_software_aliases. If a clear vendor is not listed, choose not_approved_software. If no clear vendor can be identified, choose unknown.",
      criteria: {
        blocked: "The purchase vendor matches state.blocked_aliases.",
        approved_software: "The purchase vendor matches state.approved_software_aliases and is not blocked.",
        not_approved_software:
          "A clear vendor is mentioned but is not approved-software, including listed vendors without approved_software and unlisted vendors.",
        unknown: "No vendor is mentioned clearly enough to identify."
      }
    },
    [SOFTWARE]: {
      type: "choice",
      instructions:
        "Decide whether the purchase is for software or a software/service subscription/licence. Hardware, physical goods, and consulting/professional services are not software. If unclear, choose unknown.",
      criteria: {
        software:
          "Software, SaaS, subscription, licence, digital/online service, cloud software/API, monitoring/analytics platform.",
        not_software:
          "Hardware, devices, physical goods, facilities, consulting/professional services, non-software services.",
        unknown: "Cannot tell whether the purchase is software."
      }
    },
    [AMOUNT]: {
      type: "choice",
      instructions:
        "Determine the total purchase amount from state.request_text. If line items are given, sum them. Treat k/K as thousand. Convert to USD using state.rates as amount * rate. If currency is missing/unrecognized or the total is unclear/conflicting, choose unknown. Thresholds are strictly greater.",
      criteria: {
        le_1000: "USD total <= 1000.",
        gt_1000_le_10000: "USD total > 1000 and <= 10000.",
        gt_10000_le_50000: "USD total > 10000 and <= 50000.",
        gt_50000: "USD total > 50000.",
        unknown: "Amount cannot be determined or converted."
      }
    }
  };
}

function normalizeText(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeChoice(id, raw) {
  const s = normalizeText(raw);

  if (id === VENDOR_STATUS) {
    if (s === "blocked") return "blocked";
    if (s === "approved_software" || s === "approved" || s === "approved_vendor") return "approved_software";
    if (
      s === "not_approved_software" ||
      s === "not_approved" ||
      s === "unapproved_software" ||
      s === "unapproved"
    ) {
      return "not_approved_software";
    }
    if (s === "unknown" || s === "unclear" || s === "no_vendor" || s === "none") return "unknown";
    return s;
  }

  if (id === SOFTWARE) {
    if (s === "software" || s === "yes" || s === "true") return "software";
    if (
      s === "not_software" ||
      s === "no" ||
      s === "false" ||
      s === "hardware" ||
      s === "services"
    ) {
      return "not_software";
    }
    if (s === "unknown" || s === "unclear") return "unknown";
    return s;
  }

  if (id === AMOUNT) {
    if (
      s === "le_1000" ||
      s === "lte_1000" ||
      s === "1000_or_less" ||
      s === "under_1000" ||
      s === "below_1000" ||
      s === "1000"
    ) {
      return "le_1000";
    }
    if (
      s === "gt_1000_le_10000" ||
      s === "gt_1000_lte_10000" ||
      s === "between_1000_and_10000"
    ) {
      return "gt_1000_le_10000";
    }
    if (
      s === "gt_10000_le_50000" ||
      s === "gt_10000_lte_50000" ||
      s === "between_10000_and_50000" ||
      s === "50000"
    ) {
      return "gt_10000_le_50000";
    }
    if (s === "gt_50000" || s === "over_50000" || s === "above_50000") return "gt_50000";
    if (s === "unknown" || s === "unclear") return "unknown";
    return s;
  }

  return s;
}

function getChoice(answers, id) {
  const a = answers?.[id];
  if (!a) return null;

  const probs = a.probabilities && typeof a.probabilities === "object" ? a.probabilities : {};
  let raw = a.choice;
  let conf = Number(a.confidence);

  if (raw == null) {
    const entries = Object.entries(probs)
      .map(([k, v]) => [k, Number(v)])
      .filter(([, v]) => Number.isFinite(v))
      .sort((x, y) => y[1] - x[1]);

    if (!entries.length) return null;
    raw = entries[0][0];
    if (!Number.isFinite(conf)) conf = entries[0][1];
  }

  if (!Number.isFinite(conf)) {
    const vals = Object.values(probs).map(Number).filter(Number.isFinite);
    conf = vals.length ? Math.max(...vals) : 1;
  }

  return {
    choice: normalizeChoice(id, raw),
    conf: Math.max(0, Math.min(1, conf))
  };
}

function isDirector(input) {
  return /\bdirector\b/i.test(String(input?.requester?.title ?? ""));
}

export function decide(answers, input) {
  const vendor = getChoice(answers, VENDOR_STATUS);
  const software = getChoice(answers, SOFTWARE);
  const amount = getChoice(answers, AMOUNT);

  if (!vendor || vendor.choice === "unknown" || vendor.conf < MIN_CONF) {
    return { decision: "abstain" };
  }

  if (vendor.choice === "blocked") {
    return { decision: "reject" };
  }

  if (vendor.choice === "not_approved_software") {
    if (!software || software.choice === "unknown" || software.conf < MIN_CONF) {
      return { decision: "abstain" };
    }

    if (software.choice === "software") {
      return { decision: "needs_security" };
    }

    if (software.choice !== "not_software") {
      return { decision: "abstain" };
    }
  } else if (vendor.choice !== "approved_software") {
    return { decision: "abstain" };
  }

  if (!amount || amount.choice === "unknown" || amount.conf < MIN_CONF) {
    return { decision: "abstain" };
  }

  switch (amount.choice) {
    case "gt_50000":
      return { decision: isDirector(input) ? "needs_finance" : "reject" };
    case "gt_10000_le_50000":
      return { decision: "needs_finance" };
    case "gt_1000_le_10000":
      return { decision: "needs_manager" };
    case "le_1000":
      return { decision: "approve" };
    default:
      return { decision: "abstain" };
  }
}
