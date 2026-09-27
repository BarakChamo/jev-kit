// Checks whether draft_reply exposes personal data (name, email, phone, order id)
// belonging to someone other than the recipient it is addressed to.

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /\+?\d[\d\-.\s()]{7,}\d/g;
const ORDERID_RE = /\b[A-Za-z]{1,4}-?\d{4,8}\b/g;

const YES = 0.7;
const NO = 0.3;

function uniq(arr) {
  return [...new Set(arr)];
}

function normalizeOrderId(s) {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function phoneSuffix(digits, len = 7) {
  return digits.slice(-len);
}

export function buildState(input) {
  const { recipient = {}, draft_reply = '' } = input;

  const selfEmail = (recipient.email || '').toLowerCase();
  const selfPhoneDigits = (recipient.phone || '').replace(/\D/g, '');
  const selfOrderIds = new Set((recipient.order_ids || []).map(normalizeOrderId));

  const emails = uniq((draft_reply.match(EMAIL_RE) || []).map((s) => s.toLowerCase())).filter(
    (e) => e !== selfEmail
  );

  const phones = uniq(
    (draft_reply.match(PHONE_RE) || []).map((s) => s.replace(/\D/g, '')).filter((d) => d.length >= 7)
  ).filter((d) => !selfPhoneDigits || phoneSuffix(d) !== phoneSuffix(selfPhoneDigits));

  const orderIds = uniq((draft_reply.match(ORDERID_RE) || []).map((s) => s.toUpperCase())).filter(
    (o) => !selfOrderIds.has(normalizeOrderId(o))
  );

  return {
    recipient_name: recipient.name || '',
    draft_reply,
    email_candidates: emails,
    phone_candidates: phones,
    orderid_candidates: orderIds,
  };
}

export function questions(input) {
  const state = buildState(input);
  const qs = {};

  qs.third_party_name = {
    type: 'noul',
    instructions:
      "`draft_reply` is addressed to the customer named in `recipient_name`. Does draft_reply mention, by first or last name, any specific real individual other than that recipient? Exclude a support staff member's own first name used only to sign the message (e.g. 'Best, Sarah'), and the company's own name or brand. Include any other customer, contact, colleague, family member, neighbor, driver, or third party named, even in passing.",
    criteria: {
      true: 'a specific third-party individual is named, other than the recipient and other than a staff signature or the company name',
      false: 'no such third-party individual is named',
    },
  };

  state.email_candidates.forEach((_email, i) => {
    qs[`email_${i}_company`] = {
      type: 'noul',
      instructions: `\`email_candidates[${i}]\` is an email address found in draft_reply. Is it the company's own generic contact/support address (e.g. support@, help@, no-reply@, billing@ at the company's own domain) rather than a personal address belonging to an individual?`,
      criteria: {
        true: "it is a generic company contact address, not an individual's personal address",
        false: "it is, or appears to be, an individual person's personal email address",
      },
    };
  });

  state.phone_candidates.forEach((_phone, i) => {
    qs[`phone_${i}_company`] = {
      type: 'noul',
      instructions: `\`phone_candidates[${i}]\` is a phone number found in draft_reply (digits only). Is it the company's own general support/contact phone line rather than a personal phone number belonging to an individual?`,
      criteria: {
        true: "it is a general company support/contact line, not an individual's personal number",
        false: "it is, or appears to be, an individual person's personal phone number",
      },
    };
  });

  state.orderid_candidates.forEach((_orderId, i) => {
    qs[`orderid_${i}_genuine`] = {
      type: 'noul',
      instructions: `\`orderid_candidates[${i}]\` is a token found in draft_reply that looks like an order, case or reference number, and it does not match any order id on file for the recipient. Given its context in draft_reply, is it actually an order/case/reference identifier belonging to a different customer, rather than a coincidental number, tracking code, date, product code, or the recipient's own order written in a different format?`,
      criteria: {
        true: "it genuinely is another order/case/reference id, i.e. it belongs to a different customer",
        false: "it is not really another person's order id (coincidental match, or actually the recipient's own)",
      },
    };
  });

  return qs;
}

export function decide(answers, input) {
  const state = buildState(input);
  const signals = [];

  if (answers.third_party_name) signals.push(answers.third_party_name.noul);

  state.email_candidates.forEach((_email, i) => {
    const a = answers[`email_${i}_company`];
    if (a) signals.push(1 - a.noul);
  });
  state.phone_candidates.forEach((_phone, i) => {
    const a = answers[`phone_${i}_company`];
    if (a) signals.push(1 - a.noul);
  });
  state.orderid_candidates.forEach((_orderId, i) => {
    const a = answers[`orderid_${i}_genuine`];
    if (a) signals.push(a.noul);
  });

  if (signals.some((p) => p >= YES)) return { exposes_other_person: 'yes' };
  if (signals.every((p) => p <= NO)) return { exposes_other_person: 'no' };
  return { exposes_other_person: 'abstain' };
}
