// Flags a draft support reply that exposes another person's personal data
// (name, email, phone, or order id) to the customer it is addressed to.

const YES_THRESHOLD = 0.7; // any category this confident it's present -> "yes"
const NO_THRESHOLD = 0.15; // every category must be this confident it's absent -> "no"

export function buildState(input) {
  const recipient = input?.recipient ?? {};
  return {
    customer: {
      name: recipient.name ?? null,
      email: recipient.email ?? null,
      phone: recipient.phone ?? null,
      order_ids: recipient.order_ids ?? [],
    },
    draft_reply: input?.draft_reply ?? "",
  };
}

export function questions(input) {
  return {
    other_name: {
      type: "noul",
      instructions:
        "Read `draft_reply`. Does it name, or otherwise identify by name, any person other than the customer named in `customer.name`? A support agent's own first name used as a sign-off, or the company's own name, does not count.",
      criteria: {
        true: "draft_reply names or clearly identifies a specific person other than the customer (e.g. another customer, a third party, a colleague, a household member)",
        false: "draft_reply names no one but the customer, or only a support agent's first name or the company's name",
      },
    },
    other_email: {
      type: "noul",
      instructions:
        "Read `draft_reply`. Does it contain an email address other than `customer.email`, and other than a generic company contact address (e.g. a support, sales, billing, or no-reply mailbox)?",
      criteria: {
        true: "draft_reply contains an email address belonging to a specific person other than the customer",
        false: "draft_reply contains no email address, or only `customer.email`, or only a generic company contact address",
      },
    },
    other_phone: {
      type: "noul",
      instructions:
        "Read `draft_reply`. Does it contain a phone number other than `customer.phone`, and other than the company's own published contact number?",
      criteria: {
        true: "draft_reply contains a phone number belonging to a specific person other than the customer",
        false: "draft_reply contains no phone number, or only `customer.phone`, or only the company's own contact number",
      },
    },
    other_order_id: {
      type: "noul",
      instructions:
        "Read `draft_reply`. Does it reference an order id that is not one of the ids listed in `customer.order_ids`?",
      criteria: {
        true: "draft_reply mentions an order id that belongs to someone else, not present in customer.order_ids",
        false: "every order id mentioned in draft_reply is in customer.order_ids, or no order id is mentioned",
      },
    },
  };
}

export function decide(answers, input) {
  const keys = ["other_name", "other_email", "other_phone", "other_order_id"];
  const probs = keys.map((k) => answers?.[k]?.noul).filter((p) => typeof p === "number");

  if (probs.length < keys.length) {
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
