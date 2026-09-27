export function buildState(input) {
  return {
    recipient: input.recipient,
    draft_reply: input.draft_reply,
  };
}

export function questions(input) {
  const r = input.recipient || {};
  const ownData = [
    r.name && `name: ${r.name}`,
    r.email && `email: ${r.email}`,
    r.phone && `phone: ${r.phone}`,
    Array.isArray(r.order_ids) && r.order_ids.length
      ? `order id(s): ${r.order_ids.join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join("; ");

  return {
    exposure: {
      type: "noul",
      instructions:
        `state.draft_reply is a support reply being sent to one customer. ` +
        `That customer's own data is: ${ownData || "(none provided)"}. ` +
        `Check whether the draft reply discloses a name, email address, phone number, or order id ` +
        `that identifies a specific person OTHER than this customer (e.g. a different customer or ` +
        `third party). The customer's own data listed above never counts, even if repeated back to them. ` +
        `Generic company contact addresses/phone numbers and a support agent's first name ` +
        `(e.g. "Alex from support", "support@company.com") are not personal data and never count. ` +
        `Only flag data that would identify a different real individual.`,
      criteria: {
        true:
          "The draft reply contains a name, email, phone number, or order id belonging to a specific person other than the addressed customer.",
        false:
          "The draft reply contains no personal data belonging to anyone other than the addressed customer (or only company/staff-first-name references).",
      },
    },
  };
}

export function decide(answers, input) {
  const p = answers?.exposure?.noul;
  if (typeof p !== "number") return { exposes_other_person: "abstain" };
  if (p >= 0.65) return { exposes_other_person: "yes" };
  if (p <= 0.25) return { exposes_other_person: "no" };
  return { exposes_other_person: "abstain" };
}
