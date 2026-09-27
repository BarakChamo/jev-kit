// Example for `jev-run --derive`: a field computed in code from Jev's answers, graded like any other.
// Here the action is derived from two classifications — a short OR over reliable facts, the shape
// that helped in every measurement — instead of being asked as a question of its own.
// Give cases a gold label for `priority_queue` to grade it.
export default function derive(answers) {
  const urgency = answers.urgency;
  const refund = answers.refund;
  if (!urgency || !refund) return {};
  const level = urgency.legend?.[String(Math.round(urgency.score))] ?? '';
  const high = level.startsWith('high');
  const wantsRefund = refund.noul > 0.5;
  return {
    predicted: { priority_queue: high || wantsRefund ? 'yes' : 'no' },
    // a disjunction is as sure as its surest true branch, or its least sure false one
    confidence: {
      priority_queue: high || wantsRefund
        ? Math.max(high ? urgency.confidence : 0, wantsRefund ? refund.noul : 0)
        : Math.min(urgency.confidence, 1 - refund.noul),
    },
  };
}
