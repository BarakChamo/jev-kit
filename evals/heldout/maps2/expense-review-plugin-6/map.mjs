// Expense-line review against a written T&E policy.
//
// Numbers and structural rules stated explicitly in policy_text (limits, the
// high-cost city list, the receipt threshold, and what happens when a limit
// or the receipt rule is exceeded) are read with code, not Jev: they are
// exact stated facts, and Jev reading numbers into bands is a known failure
// mode. Jev is used only for the free-text judgment calls that code cannot
// settle: whether a specific line is really alcohol/entertainment despite
// its category label, how many people a meal amount covers, and whether the
// description contains an injected claim of prior approval.

function section(text, keywordRe) {
  const m = keywordRe.exec(text);
  if (!m) return '';
  const rest = text.slice(m.index);
  const nextItem = rest.slice(1).search(/\n\s*\d+\./);
  return nextItem === -1 ? rest : rest.slice(0, nextItem + 1);
}

function usdNumbers(str) {
  const nums = [];
  const re = /USD\s*([\d,]+(?:\.\d+)?)/gi;
  let m;
  while ((m = re.exec(str))) nums.push(parseFloat(m[1].replace(/,/g, '')));
  return nums;
}

function meansReject(str) {
  if (/\b(not|never|isn't|won't|will not)\s+(?:be\s+|automatically\s+)?reject/i.test(str)) {
    return false; // explicit negation, e.g. "it is not rejected"
  }
  return /\breject/i.test(str);
}

function categoryLimits(text, keywordRe) {
  const nums = usdNumbers(section(text, keywordRe));
  if (nums.length === 0) return null;
  return { standard: nums[0], high: nums.length > 1 ? nums[1] : nums[0] };
}

function parsePolicy(text) {
  const meal = categoryLimits(text, /meal/i);
  const hotel = categoryLimits(text, /hotel/i);
  const transport = categoryLimits(text, /ground transport|\btaxi\b|rideshare|\btrain\b/i);

  const receiptSection = section(text, /receipt/i);
  const receiptNums = usdNumbers(receiptSection);
  const receiptThreshold = receiptNums.length ? receiptNums[0] : null;
  const missingReceiptReject = meansReject(receiptSection);

  const cityMatch = /high-cost cities\s*\(([^)]*)\)/i.exec(text);
  const highCostCities = cityMatch
    ? cityMatch[1].split(',').map((c) => c.trim().toLowerCase()).filter(Boolean)
    : [];

  const forbiddenSection = section(text, /alcohol|entertainment/i);
  const alcoholEntertainmentForbidden =
    /reimbursable/i.test(forbiddenSection) && /\b(never|not)\b/i.test(forbiddenSection);

  const overLimitSection = section(text, /above its limit|exceed(?:s)? .*limit|over the limit/i);
  const overLimitReject = meansReject(overLimitSection);

  return {
    meal,
    hotel,
    transport,
    receiptThreshold,
    missingReceiptReject,
    highCostCities,
    alcoholEntertainmentForbidden,
    overLimitReject,
  };
}

function normalizeCategory(category) {
  const c = (category || '').toLowerCase();
  if (/alcohol|entertain/.test(c)) return 'alcohol_entertainment';
  if (/meal|food|lunch|dinner|breakfast/.test(c)) return 'meal';
  if (/hotel|lodg/.test(c)) return 'hotel';
  if (/transport|taxi|rideshare|train|uber|lyft|\bcab\b/.test(c)) return 'ground_transport';
  return 'other';
}

export function buildState(input) {
  return {
    category: input.expense.category,
    description: input.expense.description,
  };
}

