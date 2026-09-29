export function buildState(input) {
  const { policy_text, order, request } = input;
  const { items } = order;
  const { date: requestDate, message } = request;

  // Identify the item being requested for return
  const requestedItem = items.find(item =>
    message.toLowerCase().includes(item.name.toLowerCase()) ||
    message.toLowerCase().includes(item.sku.toLowerCase())
  );

  return {
    policy_text,
    requested_item: requestedItem ? {
      sku: requestedItem.sku,
      name: requestedItem.name,
      category: requestedItem.category,
      final_sale: requestedItem.final_sale,
      delivered_date: requestedItem.delivered_date
    } : null,
    request_date: requestDate,
    message,
    policy_window_general: "30 days",
    policy_window_electronics: "15 days",
    policy_window_electronics_defective: "30 days",
    policy_exceptions: ["final sale", "gift cards"],
    policy_unopened_requirement: "electronics must be unopened unless defective"
  };
}

export function questions(input) {
  const state = buildState(input);
  if (!state.requested_item) {
    return {
      item_identified: {
        type: 'noul',
        instructions: 'Does the `message` clearly identify one of the items in `order.items` by name or SKU?',
        criteria: {
          true: 'the message names or references a specific item from the order',
          false: 'the message does not clearly identify any item from the order'
        }
      }
    };
  }

  return {
    is_final_sale: {
      type: 'noul',
      instructions: 'Is the `requested_item` marked as final sale in `requested_item.final_sale`?',
      criteria: {
        true: 'the item is marked final sale',
        false: 'the item is not marked final sale'
      }
    },
    is_gift_card: {
      type: 'noul',
      instructions: 'Is the `requested_item` a gift card based on its `name` or `category`?',
      criteria: {
        true: 'the item is a gift card',
        false: 'the item is not a gift card'
      }
    },
    is_electronics: {
      type: 'noul',
      instructions: 'Is the `requested_item.category` "electronics"?',
      criteria: {
        true: 'the category is electronics',
        false: 'the category is not electronics'
      }
    },
    is_defective: {
      type: 'noul',
      instructions: 'Does the `message` state that the `requested_item` is defective?',
      criteria: {
        true: 'the message explicitly mentions the item is defective',
        false: 'the message does not mention the item is defective'
      }
    },
    is_unopened: {
      type: 'noul',
      instructions: 'Does the `message` state that the `requested_item` is unopened?',
      criteria: {
        true: 'the message explicitly states the item is unopened',
        false: 'the message does not state the item is unopened'
      }
    },
    delivered_year: {
      type: 'choice',
      instructions: 'What year is the `requested_item.delivered_date`?',
      criteria: Object.fromEntries(Array.from({ length: 5 }, (_, i) => {
        const year = 2022 + i;
        return [String(year), null];
      }))
    },
    delivered_month: {
      type: 'choice',
      instructions: 'What month is the `requested_item.delivered_date`?',
      criteria: Object.fromEntries([
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ].map(m => [m, null]))
    },
    delivered_day: {
      type: 'choice',
      instructions: 'What day of the month is the `requested_item.delivered_date`?',
      criteria: Object.fromEntries(Array.from({ length: 31 }, (_, i) => {
        const day = i + 1;
        return [String(day), null];
      }))
    },
    request_year: {
      type: 'choice',
      instructions: 'What year is the `request_date`?',
      criteria: Object.fromEntries(Array.from({ length: 5 }, (_, i) => {
        const year = 2022 + i;
        return [String(year), null];
      }))
    },
    request_month: {
      type: 'choice',
      instructions: 'What month is the `request_date`?',
      criteria: Object.fromEntries([
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ].map(m => [m, null]))
    },
    request_day: {
      type: 'choice',
      instructions: 'What day of the month is the `request_date`?',
      criteria: Object.fromEntries(Array.from({ length: 31 }, (_, i) => {
        const day = i + 1;
        return [String(day), null];
      }))
    }
  };
}

export function decide(answers, input) {
  const state = buildState(input);
  if (!state.requested_item) {
    const itemIdentified = answers.item_identified;
    if (itemIdentified.noul < 0.8) return { eligible: "abstain" };
    return { eligible: "no" };
  }

  // Check for non-returnable items
  const isFinalSale = answers.is_final_sale.noul > 0.5;
  const isGiftCard = answers.is_gift_card.noul > 0.5;
  if (isFinalSale || isGiftCard) {
    return { eligible: "no" };
  }

  // Get dates
  const deliveredYear = parseInt(answers.delivered_year.choice);
  const deliveredMonth = answers.delivered_month.choice;
  const deliveredDay = parseInt(answers.delivered_day.choice);
  const requestYear = parseInt(answers.request_year.choice);
  const requestMonth = answers.request_month.choice;
  const requestDay = parseInt(answers.request_day.choice);

  const monthMap = {
    January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
    July: 6, August: 7, September: 8, October: 9, November: 10, December: 11
  };

  const deliveredDate = new Date(deliveredYear, monthMap[deliveredMonth], deliveredDay);
  const requestDate = new Date(requestYear, monthMap[requestMonth], requestDay);

  // Calculate days between
  const timeDiff = requestDate.getTime() - deliveredDate.getTime();
  const dayDiff = Math.floor(timeDiff / (1000 * 60 * 60 * 24)) + 1; // delivery day is day 1

  // Check category-specific rules
  const isElectronics = answers.is_electronics.noul > 0.5;
  const isDefective = answers.is_defective.noul > 0.5;
  const isUnopened = answers.is_unopened.noul > 0.5;

  if (isElectronics) {
    if (isDefective) {
      if (dayDiff > 30) return { eligible: "no" };
    } else {
      if (!isUnopened) return { eligible: "no" };
      if (dayDiff > 15) return { eligible: "no" };
    }
  } else {
    if (dayDiff > 30) return { eligible: "no" };
  }

  // Check confidence gates
  const dateFields = [
    'delivered_year', 'delivered_month', 'delivered_day',
    'request_year', 'request_month', 'request_day'
  ];
  const minDateConfidence = Math.min(
    ...dateFields.map(field => answers[field].probabilities[answers[field].choice] ?? 0)
  );

  const categoryConfidence = answers.is_electronics.probabilities[isElectronics ? 'true' : 'false'] ?? 0;
  const conditionConfidence = Math.min(
    answers.is_defective.probabilities[isDefective ? 'true' : 'false'] ?? 1,
    answers.is_unopened.probabilities[isUnopened ? 'true' : 'false'] ?? 1
  );

  const overallConfidence = Math.min(minDateConfidence, categoryConfidence, conditionConfidence);

  if (overallConfidence < 0.8) {
    return { eligible: "abstain" };
  }

  return { eligible: "yes" };
}
