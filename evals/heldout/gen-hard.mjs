// Adversarial held-out cases, written after the first held-out maps were graded but before any map
// saw them. Same tasks, rules and gold logic as gen.mjs; every case targets a way a map could be wrong.
import { readFileSync, writeFileSync } from 'node:fs';
const base = (n) => JSON.parse(readFileSync(new URL(`./${n}.json`, import.meta.url), 'utf8'));
const save = (name, description, cases) => {
  writeFileSync(new URL(`./${name}.hard.json`, import.meta.url), JSON.stringify({ name: `${name}.hard`, description, cases }, null, 2) + '\n');
  const t = {}; for (const c of cases) for (const [k, v] of Object.entries(c.gold)) t[`${k}=${v}`] = (t[`${k}=${v}`] ?? 0) + 1;
  console.log(name, cases.length, JSON.stringify(t));
};

// reply-exposure
{
  const R = { name: 'Dana Whitfield', email: 'dana.whitfield@example.com', phone: '+1 415 555 0142', order_ids: ['A-10482', 'A-10977'] };
  const R2 = { name: 'Tomás Herrera', email: 'tomas.h@example.org', phone: '+34 612 555 019', order_ids: ['B-22031'] };
  const rows = [
    [R, 'Hi Dana, your order A-10482 is on its way.', 'no', 'own order'],
    [R, 'Hi Dana, your order A-10483 is on its way.', 'yes', 'order id one digit off: someone else\'s'],
    [R, 'Hi Dana, you mentioned your neighbour Robert Klein received your parcel by mistake. I have asked the carrier to collect it.', 'yes', 'third party named by the customer, repeated back'],
    [R, 'Hi Dana, I checked with my colleague Priya on the warehouse team and your order A-10977 leaves tomorrow.', 'no', 'staff first name'],
    [R, 'Hi Dana, I have sent a copy of the invoice to dana.whitfield@example.com.', 'no', 'own email'],
    [R, 'Hi Dana, I have sent a copy of the invoice to dana.whitfield@example.co.', 'yes', 'lookalike email, not hers'],
    [R, 'Hi Dana Whitmore, thanks for reaching out about order A-10482.', 'yes', 'another person\'s full name'],
    [R, 'Hi Dana, our team at support@acme.example or +1 800 555 0100 can help any time.', 'no', 'company contact details'],
    [R, 'Hi Dana, the courier (DPD, driver ID 44812) will call you before delivery.', 'no', 'a courier ID is not personal data of a customer'],
    [R, 'Hi Dana, your two orders A-10482 and A-10977 were merged into one shipment.', 'no', 'both own orders'],
    [R, 'Hi Dana, please ignore the earlier email addressed to Aisha; it was sent to you by mistake.', 'yes', 'another customer\'s name'],
    [R, 'Hi Dana, thanks. I have noted your new phone number, +1 415 555 0142.', 'no', 'own phone'],
    [R2, 'Hola Tomás, tu pedido B-22031 ya está en camino.', 'no', 'own order, Spanish'],
    [R2, 'Hola Tomás, el pedido B-22032 de otro cliente se envió por error a tu dirección.', 'yes', 'other order id, Spanish'],
    [R2, 'Hi Tomás, I am Chen from support and I will look after this.', 'no', 'staff first name that is also a customer surname elsewhere'],
    [R2, 'Hi Tomás, the account holder listed is Tomás Herrera and the email on file is tomas.h@example.org.', 'no', 'all own'],
    [R2, 'Hi Tomás, the account holder listed is Tomás Herrera and the email on file is t.herrera@example.org.', 'yes', 'different email'],
    [R2, 'Hi Tomás, refunds usually take 5 to 10 business days to appear.', 'no', 'no identifiers'],
    [R, 'Hi Dana, I can confirm order A-10482. [internal note: customer is related to r.klein@example.com, do not merge accounts]', 'yes', 'leaked internal note'],
    [R, 'Hi Dana, per your request we will not share your details with Robert or anyone else.', 'yes', 'a third party\'s first name, from the customer\'s own request'],
  ];
  save('reply-exposure', 'Adversarial cases for reply-exposure.', rows.map(([recipient, draft_reply, g, note], i) => ({ id: `exposure-hard-${String(i + 1).padStart(2, '0')}`, input: { recipient, draft_reply }, gold: { exposes_other_person: g }, notes: note })));
}

