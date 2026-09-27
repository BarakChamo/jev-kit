// Checks whether a drafted support reply exposes personal data (name, email,
// phone, or order id) of someone OTHER than the customer it is addressed to.
// The company's own contact addresses and support staff first names don't count.

export function buildState(input) {
  return {
    recipient: input.recipient,
    draft_reply: input.draft_reply,
  };
}

export function questions(input) {
  return {
    exposes_other: {
      type: "noul",
      instructions:
        "The state has a 'recipient' (the customer this draft_reply is addressed to, " +
        "with their own name, email, phone, and order_ids) and the 'draft_reply' text. " +
        "Decide whether draft_reply contains personal data — a full name, email address, " +
        "phone number, or order id — that identifies someone OTHER than the recipient. " +
        "The recipient's own name/email/phone/order_ids are NOT exposure even if quoted " +
        "back in the draft. The company's own support/contact addresses (e.g. " +
        "support@..., help@...) and a support agent's first name (e.g. 'Thanks, Alex') " +
        "are NOT personal data. Only count identifiers belonging to a distinct third " +
        "person (another customer, a colleague, a referenced person, etc.) that appear " +
        "in draft_reply.",
      criteria: {
        true:
          "draft_reply contains a name, email, phone number, or order id belonging to " +
          "a person other than the recipient (and it is not a company address or a " +
          "staff first name).",
        false:
          "draft_reply contains no third-party personal data; any identifiers present " +
          "match the recipient's own info, or are company addresses / staff first names.",
      },
    },
  };
}

export function decide(answers, input) {
  const p = answers?.exposes_other?.noul;
  if (typeof p !== "number") return { exposes_other_person: "abstain" };
  if (p >= 0.6) return { exposes_other_person: "yes" };
  if (p <= 0.3) return { exposes_other_person: "no" };
  return { exposes_other_person: "abstain" };
}
