export function buildState(input) {
  const { policy_text, order, request } = input;
  const { items } = order;
  const { date: requestDate, message } = request;

  // Identify the item being returned from the message
  const itemMentions = items.map(item => ({
    sku: item.sku,
    name: item.name,
    category: item.category,
    final_sale: item.final_sale,
    delivered_date: item.delivered_date,
    price: item.price,
    // Check if message mentions this item (case-insensitive)
    mentioned: message.toLowerCase().includes(item.name.toLowerCase()) ||
               message.toLowerCase().includes(item.sku.toLowerCase())
  }));

  // Find the target item (first mentioned item)
  const targetItem = itemMentions.find(item => item.mentioned) || itemMentions[0];

  return {
    policy_text,
    request_date: requestDate,
    target_item: {
      sku: targetItem.sku,
      name: targetItem.name,
      category: targetItem.category,
      final_sale: targetItem.final_sale,
      delivered_date: targetItem.delivered_date,
      price: targetItem.price
    },
    message
  };
}

export function questions(input) {
  return {
    is_final_sale: {
      type: 'noul',
      instructions: 'Does `policy_text` state that items marked as final sale cannot be returned?',
      criteria: {
        true: 'the policy explicitly states final sale items cannot be returned',
        false: 'the policy does not state this or allows returns for final sale items'
      }
    },
    is_gift_card: {
      type: 'noul',
      instructions: 'Does `policy_text` state that gift cards cannot be returned?',
      criteria: {
        true: 'the policy explicitly states gift cards cannot be returned',
        false: 'the policy does not state this or allows returns for gift cards'
      }
    },
    target_is_final_sale: {
      type: 'noul',
      instructions: 'Is `target_item` marked as final sale in the order?',
      criteria: {
        true: 'the target item is marked final_sale: true',
        false: 'the target item is not marked final sale'
      }
    },
    target_is_gift_card: {
      type: 'noul',
      instructions: 'Is `target_item` a gift card? Use only the name and category in `target_item` to decide.',
      criteria: {
        true: 'the item is a gift card (name or category indicates this)',
        false: 'the item is not a gift card'
      }
    },
    category_electronics: {
      type: 'noul',
      instructions: 'Is the category of `target_item` "electronics"?',
      criteria: {
        true: 'the category is exactly "electronics"',
        false: 'the category is anything else'
      }
    },
    default_window_days: {
      type: 'choice',
      instructions: 'How many days does `policy_text` allow for returns of most items?',
      criteria: {
        '15': '15 days',
        '30': '30 days',
        '60': '60 days'
      }
    },
    electronics_window_days: {
      type: 'choice',
      instructions: 'How many days does `policy_text` allow for returns of electronics?',
      criteria: {
        '15': '15 days',
        '30': '30 days',
        '60': '60 days'
      }
    },
    electronics_unopened_required: {
      type: 'noul',
      instructions: 'Does `policy_text` require electronics to be unopened for return (unless defective)?',
      criteria: {
        true: 'policy requires electronics to be unopened for return unless defective',
        false: 'policy does not have this requirement'
      }
    },
    defective_exception: {
      type: 'noul',
      instructions: 'Does `policy_text` allow electronics to be returned within 30 days if defective?',
      criteria: {
        true: 'policy allows 30-day returns for defective electronics',
        false: 'policy does not have this exception'
      }
    },
    target_is_defective: {
      type: 'noul',
      instructions: 'Does `message` state that `target_item` is defective?',
      criteria: {
        true: 'message explicitly states the item is defective',
        false: 'message does not state the item is defective'
      }
    },
    target_is_unopened: {
      type: 'noul',
      instructions: 'Does `message` state that `target_item` is unopened?',
      criteria: {
        true: 'message explicitly states the item is unopened',
        false: 'message does not state the item is unopened or implies it was opened'
      }
    },
    delivered_year: {
      type: 'choice',
      instructions: 'What year is in `target_item.delivered_date`?',
      criteria: Object.fromEntries(Array.from({length: 5}, (_, i) => {
        const year = 2026 - 2 + i;
        return [String(year), null];
      }))
    },
    delivered_month: {
      type: 'choice',
      instructions: 'What month is in `target_item.delivered_date`?',
      criteria: Object.fromEntries([
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ].map(m => [m, null]))
    },
    delivered_day: {
      type: 'choice',
      instructions: 'What day of the month is in `target_item.delivered_date`?',
      criteria: Object.fromEntries(Array.from({length: 31}, (_, i) => [String(i + 1), null]))
    },
    request_year: {
      type: 'choice',
      instructions: 'What year is in `request_date`?',
      criteria: Object.fromEntries(Array.from({length: 5}, (_, i) => {
        const year = 2026 - 2 + i;
        return [String(year), null];
      }))
    },
    request_month: {
      type: 'choice',
      instructions: 'What month is in `request_date`?',
      criteria: Object.fromEntries([
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ].map(m => [m, null]))
    },
    request_day: {
      type: 'choice',
      instructions: 'What day of the month is in `request_date`?',
      criteria: Object.fromEntries(Array.from({length: 31}, (_, i) => [String(i + 1), null]))
    }
  };
}

export function decide(answers, input) {
  const a = answers;

  // Check absolute prohibitions first
  const isGiftCard = a.target_is_gift_card.noul > 0.5;
  const isFinalSaleItem = a.target_is_final_sale.noul > 0.5;
  const policyProhibitsFinalSale = a.is_final_sale.noul > 0.5;
  const policyProhibitsGiftCards = a.is_gift_card.noul > 0.5;

  if ((isGiftCard && policyProhibitsGiftCards) || (isFinalSaleItem && policyProhibitsFinalSale)) {
    return { eligible: 'no' };
  }

  // Parse dates
  const deliveredDate = new Date(
    parseInt(a.delivered_year.choice),
    ['January', 'February', 'March', 'April', 'May', 'June',
     'July', 'August', 'September', 'October', 'November', 'December'].indexOf(a.delivered_month.choice),
    parseInt(a.delivered_day.choice)
  );

  const requestDate = new Date(
    parseInt(a.request_year.choice),
    ['January', 'February', 'March', 'April', 'May', 'June',
     'July', 'August', 'September', 'October', 'November', 'December'].indexOf(a.request_month.choice),
    parseInt(a.request_day.choice)
  );

  // Calculate days between (inclusive of delivery day as day 1)
  const timeDiff = requestDate - deliveredDate;
  const daysDiff = Math.floor(timeDiff / (1000 * 60 * 60 * 24)) + 1;

  // Check category-specific rules
  const isElectronics = a.category_electronics.noul > 0.5;
  const defaultWindow = parseInt(a.default_window_days.choice);
  const electronicsWindow = parseInt(a.electronics_window_days.choice);
  const requiresUnopened = a.electronics_unopened_required.noul > 0.5;
  const hasDefectiveException = a.defective_exception.noul > 0.5;
  const isDefective = a.target_is_defective.noul > 0.5;
  const isUnopened = a.target_is_unopened.noul > 0.5;

  // Determine applicable window
  let maxDays;
  if (isElectronics) {
    if (isDefective && hasDefectiveException) {
      maxDays = defaultWindow; // Use default window for defective electronics
    } else {
      maxDays = electronicsWindow;
    }
  } else {
    maxDays = defaultWindow;
  }

  // Check window
  if (daysDiff > maxDays) {
    return { eligible: 'no' };
  }

  // Check unopened requirement for electronics
  if (isElectronics && requiresUnopened && !isDefective && !isUnopened) {
    return { eligible: 'no' };
  }

  // If we got here, it's eligible
  return { eligible: 'yes' };
}