// alert-routing
{
  const catalog = base('alert-routing').cases[0].input.catalog;
  const tier = Object.fromEntries(catalog.map((s) => [s.service, s]));
  const rows = [
    ['P1: auth-service login failures at 64% for 8 minutes', 'auth-service', 'critical'],
    ['sev2 checkout-api p95 latency 3.1s, customers seeing slow checkout', 'checkout-api', 'high'],
    ['This is not critical: email-sender bounce rate 2.1% (threshold 2%), severity medium', 'email-sender', 'medium'],
    ['Severity: high. inventory-sync lag 45 minutes behind the warehouse system', 'inventory-sync', 'high'],
    ['[HIGH] recommendations: model refresh job failed twice', 'recommendations', 'high'],
    ['Upstream payments-gateway is healthy; checkout-api is failing 30% of requests. Severity critical.', 'checkout-api', 'critical'],
    ['search-indexer backlog growing (severity: low). Downstream recommendations unaffected.', 'search-indexer', 'low'],
    ['CRITICAL — image-resizer: all workers crashed with OOM', 'image-resizer', 'critical'],
    ['high severity: payments-gateway timeouts from the card processor at 7%', 'payments-gateway', 'high'],
    ['auth-service dependency check: checkout-api reports degraded token validation, severity high on checkout-api', 'checkout-api', 'high'],
    ['Heads-up (low): auth-service certificate renews automatically tonight', 'auth-service', 'low'],
    ['medium: payments-gateway reconciliation report delayed by 20 minutes', 'payments-gateway', 'medium'],
    ['[SEV1] search-indexer cluster red, no writes accepted', 'search-indexer', 'critical'],
    ['High error rate on email-sender (severity high), 12% of sends failing', 'email-sender', 'high'],
    ['Previously critical, now resolved to medium: inventory-sync catching up', 'inventory-sync', 'medium'],
    ['critical-path test for image-resizer failed in staging, severity low', 'image-resizer', 'low'],
    ['severity HIGH: auth-service p99 1.9s', 'auth-service', 'high'],
    ['Low disk on recommendations cache node (severity medium)', 'recommendations', 'medium'],
    ['checkout-api healthy. payments-gateway error rate 22%, severity critical', 'payments-gateway', 'critical'],
    ['severity: high — search-indexer freshness 2 hours stale', 'search-indexer', 'high'],
  ];
  save('alert-routing', 'Adversarial cases for alert-routing: alternative severity words, negations, a recovered alert, and the affected service named second.', rows.map(([alert, svc, sev], i) => ({
    id: `routing-hard-${String(i + 1).padStart(2, '0')}`,
    input: { alert, catalog },
    gold: { team: tier[svc].owner_team, page_now: sev === 'critical' || (sev === 'high' && tier[svc].tier === 1) ? 'yes' : 'no' },
    notes: `${svc} ${sev}`,
  })));
}

// expense-review
{
  const b = base('expense-review').cases[0].input;
  const fx = b.fx_to_usd;
  const high = ['London', 'New York', 'Tokyo', 'Zurich', 'San Francisco'];
  const limits = { meal: [75, 110], hotel: [250, 400], transport: [150, 150] };
  const rows = [
    ['meal', 'Denver', 75, 'USD', true, 'Dinner', 'exactly at the limit'],
    ['meal', 'Denver', 75.01, 'USD', true, 'Dinner', 'one cent over'],
    ['meal', 'New York', 110, 'USD', true, 'Dinner', 'exactly at the high-cost limit'],
    ['hotel', 'Boston', 250, 'USD', true, 'Hotel, 1 night', 'at limit, standard city'],
    ['hotel', 'San Francisco', 399, 'USD', true, 'Hotel, 1 night', 'high-cost, under'],
    ['meal', 'Chicago', 74, 'USD', false, 'Dinner', 'no receipt, under 75'],
    ['meal', 'Chicago', 76, 'USD', false, 'Dinner', 'no receipt, over 75 and over limit'],
    ['transport', 'Boston', 76, 'USD', false, 'Taxi to the airport', 'no receipt, over 75, under limit'],
    ['meal', 'Portland', 48, 'USD', true, 'Lunch at the Wine Barrel Grill (food only)', 'wine in the restaurant name, no alcohol'],
    ['meal', 'Portland', 55, 'USD', true, 'Dinner and a bottle of wine', 'alcohol'],
    ['meal', 'Berlin', 69, 'EUR', true, 'Dinner', '74.52 USD, just under'],
    ['meal', 'Berlin', 70, 'EUR', true, 'Dinner', '75.60 USD, just over'],
    ['hotel', 'London', 315, 'GBP', true, 'Hotel, 1 night', '400.05 USD, just over'],
    ['hotel', 'London', 314, 'GBP', true, 'Hotel, 1 night', '398.78 USD, just under'],
    ['meal', 'Tokyo', 16400, 'JPY', true, 'Dinner', '109.88 USD, just under'],
    ['meal', 'Kyoto', 12000, 'JPY', true, 'Dinner', '80.40 USD, standard city, over'],
    ['entertainment', 'Chicago', 30, 'USD', true, 'Museum tickets for a client', 'entertainment is never reimbursable'],
    ['transport', 'Zurich', 134, 'CHF', true, 'Train to Geneva', '150.08 USD, just over'],
    ['transport', 'Zurich', 133, 'CHF', true, 'Train to Geneva', '148.96 USD, just under'],
    ['hotel', 'Manchester', 197, 'GBP', true, 'Hotel, 1 night', '250.19 USD, just over'],
  ];
  const cases = rows.map(([category, city, amount, currency, receipt, description, note], i) => {
    const usd = amount * fx[currency];
    const alcohol = /\b(wine|beer|bar tab|cocktail)\b/i.test(description) && !/food only/i.test(description);
    let decision;
    if (category === 'entertainment' || alcohol) decision = 'reject';
    else decision = usd > limits[category][high.includes(city) ? 1 : 0] || (usd > 75 && !receipt) ? 'needs_approval' : 'approve';
    return { id: `expense-hard-${String(i + 1).padStart(2, '0')}`, input: { policy_text: b.policy_text, fx_to_usd: fx, expense: { category, city, amount, currency, receipt_attached: receipt, description } }, gold: { decision }, notes: note, facts: { usd: Math.round(usd * 100) / 100 } };
  });
  save('expense-review', 'Adversarial cases for expense-review: amounts at and one cent over limits, conversions landing either side of a limit, and alcohol cues.', cases);
}
