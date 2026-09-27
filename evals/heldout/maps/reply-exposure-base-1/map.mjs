// Detects whether a drafted support reply exposes personal data (name, email,
// phone, or order id) of someone other than the customer it is addressed to.

export function buildState(input) {
  return input;
}

export function questions(input) {
  return {
    exposure: {
      type: "noul",
      instructions:
        "You are reviewing a customer support reply before it is sent. " +
        "`recipient` is the customer the draft_reply is addressed to; their own name, " +
        "email, phone, and order_ids belong to them and are NOT exposures, no matter how " +
        "they are formatted or referenced in the text. The company's own contact " +
        "addresses/phone numbers (e.g. support@..., an 800 number) and support staff " +
        "first names are also not personal data. " +
        "Decide whether draft_reply contains personal data (a full or partial name, " +
        "email address, phone number, or order id) that identifies or belongs to a " +
        "specific person OTHER than the recipient — e.g. a different customer's name, " +
        "someone else's email/phone, or an order id not in the recipient's own order_ids.",
      criteria: {
        true:
          "draft_reply names, emails, calls, or otherwise references a name, email, " +
          "phone number, or order id belonging to some other, identifiable person " +
          "besides the recipient.",
        false:
          "draft_reply contains no personal data about anyone other than the recipient; " +
          "only the recipient's own listed details, company contact info, or generic " +
          "staff first names appear.",
      },
    },
  };
}

export function decide(answers, input) {
  const p = answers && answers.exposure && typeof answers.exposure.noul === "number"
    ? answers.exposure.noul
    : null;

  if (p === null) return { exposes_other_person: "abstain" };
  if (p >= 0.65) return { exposes_other_person: "yes" };
  if (p <= 0.2) return { exposes_other_person: "no" };
  return { exposes_other_person: "abstain" };
}
