// map.mjs
// Checks whether a drafted support reply exposes personal data (name, email,
// phone, or order id) belonging to someone other than the customer it is
// addressed to. The company's own contact addresses and support staff first
// names are not considered personal data.

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
        "State contains `recipient` (the customer this draft_reply is addressed to, with their own name/email/phone/order_ids) and `draft_reply` (the text of a support reply). " +
        "Determine whether draft_reply discloses personal data — a name, email address, phone number, or order ID — that identifies a specific person OTHER than recipient. " +
        "The recipient's own name/email/phone/order ids are NOT exposure, even if repeated in the text. " +
        "Generic company contact info (e.g. a support/help/company email or phone number) and support staff first names (e.g. 'Thanks, Alex from Support') are NOT personal data. " +
        "Only count data that identifies a distinct third party, such as another customer's name, a different person's email/phone, or an order id that is not one of recipient's order_ids.",
      criteria: {
        true: "draft_reply names, emails, calls, or references an order id belonging to a specific person other than recipient (and it is not company contact info or a staff first name).",
        false: "draft_reply contains no personal data of anyone other than recipient; any other identifiers present are company contact info or support staff first names.",
      },
    },
  };
}

export function decide(answers, input) {
  const p = answers?.exposure?.noul;
  if (typeof p !== "number") return { exposes_other_person: "abstain" };
  if (p >= 0.7) return { exposes_other_person: "yes" };
  if (p <= 0.3) return { exposes_other_person: "no" };
  return { exposes_other_person: "abstain" };
}
