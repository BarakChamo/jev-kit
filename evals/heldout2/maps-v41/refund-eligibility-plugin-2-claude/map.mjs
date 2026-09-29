// Return-eligibility decision for a single item within a multi-item order,
// given a free-text customer message and a returns policy stated in prose.

const CHOICE_CONF_THRESH = 0.6;
const TRUE_THRESH = 0.65;
const FALSE_THRESH = 0.35;

function classify(p) {
  if (p >= TRUE_THRESH) return "true";
  if (p <= FALSE_THRESH) return "false";
  return "uncertain";
}

function daysBetween(fromDateStr, toDateStr) {
  const [y1, m1, d1] = fromDateStr.split("-").map(Number);
  const [y2, m2, d2] = toDateStr.split("-").map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((t2 - t1) / 86400000);
}

function extractDayNumbers(line) {
  return [...line.matchAll(/(\d+)\s*day/gi)].map((m) => parseInt(m[1], 10));
}

// Reads the stated windows and exclusions out of the policy text exactly as
// written; no arithmetic or judgment happens here, only literal extraction.
function parsePolicy(policyText) {
  const lines = policyText
    .split(/\n+/)
    .flatMap((l) => l.split(/(?<=\.)\s+/))
    .map((s) => s.trim())
    .filter(Boolean);

  let generalDays = null;
  let electronicsDays = null;
  let electronicsDefectiveDays = null;
  let electronicsRequiresUnopened = false;
  let giftCardExcluded = false;
  let finalSaleExcluded = false;

  for (const line of lines) {
    const ll = line.toLowerCase();
    const nums = extractDayNumbers(line);

    if (ll.includes("electronic")) {
      if (nums.length >= 1 && electronicsDays === null) electronicsDays = nums[0];
      if (ll.includes("unopened")) electronicsRequiresUnopened = true;
      if (ll.includes("defective")) {
        if (nums.length >= 2) electronicsDefectiveDays = nums[nums.length - 1];
        else if (nums.length === 1 && electronicsDays !== null && nums[0] !== electronicsDays) {
          electronicsDefectiveDays = nums[0];
        }
      }
    } else if (nums.length && /return/.test(ll) && generalDays === null) {
      generalDays = nums[0];
    }

    const excludes = /cannot be returned|not returnable|no returns?|not eligible/.test(ll);
    if (ll.includes("gift card") && excludes) giftCardExcluded = true;
    if (ll.includes("final sale") && excludes) finalSaleExcluded = true;
  }

  return {
    generalDays,
    electronicsDays,
    electronicsDefectiveDays,
    electronicsRequiresUnopened,
    giftCardExcluded,
    finalSaleExcluded,
    parsedOk: generalDays !== null && electronicsDays !== null && electronicsDefectiveDays !== null,
  };
}

function isElectronics(item) {
  return typeof item.category === "string" && item.category.toLowerCase().includes("electronic");
}

function isGiftCard(item) {
  const t = (s) => (s || "").toLowerCase().replace(/[_\s-]/g, "");
  return t(item.category).includes("giftcard") || t(item.name).includes("giftcard");
}

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    order_id: input.order.order_id,
    items: input.order.items,
    request_date: input.request.date,
    message: input.request.message,
  };
}

export function questions(input) {
  const items = input.order.items;

  const targetCriteria = {};
  for (const it of items) {
    targetCriteria[it.sku] = `The customer is asking to return "${it.name}" (SKU ${it.sku}).`;
  }
  targetCriteria.unclear =
    "The message does not clearly single out exactly one item from `items` (e.g. it names none of them, or clearly asks about more than one).";

  const qs = {
    target_item: {
      type: "choice",
      instructions:
        "Which single item from `items` is the customer asking to return, based on `message`? Match by product name/description to the `items` list.",
      criteria: targetCriteria,
    },
  };

  for (const it of items) {
    if (!isElectronics(it)) continue;
    qs[`unopened_${it.sku}`] = {
      type: "noul",
      instructions: `Does \`message\` state or clearly imply that the "${it.name}" (SKU ${it.sku}) has not been opened or used?`,
      criteria: {
        true: "message says or implies it is still unopened, unused, or sealed",
        false: "message says or implies it has been opened/used, or says nothing about this",
      },
    };
    qs[`defective_${it.sku}`] = {
      type: "noul",
      instructions: `Does \`message\` claim that the "${it.name}" (SKU ${it.sku}) is defective, broken, faulty, or otherwise not working?`,
      criteria: {
        true: "message claims a defect or malfunction in this item",
        false: "message does not claim any defect in this item",
      },
    };
  }

  return qs;
}

function decideElectronics(dayNumber, electronicsDays, electronicsDefectiveDays, defectiveP, unopenedP) {
  const def = classify(defectiveP);
  const uno = classify(unopenedP);

  if (dayNumber > electronicsDefectiveDays) return "no";

  if (dayNumber > electronicsDays) {
    if (def === "true") return "yes";
    if (def === "false") return "no";
    return "abstain";
  }

  if (uno === "true" || def === "true") return "yes";
  if (uno === "false" && def === "false") return "no";
  return "abstain";
}

export function decide(answers, input) {
  const items = input.order.items;

  const targetAns = answers.target_item;
  const choice = targetAns.choice;
  const p = targetAns.probabilities ? targetAns.probabilities[choice] : targetAns.confidence;

  if (choice === "unclear" || p === undefined || p < CHOICE_CONF_THRESH) {
    return { eligible: "abstain" };
  }

  const item = items.find((it) => it.sku === choice);
  if (!item) return { eligible: "abstain" };

  if (item.final_sale) return { eligible: "no" };

  const policy = parsePolicy(input.policy_text);

  if (isGiftCard(item) && policy.giftCardExcluded) return { eligible: "no" };

  if (!policy.parsedOk) return { eligible: "abstain" };

  const dayNumber = daysBetween(item.delivered_date, input.request.date) + 1;

  if (isElectronics(item)) {
    const defectiveP = answers[`defective_${item.sku}`]?.noul;
    const unopenedP = answers[`unopened_${item.sku}`]?.noul;
    if (defectiveP === undefined || unopenedP === undefined) return { eligible: "abstain" };
    const verdict = decideElectronics(dayNumber, policy.electronicsDays, policy.electronicsDefectiveDays, defectiveP, unopenedP);
    return { eligible: verdict };
  }

  return { eligible: dayNumber <= policy.generalDays ? "yes" : "no" };
}
