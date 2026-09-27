// Jev map for travel & expense line review.
//
// Design notes:
// - Dollar limits are READ from policy_text, never invented: code regex-extracts every
//   "USD <number>" figure that appears in the policy, and Jev only picks which of those
//   literal figures answers a scoped question ("what is the standard-city meal limit").
//   This avoids asking Jev to bucket a stated number (jev-questions rule 5).
// - All arithmetic (currency conversion, amount-vs-limit, amount-vs-receipt-threshold) is
//   done in code. Jev is only asked to read text: which city tier applies, which figure in
//   the policy is the relevant limit/threshold, what consequence the policy attaches to an
//   overage or to alcohol/entertainment spend, and whether a line is disguised
//   alcohol/entertainment spend. None of these vary by case in the given example policy, but
//   they are read per case rather than assumed, since policy_text is supplied per case.
// - Gating uses the calibrated probability of the label we care about (a `noul` value, or a
//   choice's own probability for its chosen label), not the raw `confidence` scalar. Low
//   confidence always escalates to needs_approval or abstain, never relaxes to approve.

const CATEGORY_ALIASES = {
  meal: "meal",
  meals: "meal",
  hotel: "hotel",
  hotels: "hotel",
  lodging: "hotel",
  groundtransport: "ground_transport",
  transport: "ground_transport",
  taxi: "ground_transport",
  rideshare: "ground_transport",
  train: "ground_transport",
  alcohol: "alcohol",
  entertainment: "entertainment",
};

function normalizeCategory(raw) {
  const key = String(raw || "").toLowerCase().replace(/[^a-z]/g, "");
  return CATEGORY_ALIASES[key] || null;
}

function extractCandidateAmounts(policyText) {
  const found = new Set();
  const patterns = [/USD\s*([\d,]+(?:\.\d+)?)/gi, /\$\s*([\d,]+(?:\.\d+)?)/g];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(policyText))) {
      const n = Number(m[1].replace(/,/g, ""));
      if (Number.isFinite(n)) found.add(n);
    }
  }
  return Array.from(found).sort((a, b) => a - b);
}

function convertToUsd(amount, currency, fxToUsd) {
  const rate = fxToUsd && fxToUsd[currency];
  if (typeof rate !== "number") return null;
  return amount * rate;
}

function limitCriteria(candidates) {
  const criteria = {
    not_stated: "policy_text does not state a number that answers this question",
  };
  for (const v of candidates) {
    criteria[String(v)] = `the figure "USD ${v}" as it literally appears in policy_text`;
  }
  return criteria;
}

// Reads a choice answer for a limit/threshold question back into a USD number,
// or null if unstated / too unsure to trust.
function parseLimitAnswer(ans, minProb) {
  if (!ans || ans.choice === "not_stated") return null;
  const p = choiceProb(ans);
  if (typeof p === "number" && p < minProb) return null;
  const n = Number(ans.choice);
  return Number.isFinite(n) ? n : null;
}

function choiceProb(ans) {
  if (!ans) return undefined;
  return ans.probabilities ? ans.probabilities[ans.choice] : ans.confidence;
}

export function buildState(input) {
  const candidates = extractCandidateAmounts(input.policy_text);
  return {
    policy_text: input.policy_text,
    expense: input.expense,
    dollar_figures_found_in_policy_text: candidates,
  };
}

