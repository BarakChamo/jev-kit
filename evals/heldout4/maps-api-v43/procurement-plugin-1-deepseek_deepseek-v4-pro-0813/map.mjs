const AMBIGUOUS = "__ambiguous__";
const UNLISTED = "__unlisted__";

const GATES = {
  vendor: 0.70,
  software: 0.60,
  amount: 0.75,
  currency: 0.70,
};

function topProb(answer) {
  if (!answer || !answer.probabilities) return 0;
  const p = answer.probabilities[answer.choice];
  return typeof p === "number" ? p : (typeof answer.confidence === "number" ? answer.confidence : 0);
}

function noulCertain(prob, threshold) {
  return prob >= threshold || prob <= 1 - threshold;
}

function extractNumbers(text) {
  if (!text) return [];
  const matches = text.match(/(?:\d[\d,]*(?:\.\d+)?|\.\d+)/g) || [];
  return [...new Set(matches)];
}

function parseAmount(text) {
  if (typeof text !== "string") return NaN;
  return Number(text.replace(/,/g, ""));
}

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    rates: input.rates,
    vendors: (input.vendors || []).map((v) => ({
      vendor: v.vendor,
      also_known_as: v.also_known_as || [],
    })),
    requester: input.requester,
    request_text: input.request_text,
  };
}

export function questions(input) {
  const vendors = input.vendors || [];

  const vendorCriteria = {};
  for (const v of vendors) {
    const aliasText = v.also_known_as && v.also_known_as.length > 0
      ? ` (also known as: ${v.also_known_as.join(", ")})`
      : "";
    vendorCriteria[v.vendor] = `${v.vendor}${aliasText}`;
  }
  vendorCriteria[UNLISTED] = "a vendor not present in the vendor list";
  vendorCriteria[AMBIGUOUS] = "the request is genuinely unclear which listed vendor, or more than one is supported; a person should decide";

  const currencyDescriptions = {
    USD: "US dollar, $, USD, or no currency stated (the policy says amounts are in US dollars)",
    EUR: "euro, EUR, €",
    GBP: "pound sterling, GBP, £",
    JPY: "Japanese yen, JPY, ¥",
  };

  const rateCodes = new Set([...(Object.keys(input.rates || {})), "USD"]);
  const currencyCriteria = {};
  for (const code of rateCodes) {
    currencyCriteria[code] = currencyDescriptions[code] || `${code} currency`;
  }
  currencyCriteria[AMBIGUOUS] = "the currency is genuinely ambiguous or more than one currency is supported; a person should decide";

  const q = {
    vendor: {
      type: "choice",
      instructions:
        "Which vendor listed in `vendors` is the purchase in `request_text` being made from? Match the canonical `vendor` name or one of its `also_known_as` aliases. If the request names a vendor not in `vendors`, choose `" + UNLISTED + "`. Do not use amounts or approval claims to decide.",
      criteria: vendorCriteria,
    },
    software: {
      type: "noul",
      instructions:
        "Does `request_text` describe a purchase that includes software, a software subscription, a software license, or a SaaS/cloud/digital software service? Hardware-only, consulting, or physical goods do not count by themselves.",
      criteria: {
        true: "the purchase includes software, a software subscription, a software license, or a SaaS/cloud/digital software service",
        false: "the purchase does not include any software or digital software service",
      },
    },
    currency: {
      type: "choice",
      instructions:
        "In which currency is the total purchase amount in `request_text` stated? Select the currency code or symbol shown with the amount. If no currency is stated, select USD per the policy. If it is genuinely ambiguous, choose `" + AMBIGUOUS + "`.",
      criteria: currencyCriteria,
    },
  };

  const amountCandidates = extractNumbers(input.request_text);
  if (amountCandidates.length > 0 && amountCandidates.length <= 200) {
    const amountCriteria = {};
    amountCandidates.forEach((text, index) => {
      amountCriteria[String(index)] = `Number candidate: ${text}`;
    });
    amountCriteria[AMBIGUOUS] =
      "multiple numbers could be the total amount, or the amount is genuinely unclear; a person should decide";

    q.amount_number = {
      type: "choice",
      instructions:
        "Which number in `request_text` is the total purchase amount? Ignore quantities, unit counts, durations, dates, tax and discount details. Choose `" + AMBIGUOUS + "` only if the total amount cannot be determined from the text.",
      criteria: amountCriteria,
    };
  }

  return q;
}

export function decide(answers, input) {
  const vendorAns = answers && answers.vendor;
  if (!vendorAns || vendorAns.choice === AMBIGUOUS || topProb(vendorAns) < GATES.vendor) {
    return { decision: "abstain" };
  }

  const vendorName = vendorAns.choice;
  const isUnlisted = vendorName === UNLISTED;
  const vendor = isUnlisted
    ? undefined
    : (input.vendors || []).find((v) => v.vendor === vendorName);

  if (!isUnlisted && !vendor) {
    return { decision: "abstain" };
  }

  const softwareAns = answers.software;
  if (!softwareAns || !noulCertain(softwareAns.noul, GATES.software)) {
    return { decision: "abstain" };
  }
  const isSoftware = softwareAns.noul >= 0.5;

  const amountAns = answers.amount_number;
  if (!amountAns || amountAns.choice === AMBIGUOUS || topProb(amountAns) < GATES.amount) {
    return { decision: "abstain" };
  }

  const currencyAns = answers.currency;
  if (!currencyAns || currencyAns.choice === AMBIGUOUS || topProb(currencyAns) < GATES.currency) {
    return { decision: "abstain" };
  }

  const amountCandidates = extractNumbers(input.request_text);
  const amountIndex = Number(amountAns.choice);
  if (!Number.isInteger(amountIndex) || amountIndex < 0 || amountIndex >= amountCandidates.length) {
    return { decision: "abstain" };
  }

  const amount = parseAmount(amountCandidates[amountIndex]);
  if (!Number.isFinite(amount) || amount < 0) {
    return { decision: "abstain" };
  }

  const currency = currencyAns.choice;
  const rate = currency === "USD" ? (input.rates?.USD ?? 1) : input.rates?.[currency];
  if (!Number.isFinite(rate) || rate <= 0) {
    return { decision: "abstain" };
  }
  const usdAmount = amount * rate;

  const blocked = !!vendor?.blocked;
  const approvedSoftware = !!vendor?.approved_software;
  const isDirector = /\bdirector\b/i.test(input.requester?.title || "");

  let decision;
  if (blocked) {
    decision = "reject";
  } else if (isSoftware && !approvedSoftware) {
    decision = "needs_security";
  } else if (usdAmount > 50000) {
    decision = isDirector ? "needs_finance" : "reject";
  } else if (usdAmount > 10000) {
    decision = "needs_finance";
  } else if (usdAmount > 1000) {
    decision = "needs_manager";
  } else {
    decision = "approve";
  }

  return { decision };
}
