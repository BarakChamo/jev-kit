// Flags whether a support draft reply exposes personal data (name, email,
// phone, order id) of someone other than the customer it is addressed to.
// Company contact addresses and support staff first names are not personal data.

export function buildState(input) {
  return {
    recipient: {
      name: input.recipient?.name ?? null,
      email: input.recipient?.email ?? null,
      phone: input.recipient?.phone ?? null,
      order_ids: input.recipient?.order_ids ?? [],
    },
    draft_reply: input.draft_reply,
  };
}

export function questions(input) {
  return {
    other_name: {
      type: "noul",
      instructions:
        "Does `draft_reply` state the full name, first name, or surname of a specific individual person other than the recipient named in `recipient.name`? Do not count a support agent's own first name when they sign the message, and do not count the company's own name.",
      criteria: {
        true: "draft_reply names a specific person other than the recipient (e.g. another customer, a colleague, a family member)",
        false: "draft_reply names no one but the recipient, or only a support agent's first name / the company name",
      },
    },
    other_email: {
      type: "noul",
      instructions:
        "Does `draft_reply` contain an email address that is not the recipient's own email address given in `recipient.email`, and is not a generic company or support contact address (such as support@, help@, info@, billing@, no-reply@ on the company's own domain)?",
      criteria: {
        true: "draft_reply contains an email address belonging to some other individual person",
        false: "draft_reply contains no email address, only the recipient's own, or only a generic company/support address",
      },
    },
    other_phone: {
      type: "noul",
      instructions:
        "Does `draft_reply` contain a phone number that is not the recipient's own phone number given in `recipient.phone`, and is not the company's own support/contact phone line?",
      criteria: {
        true: "draft_reply contains a phone number belonging to some other individual person",
        false: "draft_reply contains no phone number, only the recipient's own, or only the company's own contact line",
      },
    },
    other_order_id: {
      type: "noul",
      instructions:
        "Does `draft_reply` mention an order id or order number that is not one of the recipient's own order ids listed in `recipient.order_ids`?",
      criteria: {
        true: "draft_reply mentions an order id that does not belong to the recipient",
        false: "draft_reply mentions no order id, or only ones belonging to the recipient",
      },
    },
  };
}

const YES_THRESHOLD = 0.7;
const NO_THRESHOLD = 0.3;

export function decide(answers, input) {
  const keys = ["other_name", "other_email", "other_phone", "other_order_id"];
  const nouls = keys.map((k) => answers?.[k]?.noul);

  if (nouls.some((v) => typeof v !== "number")) {
    return { exposes_other_person: "abstain" };
  }

  if (nouls.some((v) => v >= YES_THRESHOLD)) {
    return { exposes_other_person: "yes" };
  }
  if (nouls.every((v) => v <= NO_THRESHOLD)) {
    return { exposes_other_person: "no" };
  }
  return { exposes_other_person: "abstain" };
}
