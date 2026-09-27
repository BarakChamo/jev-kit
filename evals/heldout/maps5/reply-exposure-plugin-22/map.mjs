// Jev map: does a support draft reply expose personal data of someone other
// than the customer it's addressed to?

const POLICY_NOTE =
  "Personal data means a name, email address, phone number or order id that " +
  "identifies a real person. The recipient's own name, email, phone and order " +
  "ids (given below) are never exposure, no matter how they appear in the " +
  "text. The company's own contact channels (a general support/help/billing/" +
  "noreply email or phone number) are not personal data. A support staff " +
  "member's first name used alone, e.g. in a sign-off ('Thanks, Alex'), is not " +
  "personal data either. Only a name, email, phone or order id belonging to " +
  "some other identifiable person counts as exposure.";

export function buildState(input) {
  const recipient = input.recipient || {};
  return {
    policy_note: POLICY_NOTE,
    recipient: {
      name: recipient.name ?? null,
      email: recipient.email ?? null,
      phone: recipient.phone ?? null,
      order_ids: recipient.order_ids ?? [],
    },
    draft_reply: input.draft_reply ?? "",
  };
}

export function questions(_input) {
  return {
    other_name: {
      type: "noul",
      instructions:
        "Does `draft_reply` mention the full name or surname of any real " +
        "person other than the person named in `recipient.name`? Follow " +
        "`policy_note`: a support staff member's first name used alone (a " +
        "sign-off or introduction) does not count.",
      criteria: {
        true: "draft_reply names a person other than the recipient (beyond a lone staff first name)",
        false: "draft_reply names no one but the recipient, or only a staff first name",
      },
    },
    other_email: {
      type: "noul",
      instructions:
        "Does `draft_reply` contain an email address that is neither " +
        "`recipient.email` nor a generic company contact address as " +
        "described in `policy_note` (e.g. general support, help, billing or " +
        "noreply)?",
      criteria: {
        true: "draft_reply contains such a third party email address",
        false: "draft_reply contains no email, only recipient.email, or only a company contact address",
      },
    },
    other_phone: {
      type: "noul",
      instructions:
        "Does `draft_reply` contain a phone number that is neither " +
        "`recipient.phone` nor a general company contact phone number as " +
        "described in `policy_note`?",
      criteria: {
        true: "draft_reply contains such a third party phone number",
        false: "draft_reply contains no phone number, only recipient.phone, or only a company contact number",
      },
    },
    other_order_id: {
      type: "noul",
      instructions:
        "Does `draft_reply` contain an order id that is not one of the ids " +
        "listed in `recipient.order_ids`?",
      criteria: {
        true: "draft_reply contains an order id outside recipient.order_ids",
        false: "draft_reply contains no order id, or only ones from recipient.order_ids",
      },
    },
  };
}

export function decide(answers, _input) {
  const nouls = [
    answers.other_name,
    answers.other_email,
    answers.other_phone,
    answers.other_order_id,
  ].map((a) => a?.noul).filter((v) => typeof v === "number");

  if (nouls.length === 0) return { exposes_other_person: "abstain" };

  const max = Math.max(...nouls);

  if (max >= 0.6) return { exposes_other_person: "yes" };
  if (max <= 0.2) return { exposes_other_person: "no" };
  return { exposes_other_person: "abstain" };
}