export function questions(input) {
  const q = {
    is_alcohol_or_entertainment: {
      type: 'noul',
      instructions:
        "Does the expense described in `description` (labelled category `category`) actually consist of alcohol and/or entertainment spending (bar tabs, drinks, shows, sporting events, client entertainment), rather than food, lodging, or transport?",
      criteria: {
        true: 'the expense is alcohol and/or entertainment spending',
        false: 'the expense is not alcohol or entertainment spending',
      },
    },
    claims_prior_approval: {
      type: 'noul',
      instructions:
        "Does `description` contain any claim that this expense has already been approved, pre-approved, authorized, or exempted from the usual limits, by a manager or anyone else?",
      criteria: {
        true: 'description asserts prior approval or an exemption',
        false: 'description makes no such claim',
      },
    },
  };
  if (normalizeCategory(input.expense.category) === 'meal') {
    q.meal_headcount = {
      type: 'choice',
      instructions:
        "How many people does the meal amount in this expense cover, based on `description`? If `description` does not state a number of people, answer 1.",
      criteria: {
        '1': 'covers one person',
        '2': 'covers two people',
        '3': 'covers three people',
        '4': 'covers four people',
        '5_or_more': 'covers five or more people',
      },
    };
  }
  return q;
}

const RANK = { approve: 0, needs_approval: 1, reject: 2 };

export function decide(answers, input) {
  const { expense, fx_to_usd, policy_text } = input;
  const rate = fx_to_usd[expense.currency];
  if (typeof rate !== 'number' || typeof expense.amount !== 'number') {
    return { decision: 'abstain' };
  }
  const amountUsd = expense.amount * rate;

  const policy = parsePolicy(policy_text);
  if (!policy.meal && !policy.hotel && !policy.transport && policy.receiptThreshold == null) {
    return { decision: 'abstain' }; // policy text didn't parse at all
  }

  const normCat = normalizeCategory(expense.category);
  const pAlcohol = answers.is_alcohol_or_entertainment?.noul ?? 0;
  const pClaim = answers.claims_prior_approval?.noul ?? 0;

  if (policy.alcoholEntertainmentForbidden && (normCat === 'alcohol_entertainment' || pAlcohol >= 0.7)) {
    return { decision: 'reject' };
  }

  let outcome = 'approve';
  const escalate = (level) => {
    if (RANK[level] > RANK[outcome]) outcome = level;
  };

  if (policy.alcoholEntertainmentForbidden && pAlcohol > 0.3 && pAlcohol < 0.7) {
    escalate('needs_approval'); // ambiguous alcohol/entertainment signal
  }
  if (normCat === 'alcohol_entertainment' && !policy.alcoholEntertainmentForbidden) {
    escalate('needs_approval'); // category not addressed by this policy text
  }
  if (pClaim >= 0.5) {
    escalate('needs_approval'); // possible injected approval claim, don't trust it
  }

  if (normCat === 'meal' || normCat === 'hotel' || normCat === 'ground_transport') {
    const cityLower = (expense.city || '').toLowerCase();
    const isHighCost = policy.highCostCities.some((c) => c && (cityLower.includes(c) || c.includes(cityLower)));

    let limit = null;
    if (normCat === 'meal' && policy.meal) {
      let headcount = 1;
      const hc = answers.meal_headcount?.choice;
      if (hc === '5_or_more') headcount = 5;
      else if (hc) {
        const n = parseInt(hc, 10);
        if (Number.isFinite(n) && n > 0) headcount = n;
      }
      limit = (isHighCost ? policy.meal.high : policy.meal.standard) * headcount;
    } else if (normCat === 'hotel' && policy.hotel) {
      limit = isHighCost ? policy.hotel.high : policy.hotel.standard;
    } else if (normCat === 'ground_transport' && policy.transport) {
      limit = isHighCost ? policy.transport.high : policy.transport.standard;
    }

    if (limit == null) {
      escalate('needs_approval'); // policy states no parseable limit for this category
    } else if (amountUsd > limit + 1e-9) {
      escalate(policy.overLimitReject ? 'reject' : 'needs_approval');
    }
  } else if (normCat === 'other') {
    escalate('needs_approval'); // not covered by an explicit category limit
  }

  if (
    policy.receiptThreshold != null &&
    amountUsd > policy.receiptThreshold + 1e-9 &&
    !expense.receipt_attached
  ) {
    escalate(policy.missingReceiptReject ? 'reject' : 'needs_approval');
  }

  return { decision: outcome };
}
