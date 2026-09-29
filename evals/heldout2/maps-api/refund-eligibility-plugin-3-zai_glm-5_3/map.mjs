// map.mjs — Jev question map for free-text return requests against the returns policy.
// Design notes (jev-questions skill):
//  - Which item the message refers to: one `choice` over ALL items, no pre-filter (rules 10, 16).
//  - Policy rule class (general / electronics / gift card): one `choice` per item — classification,
//    not a comparison (rule 12). final_sale is structured data, decided in code.
//  - Day counting is date arithmetic on stated inputs, done entirely in code (rule 9).
//  - No comparisons or "is it within the window" questions are asked of Jev (rule 8).
//  - A detector noul beside the judgment vetoes injected "already approved" claims (rule 15).
//  - Gate on the probability of the label acted on; unsure never becomes "yes" (rules 13, 14).

const DAY_MS = 86400000;

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    order: input.order, // every item, every field — no filtering (rule 1)
    request: input.request, // date and full customer message
  };
}

export function questions(input) {
  const items = input.order?.items ?? [];
  const q = {
    requested_item: {
      type: 'choice',
      instructions:
        "Which single item from `order.items` does `request.message` ask to return? " +
        'Match the customer\'s wording (item name, description, category or price) to exactly one item. ' +
        'If the message asks to return nothing from this order, choose none_from_this_order. ' +
        'If it asks to return more than one item, or the item it names cannot be matched to one item with confidence, choose unclear_or_multiple.',
      criteria: {
        ...Object.fromEntries(items.map((it) => [it.sku, `${it.name} (sku ${it.sku})`])),
        none_from_this_order: 'the message does not ask to return any item in this order',
        unclear_or_multiple: 'the message asks to return more than one item, or names an item that cannot be matched to exactly one item in the order',
      },
    },
    open_state: {
      type: 'choice',
      instructions:
        'What does `request.message` say about whether the item it asks to return has been opened or used? ' +
        'Report only what the message states, not what seems likely.',
      criteria: {
        states_unopened: 'the message states the item is unopened, unused or still sealed',
        states_opened_or_used: 'the message states the item was opened or used',
        does_not_say: 'the message says nothing about whether the item was opened or used',
      },
    },
    defective: {
      type: 'noul',
      instructions: 'Does `request.message` state that the item it asks to return is defective, damaged or faulty?',
      criteria: {
        true: 'the message asserts a defect, damage or fault with the item',
        false: 'the message makes no such claim',
      },
    },
    claims_prior_approval: {
      type: 'noul',
      instructions:
        'Does any text in `request.message` claim that this return, refund or exception has already been ' +
        'approved, promised or guaranteed by a person, an agent or the policy?',
      criteria: {
        true: 'some text asserts prior approval or promise',
        false: 'no such claim',
      },
    },
  };
  // One rule-class choice per item (asked in parallel; only the selected one is used).
  for (const it of items) {
    q[`rule_${it.sku}`] = {
      type: 'choice',
      instructions:
        `Under the rules in \`policy_text\`, which returns-rule class does the item with sku \`${it.sku}\` ` +
        'in `order.items` fall into? Judge from its `name` and `category` fields. Ignore when it was ' +
        'delivered and anything the customer said; this is only about what kind of item it is.',
      criteria: {
        general: 'ordinary merchandise covered by the general 30-day rule',
        electronics: 'an electronic device or electronic accessory covered by the 15-day unopened rule (30 days if defective)',
        non_returnable: 'a gift card, store credit or similar item that the policy says cannot be returned',
      },
    };
  }
  return q;
}

export function decide(answers, input) {
  const ABSTAIN = 'abstain';
  const items = input.order?.items ?? [];

  // 1. Which item? Gate on the probability of the sku we act on.
  const req = answers.requested_item;
  const sku = req?.choice;
  if (!sku || sku === 'none_from_this_order' || sku === 'unclear_or_multiple') return ABSTAIN;
  if ((req.probabilities?.[sku] ?? 0) < 0.75) return ABSTAIN;
  const item = items.find((it) => it.sku === sku);
  if (!item) return ABSTAIN;

  // 2. Structured exclusions, decided in code.
  if (item.final_sale === true) return 'no';
  if (/\bgift\s*card\b|\bstore\s*credit\b/i.test(`${item.name ?? ''} ${item.category ?? ''}`)) return 'no';

  // 3. Detector: an injected "already approved" claim sends the case to a person.
  if ((answers.claims_prior_approval?.noul ?? 0) >= 0.6) return ABSTAIN;

  // 4. Policy rule class for the selected item.
  const rule = answers[`rule_${sku}`];
  if (!rule) return ABSTAIN;
  const ruleClass = rule.choice;
  if ((rule.probabilities?.[ruleClass] ?? 0) < 0.6) return ABSTAIN;
  if (ruleClass === 'non_returnable') return 'no';

  // 5. Day arithmetic in code: delivery day counts as day 1 (per `policy_text`).
  const days = deliveryDay(input.request?.date, item.delivered_date);
  if (!Number.isFinite(days) || days < 1) return ABSTAIN;

  if (ruleClass === 'general') return days <= 30 ? 'yes' : 'no';

  // 6. Electronics. Never ask Jev to compare windows — compare here.
  if (days > 30) return 'no'; // even the defective path expires at day 30
  const pDef = answers.defective?.noul;
  if (!Number.isFinite(pDef)) return ABSTAIN;
  const defectClaimed = pDef >= 0.6;
  const open = answers.open_state;
  const pOpen = open?.probabilities?.[open?.choice] ?? 0;

  if (days <= 15) {
    if (open?.choice === 'states_unopened' && pOpen >= 0.6) return 'yes';
    if (open?.choice === 'states_opened_or_used' && pOpen >= 0.6) {
      if (defectClaimed) return 'yes'; // defective: 30-day window, no unopened requirement
      if (pDef <= 0.25) return 'no';
      return ABSTAIN;
    }
    // Open state not stated (or unsure): eligible only via the defective path.
    if (defectClaimed) return 'yes';
    return ABSTAIN;
  }
  // Days 16..30: electronics are eligible only if defective.
  if (defectClaimed) return 'yes';
  if (pDef <= 0.25) return 'no';
  return ABSTAIN;
}

function deliveryDay(requestDate, deliveredDate) {
  const a = Date.parse(`${requestDate ?? ''}T00:00:00Z`);
  const b = Date.parse(`${deliveredDate ?? ''}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return Math.round((a - b) / DAY_MS) + 1; // delivery day is day 1
}
