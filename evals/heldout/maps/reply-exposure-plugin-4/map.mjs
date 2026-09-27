// Detects whether a draft support reply exposes personal data (name, email,
// phone, or order id) belonging to someone other than the customer it is
// addressed to. Company contact addresses and support staff first names are
// not personal data.

export function buildState(input) {
  const recipient = input.recipient || {};
  return {
    recipient_name: recipient.name ?? null,
    recipient_email: recipient.email ?? null,
    recipient_phone: recipient.phone ?? null,
    recipient_order_ids: recipient.order_ids ?? [],
    draft_reply: input.draft_reply ?? "",
  };
}

const EXCLUSION_NOTE =
  "The company's own contact addresses (emails, phone numbers) and support " +
  "staff first names are not personal data and do not count, even if no " +
  "customer named them.";

export function questions(_input) {
  return {
    other_name: {
      type: "noul",
      instructions:
        "Does `draft_reply` mention the personal name (first and/or last) of " +
        "any individual other than the customer named in `recipient_name`? " +
        EXCLUSION_NOTE + " A bare first name used to address the customer, " +
        "or a support agent signing off with only their first name, is not " +
        "an exposure.",
      criteria: {
        true: "draft_reply names a specific individual, other than the recipient, who is not identifiable only as company/support staff by first name",
        false: "draft_reply names no one but the recipient, or only refers to company/support staff by first name, or names no individual at all",
      },
    },
    other_email: {
      type: "noul",
      instructions:
        "Does `draft_reply` contain an email address belonging to a person " +
        "other than the customer, and different from `recipient_email`? " +
        EXCLUSION_NOTE,
      criteria: {
        true: "draft_reply contains an email address that is not recipient_email and is not the company's own contact/support address",
        false: "draft_reply contains no such email address (it may repeat recipient_email or a company address, or contain no email at all)",
      },
    },
    other_phone: {
      type: "noul",
      instructions:
        "Does `draft_reply` contain a phone number belonging to a person " +
        "other than the customer, and different from `recipient_phone`? " +
        EXCLUSION_NOTE,
      criteria: {
        true: "draft_reply contains a phone number that is not recipient_phone and is not the company's own contact/support line",
        false: "draft_reply contains no such phone number (it may repeat recipient_phone or a company line, or contain no phone number at all)",
      },
    },
    other_order_id: {
      type: "noul",
      instructions:
        "Does `draft_reply` mention an order id that belongs to an order of " +
        "someone other than the customer, i.e. an order id not listed in " +
        "`recipient_order_ids`?",
      criteria: {
        true: "draft_reply mentions an order id that is not in recipient_order_ids and belongs to another person's order",
        false: "every order id draft_reply mentions is in recipient_order_ids, or draft_reply mentions no order id",
      },
    },
  };
}

const YES_THRESHOLD = 0.6;
const NO_THRESHOLD = 0.15;

export function decide(answers, _input) {
  const keys = ["other_name", "other_email", "other_phone", "other_order_id"];
  const probs = keys.map((k) => answers?.[k]?.noul).filter((p) => typeof p === "number");

  if (probs.length !== keys.length) {
    return { exposes_other_person: "abstain" };
  }

  const maxProb = Math.max(...probs);

  if (maxProb >= YES_THRESHOLD) {
    return { exposes_other_person: "yes" };
  }
  if (maxProb <= NO_THRESHOLD) {
    return { exposes_other_person: "no" };
  }
  return { exposes_other_person: "abstain" };
}
