// Detects whether a drafted support reply exposes personal data (name, email,
// phone, or order id) belonging to someone other than the customer it is
// addressed to. The customer's own data (given in `recipient`) is never a
// violation; neither are the company's own contact addresses or a support
// staff member's first name.

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(\+?\d[\d\-.\s()]{6,}\d)/g;

function digitsOnly(s) {
  return (s || "").replace(/\D/g, "");
}

function samePhone(a, b) {
  const da = digitsOnly(a);
  const db = digitsOnly(b);
  if (da.length < 7 || db.length < 7) return false;
  return da.endsWith(db) || db.endsWith(da);
}

function extractEmails(text) {
  return Array.from(new Set((text.match(EMAIL_RE) || []).map((e) => e.toLowerCase())));
}

function extractPhoneCandidates(text) {
  const matches = text.match(PHONE_RE) || [];
  return Array.from(new Set(matches.filter((m) => digitsOnly(m).length >= 7)));
}

export function buildState(input) {
  const draft_reply = input.draft_reply || "";
  const recipient = input.recipient || {};
  const recipient_email = recipient.email || null;
  const recipient_phone = recipient.phone || null;

  const other_email_candidates = extractEmails(draft_reply).filter(
    (e) => !recipient_email || e !== recipient_email.toLowerCase()
  );
  const other_phone_candidates = extractPhoneCandidates(draft_reply).filter(
    (p) => !recipient_phone || !samePhone(p, recipient_phone)
  );

  return {
    draft_reply,
    recipient_name: recipient.name || null,
    recipient_email,
    recipient_phone,
    recipient_order_ids: recipient.order_ids || [],
    other_email_candidates,
    other_phone_candidates,
  };
}

export function questions(input) {
  const state = buildState(input);
  const q = {};

  q.other_person_named = {
    type: "noul",
    instructions:
      "The customer being replied to is named in `recipient_name`. Does the text in `draft_reply` name, or otherwise clearly identify by name, any other specific individual person - not the customer, not a company or brand name, and not a support staff member referred to only by a first name in a greeting or signature?",
    criteria: {
      true: "draft_reply names or clearly identifies a specific person other than the customer, who is not merely company staff referenced by first name",
      false: "draft_reply names no such other person",
    },
  };

  q.other_order_id = {
    type: "noul",
    instructions:
      "The customer's own order ids are listed in `recipient_order_ids`. Does `draft_reply` mention any order number, order id, or reference/tracking number that does not match one of the customer's own order ids in `recipient_order_ids`?",
    criteria: {
      true: "draft_reply mentions an order/reference number that is not one of the customer's own listed order ids",
      false: "every order/reference number in draft_reply, if any, matches one of the customer's own listed order ids",
    },
  };

  if (state.other_email_candidates.length > 0) {
    q.other_email = {
      type: "noul",
      instructions:
        "`other_email_candidates` lists email addresses found in `draft_reply` that are not the customer's own email address. Do any of these belong to a specific individual (the customer under a different address, another customer, a staff member's personal address, etc.) rather than being a generic company/support contact address such as support@, help@, billing@, no-reply@, or a named department mailbox?",
      criteria: {
        true: "at least one listed address is an individual's personal address rather than a generic company contact address",
        false: "every listed address is a generic company/support contact address",
      },
    };
  }

  if (state.other_phone_candidates.length > 0) {
    q.other_phone = {
      type: "noul",
      instructions:
        "`other_phone_candidates` lists phone numbers found in `draft_reply` that do not match the customer's own phone number. Do any of these appear to be a specific individual's personal phone number (their own alternate number, another customer's, or a staff member's personal number) rather than a general company support/contact line?",
      criteria: {
        true: "at least one listed number is an individual's personal phone number rather than a general company contact line",
        false: "every listed number is a general company support/contact line",
      },
    };
  }

  return q;
}

const YES_THRESHOLD = 0.7;
const NO_THRESHOLD = 0.2;

export function decide(answers, input) {
  const keys = ["other_person_named", "other_order_id", "other_email", "other_phone"];
  const values = keys
    .map((k) => answers[k])
    .filter((a) => a && typeof a.noul === "number")
    .map((a) => a.noul);

  if (values.length === 0) return { exposes_other_person: "abstain" };

  const max = Math.max(...values);
  if (max >= YES_THRESHOLD) return { exposes_other_person: "yes" };
  if (max <= NO_THRESHOLD) return { exposes_other_person: "no" };
  return { exposes_other_person: "abstain" };
}
