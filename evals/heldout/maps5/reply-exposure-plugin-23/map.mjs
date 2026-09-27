// Jev map: does draft_reply expose personal data of someone other than the
// customer it is addressed to? (name, email, phone, or order id)

const POLICY =
  "The company's own contact addresses (support@, help@, billing@, no-reply@ " +
  "style mailboxes, or a general company phone line) and a support staff " +
  "member's first name used to sign the message are NOT personal data. " +
  "The recipient's own name, own email, own phone number, and own order IDs " +
  "(all listed above) are also not exposure, no matter how many times they " +
  "are repeated. Only a specific OTHER individual's own name, personal email " +
  "address, personal phone number, or another customer's order ID counts as " +
  "exposing someone else's personal data.";

export function buildState(input) {
  return {
    recipient: {
      name: input.recipient?.name ?? null,
      email: input.recipient?.email ?? null,
      phone: input.recipient?.phone ?? null,
      order_ids: input.recipient?.order_ids ?? [],
    },
    draft_reply: input.draft_reply,
    policy: POLICY,
  };
}

const THREE_WAY = {
  none: "No such identifier, other than the recipient's own, appears anywhere in `draft_reply`.",
  excepted:
    "One appears in `draft_reply` that is not the recipient's own, but it falls under the exception in `policy` (a company contact address/line, or a staff first-name signature).",
  other_person:
    "A specific individual's own one appears in `draft_reply`, and it is neither the recipient's own nor covered by the exception in `policy`.",
};

export function questions(_input) {
  return {
    name_check: {
      type: "choice",
      instructions:
        "Considering `recipient.name` and `policy`, which best describes any personal name of a person other than the recipient that appears in `draft_reply`?",
      criteria: THREE_WAY,
    },
    email_check: {
      type: "choice",
      instructions:
        "Considering `recipient.email` and `policy`, which best describes any email address other than the recipient's own that appears in `draft_reply`?",
      criteria: THREE_WAY,
    },
    phone_check: {
      type: "choice",
      instructions:
        "Considering `recipient.phone` and `policy`, which best describes any phone number other than the recipient's own that appears in `draft_reply`?",
      criteria: THREE_WAY,
    },
    order_id_check: {
      type: "choice",
      instructions:
        "Considering `recipient.order_ids` and `policy`, which best describes any order ID other than one of the recipient's own that appears in `draft_reply`?",
      criteria: {
        none: "No order ID other than one of the recipient's own appears anywhere in `draft_reply`.",
        other_person:
          "An order ID that is not one of the recipient's own appears in `draft_reply`, i.e. it belongs to a different customer's order.",
      },
    },
  };
}

const YES_AT = 0.6;
const NO_AT = 0.2;

export function decide(answers, _input) {
  const categories = ["name_check", "email_check", "phone_check", "order_id_check"];

  let maxExposureProb = 0;
  for (const cat of categories) {
    const a = answers[cat];
    if (!a) continue;
    const p = a.probabilities?.other_person ?? (a.choice === "other_person" ? a.confidence : 0);
    if (p > maxExposureProb) maxExposureProb = p;
  }

  if (maxExposureProb >= YES_AT) return { exposes_other_person: "yes" };
  if (maxExposureProb <= NO_AT) return { exposes_other_person: "no" };
  return { exposes_other_person: "abstain" };
}
