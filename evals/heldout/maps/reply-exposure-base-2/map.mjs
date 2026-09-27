// Detects whether a draft support reply exposes personal data (name, email,
// phone, or order id) of someone other than the customer it is addressed to.

export function buildState(input) {
  const r = input.recipient || {};
  return {
    recipient: {
      name: r.name ?? null,
      email: r.email ?? null,
      phone: r.phone ?? null,
      order_ids: r.order_ids ?? [],
    },
    draft_reply: input.draft_reply ?? "",
  };
}

export function questions(input) {
  return {
    exposure: {
      type: "choice",
      instructions:
        "state.recipient is the customer this draft_reply is addressed to, with THEIR OWN name, email, phone, and order_ids. state.draft_reply is the text of the reply. Decide whether draft_reply contains a name, email address, phone number, or order id belonging to a DIFFERENT person than state.recipient. Mentioning the recipient's own name/email/phone/order id (matching state.recipient) is NOT exposure. The company's own support contact addresses/phone numbers and support staff first names (e.g. 'Thanks, Alex from support') are NOT exposure. Check the whole text, including any quoted/forwarded messages or examples, for another person's name, email, phone number, or order id.",
      criteria: {
        yes: "draft_reply names, or gives contact/order info for, a real person other than the addressed recipient (not company contact info, not a staff first name).",
        no: "draft_reply contains no personal data belonging to anyone other than the addressed recipient; any personal data present is the recipient's own, or is company/staff info.",
      },
    },
  };
}

export function decide(answers, input) {
  const a = answers && answers.exposure;
  if (!a || (a.choice !== "yes" && a.choice !== "no")) {
    return { exposes_other_person: "abstain" };
  }
  const CONFIDENCE_THRESHOLD = 0.65;
  if (typeof a.confidence !== "number" || a.confidence < CONFIDENCE_THRESHOLD) {
    return { exposes_other_person: "abstain" };
  }
  return { exposes_other_person: a.choice };
}
