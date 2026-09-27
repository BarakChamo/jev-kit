// Detects whether a support draft reply exposes personal data (name, email,
// phone, or order id) belonging to someone other than the customer it is
// addressed to. Company contact addresses and support staff first names are
// not personal data and are not flagged.

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /\+?\d[\d\s().-]{6,}\d/g;
const ORDER_ID_RE = /\b[A-Za-z]{1,6}-\d{3,8}\b/g;

function normEmail(s) {
  return (s || "").trim().toLowerCase();
}

function digitsOf(s) {
  return (s || "").replace(/\D/g, "");
}

function phonesMatch(a, b) {
  const da = digitsOf(a);
  const db = digitsOf(b);
  if (!da || !db) return false;
  const shorter = da.length <= db.length ? da : db;
  const longer = da.length <= db.length ? db : da;
  if (shorter.length < 7) return da === db;
  return longer.endsWith(shorter);
}

function normOrderId(s) {
  return (s || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

// Extracts candidate identifiers from the draft that do NOT belong to the
// recipient. Exact/normalized matching is reliable, so this comparison is
// done in code rather than asked of Jev.
function extractCandidates(input) {
  const recipient = input.recipient || {};
  const text = input.draft_reply || "";

  const recipientEmail = normEmail(recipient.email);
  const recipientPhone = recipient.phone || "";
  const recipientOrderIds = new Set((recipient.order_ids || []).map(normOrderId));

  const emails = [...new Set((text.match(EMAIL_RE) || []))].filter(
    (e) => normEmail(e) !== recipientEmail
  );

  const phones = [...new Set((text.match(PHONE_RE) || []))].filter((p) => {
    const digitCount = digitsOf(p).length;
    if (digitCount < 7) return false;
    return !phonesMatch(p, recipientPhone);
  });

  const orderIds = [...new Set((text.match(ORDER_ID_RE) || []))].filter(
    (o) => !recipientOrderIds.has(normOrderId(o))
  );

  return { emails, phones, orderIds };
}

export function buildState(input) {
  const recipient = input.recipient || {};
  const { emails, phones, orderIds } = extractCandidates(input);
  return {
    recipient_name: recipient.name || "",
    draft_reply: input.draft_reply || "",
    candidate_emails: emails,
    candidate_phones: phones,
    candidate_order_ids: orderIds,
  };
}

export function questions(input) {
  const recipient = input.recipient || {};
  const recipientName = recipient.name || "the recipient";
  const { emails, phones, orderIds } = extractCandidates(input);
  const q = {};

  emails.forEach((email, i) => {
    q[`email_${i}`] = {
      type: "noul",
      instructions: `In the customer support reply given in draft_reply, the email address ${email} appears. Is ${email} a personal email address that belongs to or identifies a specific individual (a customer, employee, or other person), rather than a generic company contact address such as support@, help@, orders@, no-reply@, or returns@?`,
      criteria: {
        true: `${email} belongs to or identifies a specific individual`,
        false: `${email} is a generic company contact address, not tied to a specific individual`,
      },
    };
  });

  phones.forEach((phone, i) => {
    q[`phone_${i}`] = {
      type: "noul",
      instructions: `In the customer support reply given in draft_reply, the phone number ${phone} appears. Is ${phone} a personal phone number belonging to a specific individual (a customer, employee, or other person), rather than the company's general contact or support line?`,
      criteria: {
        true: `${phone} is a personal number belonging to a specific individual`,
        false: `${phone} is the company's own general contact/support number`,
      },
    };
  });

  orderIds.forEach((orderId, i) => {
    q[`orderid_${i}`] = {
      type: "noul",
      instructions: `In the customer support reply given in draft_reply, the text ${orderId} appears. Is ${orderId} presented as an order id or order number belonging to a customer's order, rather than an unrelated code such as a product model number, promo code, or other reference number?`,
      criteria: {
        true: `${orderId} is presented as a customer's order id/number`,
        false: `${orderId} is not actually an order id (e.g. a product code, promo code, or unrelated reference number)`,
      },
    };
  });

  q.name_check = {
    type: "noul",
    instructions: `The recipient of this reply is named ${recipientName}. Does draft_reply mention, by name, any specific person other than ${recipientName}? Do not count a company support staff member who is referred to only by a first name (e.g. an agent introducing themselves, or "our agent Mike"), since that is not personal data.`,
    criteria: {
      true: `draft_reply names a specific individual other than ${recipientName}, who is not merely a support staff member identified by first name only`,
      false: `draft_reply does not name any other specific individual (aside from ${recipientName} and any support staff referred to only by first name)`,
    },
  };

  return q;
}

const HIGH = 0.7;
const LOW = 0.3;

function classify(p) {
  if (typeof p !== "number") return "abstain";
  if (p >= HIGH) return "yes";
  if (p <= LOW) return "no";
  return "abstain";
}

export function decide(answers, input) {
  const labels = Object.keys(answers)
    .filter((k) => answers[k] && answers[k].type === "noul")
    .map((k) => classify(answers[k].noul));

  if (labels.some((l) => l === "yes")) {
    return { exposes_other_person: "yes" };
  }
  if (labels.some((l) => l === "abstain")) {
    return { exposes_other_person: "abstain" };
  }
  return { exposes_other_person: "no" };
}
