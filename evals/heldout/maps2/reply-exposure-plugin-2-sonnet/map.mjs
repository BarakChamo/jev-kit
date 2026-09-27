// Decide whether a draft support reply exposes personal data (name, email,
// phone, or order id) of anyone other than the customer it is addressed to.
// Company contact addresses and support staff first names are not personal data.

export function buildState(input) {
  return {
    recipient: input.recipient,
    draft_reply: input.draft_reply,
  };
}

export function questions(input) {
  return {
    other_name: {
      type: "noul",
      instructions:
        "Read `draft_reply`. Does it mention the full name (first and last name, or any name/description that identifies a specific individual) of a real person OTHER than the customer named in `recipient.name`? A bare first name used only as a support agent's own signature (e.g. \"Best, Sarah\") is NOT personal data and does not count. A full name of anyone else (a colleague, another customer, a staff member's full name, a third party mentioned in the text) DOES count.",
      criteria: {
        true: "draft_reply names a specific person, other than the customer, by full name or an equivalent identifying description",
        false: "draft_reply names no one but the customer, or only uses a bare staff first name",
      },
    },
    other_email: {
      type: "noul",
      instructions:
        "Read `draft_reply`. Does it contain an email address that (a) differs from `recipient.email` and (b) is not a generic company/support contact address (e.g. support@, help@, info@, billing@, no-reply@)? Such an address would belong to some other person.",
      criteria: {
        true: "draft_reply contains a personal-looking email address that is neither the customer's own address nor a generic company address",
        false: "draft_reply contains no email address, only the customer's own address, or only generic company addresses",
      },
    },
    other_phone: {
      type: "noul",
      instructions:
        "Read `draft_reply`. Does it contain a phone number that (a) differs from `recipient.phone` and (b) is not the company's own support/contact phone number? Such a number would belong to some other person.",
      criteria: {
        true: "draft_reply contains a phone number that is neither the customer's own number nor the company's contact number",
        false: "draft_reply contains no phone number, only the customer's own number, or only the company's contact number",
      },
    },
    other_order_id: {
      type: "noul",
      instructions:
        "Read `draft_reply`. Does it mention an order id, ticket id, or similar account/order reference that does NOT appear in `recipient.order_ids`? Ignore purely generic placeholders used only to illustrate a format (e.g. \"e.g. A-00000\"), and ignore references that plainly belong to the company itself.",
      criteria: {
        true: "draft_reply references a specific order/ticket id belonging to someone other than the customer",
        false: "draft_reply mentions no order id, or only ids that are in recipient.order_ids",
      },
    },
  };
}

const YES_THRESHOLD = 0.65;
const NO_THRESHOLD = 0.3;

export function decide(answers, input) {
  const flags = ["other_name", "other_email", "other_phone", "other_order_id"];
  const probs = flags.map((id) => answers[id]?.noul);

  if (probs.some((p) => typeof p !== "number")) {
    return { exposes_other_person: "abstain" };
  }

  if (probs.some((p) => p >= YES_THRESHOLD)) {
    return { exposes_other_person: "yes" };
  }

  if (probs.every((p) => p <= NO_THRESHOLD)) {
    return { exposes_other_person: "no" };
  }

  return { exposes_other_person: "abstain" };
}
