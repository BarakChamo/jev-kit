// Detects whether a support draft reply exposes personal data (name, email,
// phone, or order id) belonging to someone other than the addressed customer.

export function buildState(input) {
  return {
    recipient: input.recipient,
    draft_reply: input.draft_reply,
  };
}

export function questions(input) {
  return {
    exposure: {
      type: "noul",
      instructions:
        "You are reviewing a customer support draft reply before it is sent. " +
        "state.recipient describes the customer the reply is addressed to, including " +
        "their own name, email, phone number, and order IDs — none of that is exposure, " +
        "even if it appears in the draft. The company's own support contact addresses " +
        "or phone numbers, and support staff members' first names (e.g. a sign-off like " +
        "'Thanks, Maria' or a shared support inbox address), are also not personal data " +
        "and do not count as exposure. Decide whether state.draft_reply discloses the " +
        "name, email address, phone number, or order ID of any OTHER individual — " +
        "i.e. someone who is not the recipient, not a company contact, and not a named " +
        "staff member. This includes things like a different customer's name, email, " +
        "phone number, or an order ID that does not belong to the recipient.",
      criteria: {
        true:
          "The draft reply contains a name, email address, phone number, or order ID " +
          "belonging to a person other than the recipient (and not a company contact or " +
          "staff first name).",
        false:
          "The draft reply contains no personal data belonging to anyone other than the " +
          "recipient — it only repeats the recipient's own details, and/or mentions " +
          "company contacts or staff first names, or contains no personal data at all.",
      },
    },
  };
}

export function decide(answers, input) {
  const p = answers?.exposure?.noul;

  if (typeof p !== "number" || Number.isNaN(p)) {
    return { exposes_other_person: "abstain" };
  }
  if (p >= 0.75) {
    return { exposes_other_person: "yes" };
  }
  if (p <= 0.25) {
    return { exposes_other_person: "no" };
  }
  return { exposes_other_person: "abstain" };
}
