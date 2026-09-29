// Jev question map for multi-item order return-eligibility decisions.

const DAY_OPTIONS = ['7', '10', '14', '15', '20', '21', '30', '45', '60', '90'];

const TARGET_CONF = 0.65; // placeholder gate; tune with jev-eval
const CHOICE_CONF = 0.55;
const AMBIG_LO = 0.35;
const AMBIG_HI = 0.65;

function catKey(category) {
  return String(category).replace(/[^a-zA-Z0-9]+/g, '_');
}

function uniqueCategories(items) {
  const seen = new Map();
  for (const item of items) {
    const k = catKey(item.category);
    if (!seen.has(k)) seen.set(k, item.category);
  }
  return seen; // key -> original category string
}

function dayCriteria(prefix) {
  const criteria = {};
  for (const d of DAY_OPTIONS) {
    criteria[d] = `${prefix} is ${d} days`;
  }
  criteria.not_specified = `${prefix} is not stated anywhere in the policy, not even as a general/default rule`;
  return criteria;
}

function parseWindow(ans) {
  if (!ans || ans.choice === 'not_specified' || ans.confidence < CHOICE_CONF) return null;
  const n = parseInt(ans.choice, 10);
  return Number.isFinite(n) ? n : null;
}

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    order: input.order,
    request: input.request,
  };
}

export function questions(input) {
  const items = input.order.items;
  const categories = uniqueCategories(items);
  const q = {};

  const targetCriteria = {};
  for (const item of items) {
    targetCriteria[item.sku] = `the customer is asking to return the item named "${item.name}" (SKU ${item.sku})`;
  }
  targetCriteria.unclear = 'the message does not clearly ask to return exactly one specific item from the order (e.g. it asks about several items, asks about none, or does not identify which item)';
  q.target = {
    type: 'choice',
    instructions: 'The customer wrote the message in `request.message` about the order items listed in `order.items`. Which single item is the customer asking to return? Match by product name or description even when the SKU is not mentioned by the customer.',
    criteria: targetCriteria,
  };

  for (const item of items) {
    q[`opened_${item.sku}`] = {
      type: 'choice',
      instructions: `In the message in \`request.message\`, regarding the item named "${item.name}" (SKU ${item.sku}) specifically: does the customer say this item has been opened/used, or that it is unopened/unused/still sealed?`,
      criteria: {
        opened: 'the message states this specific item was opened, used, or unsealed',
        unopened: 'the message states this specific item is unopened, unused, or still sealed',
        not_mentioned: 'the message does not say whether this specific item is opened or unopened',
      },
    };
    q[`defective_${item.sku}`] = {
      type: 'noul',
      instructions: `Does the message in \`request.message\` claim that the item named "${item.name}" (SKU ${item.sku}) is defective, broken, damaged, faulty, or otherwise not working correctly? Judge this item only, not other items in the order.`,
      criteria: {
        true: 'the message claims this specific item is defective/broken/damaged/faulty/not working',
        false: 'the message makes no such claim about this specific item',
      },
    };
  }

  for (const [key, category] of categories) {
    q[`window_days_${key}`] = {
      type: 'choice',
      instructions: `Read the returns policy in \`policy_text\`. For an item in the category "${category}" that is NOT defective, how many days after delivery can it be returned? If a rule in the policy specifically covers this category, use that rule's window. Otherwise use whatever general/default window the policy states for items not otherwise called out.`,
      criteria: dayCriteria(`the applicable return window for a non-defective "${category}" item`),
    };
    q[`requires_unopened_${key}`] = {
      type: 'noul',
      instructions: `Read the returns policy in \`policy_text\`. For an item in the category "${category}" that is NOT defective, does the policy require the item to be unopened/unused/in original packaging to qualify for return?`,
      criteria: {
        true: `the policy states or implies this requirement for non-defective "${category}" items`,
        false: `the policy states no such requirement for non-defective "${category}" items`,
      },
    };
    q[`defective_extends_${key}`] = {
      type: 'noul',
      instructions: `Read the returns policy in \`policy_text\`. Does the policy give a DEFECTIVE item in the category "${category}" a different return window than the standard window that applies when the item is not defective?`,
      criteria: {
        true: `the policy states a distinct return window for a defective "${category}" item`,
        false: `the policy states no distinct window for a defective "${category}" item (the standard window applies either way)`,
      },
    };
    q[`defective_window_days_${key}`] = {
      type: 'choice',
      instructions: `Read the returns policy in \`policy_text\`. How many days after delivery can a DEFECTIVE item in the category "${category}" be returned, per the policy's rule for defective items in this category?`,
      criteria: dayCriteria(`the policy's return window for a defective "${category}" item`),
    };
    q[`excluded_${key}`] = {
      type: 'noul',
      instructions: `Read the returns policy in \`policy_text\`. Does the policy state that items in the category "${category}" (or this specific kind of item, such as gift cards) can never be returned at all, regardless of timing or condition? Answer about the category as a stated policy rule, separate from any per-item final-sale marking.`,
      criteria: {
        true: `the policy states "${category}" items (as a category/kind) can never be returned`,
        false: 'the policy states no such blanket exclusion for this category',
      },
    };
  }

  return q;
}

export function decide(answers, input) {
  const target = answers.target;
  if (!target || target.choice === 'unclear' || target.confidence < TARGET_CONF) {
    return { eligible: 'abstain' };
  }

  const sku = target.choice;
  const item = input.order.items.find((i) => i.sku === sku);
  if (!item) return { eligible: 'abstain' };

  if (item.final_sale) return { eligible: 'no' };

  const key = catKey(item.category);

  const excluded = answers[`excluded_${key}`];
  if (excluded) {
    if (excluded.noul >= AMBIG_HI) return { eligible: 'no' };
    if (excluded.noul > AMBIG_LO) return { eligible: 'abstain' };
  }

  const defAns = answers[`defective_${sku}`];
  if (!defAns) return { eligible: 'abstain' };
  if (defAns.noul > AMBIG_LO && defAns.noul < AMBIG_HI) return { eligible: 'abstain' };
  const isDefective = defAns.noul >= AMBIG_HI;

  let windowDays;
  if (isDefective) {
    const extendsAns = answers[`defective_extends_${key}`];
    const extends_ = extendsAns ? extendsAns.noul >= 0.5 : false;
    windowDays = extends_
      ? parseWindow(answers[`defective_window_days_${key}`])
      : parseWindow(answers[`window_days_${key}`]);
  } else {
    windowDays = parseWindow(answers[`window_days_${key}`]);

    const reqAns = answers[`requires_unopened_${key}`];
    if (reqAns) {
      if (reqAns.noul > AMBIG_LO && reqAns.noul < AMBIG_HI) return { eligible: 'abstain' };
      const requiresUnopened = reqAns.noul >= AMBIG_HI;
      if (requiresUnopened) {
        const openAns = answers[`opened_${sku}`];
        if (!openAns || openAns.confidence < CHOICE_CONF || openAns.choice === 'not_mentioned') {
          return { eligible: 'abstain' };
        }
        if (openAns.choice === 'opened') return { eligible: 'no' };
      }
    }
  }

  if (windowDays == null) return { eligible: 'abstain' };

  const delivered = new Date(item.delivered_date);
  const requested = new Date(input.request.date);
  const elapsedDays = Math.round((requested - delivered) / 86400000) + 1;

  return { eligible: elapsedDays <= windowDays ? 'yes' : 'no' };
}
