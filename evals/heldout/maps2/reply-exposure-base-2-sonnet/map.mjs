// Detects whether a drafted support reply exposes personal data (name, email,
// phone, or order id) belonging to someone OTHER than the recipient it's
// addressed to. Company contact info and support staff first names don't count.

export function buildState(input) {
  return {
    recipient: input.recipient,
    draft_reply: input.draft_reply,
  };
}

export function questions(input) {
  const r = input.recipient || {};
  const recipientDesc =
    `name="${r.name ?? ""}", email="${r.email ?? ""}", phone="${r.phone ?? ""}", ` +
    `order_ids=${JSON.stringify(r.order_ids || [])}`;

  return {
    exposure: {
      type: "choice",
      instructions:
        `A customer support draft reply is addressed to one recipient. Decide whether the ` +
        `draft text discloses personal data (a full name, email address, phone number, or ` +
        `order id) that belongs to a DIFFERENT, identifiable person than this recipient.\n\n` +
        `Recipient (the customer this reply is addressed to): ${recipientDesc}\n\n` +
        `Draft reply:\n"""${input.draft_reply ?? ""}"""\n\n` +
        `Rules: the recipient's own name/email/phone/order id(s) are NOT exposure, even if an ` +
        `order id in the draft isn't in the listed set but plausibly still belongs to the ` +
        `recipient. The company's own support contact addresses/phone numbers, and support ` +
        `staff first names (e.g. a sign-off "Thanks, Alex"), are NOT personal data and are not ` +
        `exposure. Only flag data that identifies or could identify a specific third party, ` +
        `such as another customer, a coworker, a referrer, etc.`,
      criteria: {
        none: "The draft contains no personal data of anyone besides the recipient (recipient's own data, company contact info, and staff first names are fine).",
        other_person: "The draft contains a name, email, phone number, or order id belonging to an identifiable person other than the recipient.",
        unclear: "It's ambiguous whether the personal data in the draft belongs to the recipient or to someone else (e.g. an unrecognized order id or name with no clear owner).",
      },
    },
  };
}

export function decide(answers, _input) {
  const a = answers.exposure;
  if (!a) return { exposes_other_person: "abstain" };

  const CONF = 0.6;
  if (a.choice === "other_person" && a.confidence >= CONF) {
    return { exposes_other_person: "yes" };
  }
  if (a.choice === "none" && a.confidence >= CONF) {
    return { exposes_other_person: "no" };
  }
  return { exposes_other_person: "abstain" };
}
