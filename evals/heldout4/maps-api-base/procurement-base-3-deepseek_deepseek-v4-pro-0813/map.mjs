// map.mjs
const MAX_VENDOR_CHOICE_OPTIONS = 255;

export function buildState(input) {
  return {
    policy_text: input.policy_text || "",
    rates: input.rates || { USD: 1 },
    vendors: input.vendors || [],
    requester: input.requester || {},
    request_text: input.request_text || ""
  };
}

export function questions(input) {
  const qs = {};

  qs.vendor_choice = {
    type: "choice",
    instructions: `Identify the vendor in the purchase request. Choose the exact matching option from the criteria, either a canonical vendor name or an alias. If the request does not mention any vendor from the provided list, or the vendor is ambiguous, choose "none".`,
    criteria: buildVendorCriteria(input.vendors || [])
  };

  qs.is_software = {
    type: "noul",
    instructions: `Determine whether the purchase request is for software. Include software licenses, SaaS, cloud services, online service subscriptions, monitoring services, database services, and other digital/software purchases. Do not include hardware, physical goods, consulting, or non-digital services.`,
    criteria: {
      true: "The purchase is for software or a digital/online service.",
      false: "The purchase is not for software (e.g., hardware, physical goods, consulting, non-digital services)."
    }
  };

  qs.amount_above_1000_usd = {
    type: "noul",
    instructions: `Consider the total purchase amount in the request. Using the rates provided in the state, convert any non-USD amount to USD. Is the total amount strictly greater than 1,000 USD?`,
    criteria: {
      true: "The total converted amount is strictly greater than 1,000 USD.",
      false: "The total converted amount is 1,000 USD or less."
    }
  };

  qs.amount_above_10000_usd = {
    type: "noul",
    instructions: `Consider the total purchase amount in the request. Using the rates provided in the state, convert any non-USD amount to USD. Is the total amount strictly greater than 10,000 USD?`,
    criteria: {
      true: "The total converted amount is strictly greater than 10,000 USD.",
      false: "The total converted amount is 10,000 USD or less."
    }
  };

  qs.amount_above_50000_usd = {
    type: "noul",
    instructions: `Consider the total purchase amount in the request. Using the rates provided in the state, convert any non-USD amount to USD. Is the total amount strictly greater than 50,000 USD?`,
    criteria: {
      true: "The total converted amount is strictly greater than 50,000 USD.",
      false: "The total converted amount is 50,000 USD or less."
    }
  };

  return qs;
}

function buildVendorCriteria(vendors) {
  const maxBeforeNone = MAX_VENDOR_CHOICE_OPTIONS - 1;
  const canonical = [];
  const aliases = [];

  for (const v of vendors) {
    const name = v && v.vendor;
    if (!name) continue;

    const aka = Array.isArray(v.also_known_as)
      ? v.also_known_as.filter((a) => a && a !== name && a !== "none")
      : [];

    const aliasText = aka.length ? ` (aliases: ${aka.join(", ")})` : "";
    canonical.push({ key: name, desc: `Canonical vendor: ${name}${aliasText}` });

    for (const alias of aka) {
      aliases.push({ key: alias, desc: `Alias for ${name}` });
    }
  }

  let selected = [];

  if (canonical.length <= maxBeforeNone) {
    selected = canonical.slice();
    const seen = new Set(selected.map((s) => s.key));
    let remaining = maxBeforeNone - selected.length;

    for (const alias of aliases) {
      if (remaining <= 0) break;
      if (!seen.has(alias.key)) {
        selected.push(alias);
        seen.add(alias.key);
        remaining--;
      }
    }
  } else {
    selected = canonical.slice(0, maxBeforeNone);
  }

  const criteria = {};
  for (const s of selected) {
    if (s.key !== "none") criteria[s.key] = s.desc;
  }
  criteria.none = "No listed vendor is mentioned, or the vendor is ambiguous.";
  return criteria;
}

export function decide(answers, input) {
  answers = answers || {};

  const vendors = input.vendors || [];
  const vendorMap = new Map();
  for (const v of vendors) {
    if (!v || !v.vendor) continue;
    vendorMap.set(v.vendor, v);
    for (const alias of v.also_known_as || []) {
      if (alias) vendorMap.set(alias, v);
    }
  }

  const vendorAns = answers.vendor_choice || {};
  const vendorKey = vendorAns.choice;
  if (!vendorKey || vendorKey === "none") {
    return { decision: "abstain" };
  }

  const vendor = vendorMap.get(vendorKey);
  if (!vendor) {
    return { decision: "abstain" };
  }

  // Rule 1: blocked vendor -> reject.
  if (vendor.blocked) {
    return { decision: "reject" };
  }

  const isSoftware = noulBool(answers.is_software);

  // Rule 2: software from a vendor not on approved-software list -> security.
  if (!vendor.approved_software) {
    if (isSoftware === null) {
      return { decision: "abstain" };
    }
    if (isSoftware) {
      return { decision: "needs_security" };
    }
  }

  const above1000 = noulBool(answers.amount_above_1000_usd);
  const above10000 = noulBool(answers.amount_above_10000_usd);
  const above50000 = noulBool(answers.amount_above_50000_usd);

  // Rule 3: above 50,000 USD -> reject unless director -> finance.
  if (above50000 === null) {
    return { decision: "abstain" };
  }
  if (above50000) {
    const title = (input.requester && input.requester.title) || "";
    if (/director/i.test(title)) {
      return { decision: "needs_finance" };
    }
    return { decision: "reject" };
  }

  // Rule 4: above 10,000 USD -> finance.
  if (above10000 === null) {
    return { decision: "abstain" };
  }
  if (above10000) {
    return { decision: "needs_finance" };
  }

  // Rule 5: above 1,000 USD -> manager.
  if (above1000 === null) {
    return { decision: "abstain" };
  }
  if (above1000) {
    return { decision: "needs_manager" };
  }

  // Rule 6: otherwise approve.
  return { decision: "approve" };
}

function noulBool(ans) {
  if (!ans || typeof ans.noul !== "number") return null;
  return ans.noul >= 0.5;
}