export function questions(input) {
  const category = normalizeCategory(input.expense.category);
  const q = {};

  // What the policy attaches to the two case-independent structural rules. Read per case
  // (rather than assumed from one example policy) since policy_text is supplied per case.
  q.over_limit_rule = {
    type: "choice",
    instructions:
      "Read policy_text. When a single expense exceeds the limit stated for its category, does policy_text say it is rejected outright, or that it requires manager approval (and is therefore not rejected)?",
    criteria: {
      rejected: "policy_text says an over-limit expense is rejected",
      needs_approval: "policy_text says an over-limit expense requires manager approval and is not rejected",
      not_addressed: "policy_text does not address what happens to an over-limit expense",
    },
  };

  q.alcohol_entertainment_rule = {
    type: "choice",
    instructions: "Read policy_text. What does it say happens to alcohol and/or entertainment expenses?",
    criteria: {
      never_reimbursable: "policy_text says alcohol/entertainment is never reimbursable (rejected)",
      needs_approval: "policy_text says alcohol/entertainment requires manager approval rather than outright rejection",
      not_addressed: "policy_text does not address alcohol or entertainment expenses",
    },
  };

  // Alcohol/entertainment spend disguised inside another category (e.g. wine billed as
  // part of a "meal") is only worth checking when the structured category doesn't already
  // say so.
  if (category && category !== "alcohol" && category !== "entertainment") {
    q.is_alcohol_or_entertainment = {
      type: "noul",
      instructions:
        "Read the `description` field of `expense` in state. Does it describe spending that is primarily alcohol or entertainment — as opposed to an ordinary meal, hotel stay, or ground transport that merely happens to be near such spending?",
      criteria: {
        true: "the description is primarily alcohol and/or entertainment spend",
        false: "the description is an ordinary expense of its stated category",
      },
    };
  }

  const candidates = extractCandidateAmounts(input.policy_text);
  const hasCandidates = candidates.length > 0;

  if (category === "meal" || category === "hotel") {
    q.city_tier = {
      type: "choice",
      instructions:
        'policy_text lists specific cities that get a higher expense limit ("high-cost cities"). Does `expense.city` (allowing for obvious name variants, e.g. "NYC" for "New York" or "SF" for "San Francisco") belong to that high-cost list, or is it a standard city?',
      criteria: {
        standard: "expense.city is not on the policy's high-cost city list",
        high_cost: "expense.city is on the policy's high-cost city list",
      },
    };

    if (hasCandidates) {
      const unit = category === "meal" ? "per-person, per-day meal" : "per-night hotel";
      q.limit_standard = {
        type: "choice",
        instructions: `What ${unit} limit does policy_text state for STANDARD (non high-cost) cities?`,
        criteria: limitCriteria(candidates),
      };
      q.limit_high_cost = {
        type: "choice",
        instructions: `What ${unit} limit does policy_text state for HIGH-COST cities?`,
        criteria: limitCriteria(candidates),
      };
    }
  } else if (category === "ground_transport" && hasCandidates) {
    q.limit_transport = {
      type: "choice",
      instructions: "What per-trip limit does policy_text state for ground transport (taxi, rideshare, train)?",
      criteria: limitCriteria(candidates),
    };
  }

  if (hasCandidates && !input.expense.receipt_attached) {
    q.receipt_threshold = {
      type: "choice",
      instructions:
        "Above what single-expense USD amount does policy_text require an itemised receipt (at or below which none is required)?",
      criteria: limitCriteria(candidates),
    };
  }

  return q;
}

const PROB_MIN = 0.6;

export function decide(answers, input) {
  const category = normalizeCategory(input.expense.category);
  const isAlcoholOrEntertainment = category === "alcohol" || category === "entertainment";

  const altAns = answers.is_alcohol_or_entertainment;
  const disguisedAlcohol = altAns && altAns.noul >= 0.75;
  const maybeAlcohol = altAns && altAns.noul >= 0.3 && altAns.noul < 0.75;

  if (isAlcoholOrEntertainment || disguisedAlcohol) {
    const ruleAns = answers.alcohol_entertainment_rule;
    const ruleProb = choiceProb(ruleAns);
    if (ruleAns && ruleAns.choice === "never_reimbursable" && ruleProb >= PROB_MIN) {
      return { decision: "reject" };
    }
    // needs_approval, not_addressed, or unsure: escalate rather than guess.
    return { decision: "needs_approval" };
  }

  if (maybeAlcohol) {
    return { decision: "needs_approval" };
  }

  if (category !== "meal" && category !== "hotel" && category !== "ground_transport") {
    return { decision: "abstain" };
  }

  const amountUsd = convertToUsd(input.expense.amount, input.expense.currency, input.fx_to_usd);
  if (amountUsd === null) return { decision: "abstain" };

  let limitUsd = null;
  if (category === "meal" || category === "hotel") {
    const tierAns = answers.city_tier;
    if (!tierAns) return { decision: "abstain" };
    const tierProb = choiceProb(tierAns);
    if (typeof tierProb !== "number" || tierProb < PROB_MIN) return { decision: "abstain" };
    const limitAns = tierAns.choice === "high_cost" ? answers.limit_high_cost : answers.limit_standard;
    limitUsd = parseLimitAnswer(limitAns, PROB_MIN);
  } else {
    limitUsd = parseLimitAnswer(answers.limit_transport, PROB_MIN);
  }

  if (limitUsd === null) return { decision: "abstain" };

  if (amountUsd > limitUsd) {
    const overAns = answers.over_limit_rule;
    const overProb = choiceProb(overAns);
    if (overAns && overAns.choice === "rejected" && overProb >= PROB_MIN) {
      return { decision: "reject" };
    }
    // needs_approval, not_addressed, or unsure: policy default is manager approval, not rejection.
    return { decision: "needs_approval" };
  }

  if (!input.expense.receipt_attached) {
    const thresholdUsd = parseLimitAnswer(answers.receipt_threshold, PROB_MIN);
    if (thresholdUsd === null) return { decision: "abstain" };
    if (amountUsd > thresholdUsd) return { decision: "needs_approval" };
  }

  return { decision: "approve" };
}
