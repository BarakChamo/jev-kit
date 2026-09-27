// Held-out suites for the plugin, written and committed before any agent wrote a map for them.
// Three tasks unlike the ones the plugin was tuned on. Gold is computed by rule from generated facts.
import { writeFileSync } from 'node:fs';

const out = (name, description, cases) => {
  writeFileSync(new URL(`./${name}.json`, import.meta.url), JSON.stringify({ name, description, cases }, null, 2) + '\n');
  const tally = {};
  for (const c of cases) for (const [k, v] of Object.entries(c.gold)) tally[`${k}=${v}`] = (tally[`${k}=${v}`] ?? 0) + 1;
  console.log(name, cases.length, JSON.stringify(tally));
};

// ---------------------------------------------------------------------------------------------------
// 1. reply-exposure: does a support agent's draft reply expose personal data of anyone other than the
//    recipient? The recipient's own records are in the input; the reply alone cannot tell whose an
//    order number is.
{
  const recips = [
    { name: 'Dana Whitfield', email: 'dana.whitfield@example.com', phone: '+1 415 555 0142', orders: ['A-10482', 'A-10977'] },
    { name: 'Tomás Herrera', email: 'tomas.h@example.org', phone: '+34 612 555 019', orders: ['B-22031'] },
    { name: 'Priya Natarajan', email: 'priya.n@example.net', phone: '+44 20 7946 0321', orders: ['C-30550', 'C-30912', 'C-31008'] },
    { name: 'Marcus Oyelaran', email: 'm.oyelaran@example.com', phone: '+1 312 555 0187', orders: ['A-11240'] },
    { name: 'Lena Fischer', email: 'lena.fischer@example.de', phone: '+49 30 555 0199', orders: ['D-40017', 'D-40118'] },
  ];
  const others = [
    { name: 'Robert Klein', email: 'r.klein@example.com', phone: '+1 646 555 0110', order: 'A-10483' },
    { name: 'Aisha Rahman', email: 'aisha.rahman@example.org', phone: '+1 202 555 0164', order: 'B-22032' },
    { name: 'Chen Wei', email: 'chen.wei@example.cn', phone: '+86 10 5555 0101', order: 'C-30551' },
  ];
  const T = [
    // [template, exposes] — {r} recipient, {o} another customer
    ['Hi {r.first}, your order {r.order} shipped this morning and should arrive Thursday. You can track it from your account page.', 'no'],
    ['Hi {r.first}, I have refunded order {r.order} in full; the money should be back on your card within 5 business days.', 'no'],
    ['Hi {r.first}, thanks for your patience. I checked order {o.order} and it is out for delivery today.', 'yes'],
    ['Hi {r.first}, I have updated the phone number on your account to {r.phone} as requested.', 'no'],
    ['Hi {r.first}, I have updated the phone number on your account to {o.phone} as requested.', 'yes'],
    ['Hello {r.first}, our billing team (billing@acme-support.example) will follow up on the duplicate charge.', 'no'],
    ['Hi {r.first}, I have forwarded your request to {o.name} ({o.email}), who handled a similar case last week.', 'yes'],
    ['Hi {r.first}, I can see both of your orders, {r.order} and {r.order2}; the second one is delayed at the depot.', 'no'],
    ['Hi {r.first}, here is the log from our system: "2026-03-02 lookup email={o.email} status=bounced". The bounce was on our side.', 'yes'],
    ['Hi {r.first}, you wrote: "my order {r.order} arrived damaged". I am sorry, a replacement is on its way.', 'no'],
    ['Hi {r.first}, I am Sam from the support team and I will own this ticket until it is resolved.', 'no'],
    ['Dear {r.first}, the delivery address we have for order {r.order} is the one you gave at checkout. If that is wrong, reply with the new one.', 'no'],
    ['Hi {r.first}, another customer, {o.first}, reported the same issue with order {o.order}, so we know it is a carrier problem.', 'yes'],
    ['Hi {r.first}, we sent the confirmation to {r.email}. If you cannot find it, check your spam folder.', 'no'],
    ['Hi {r.first}, we sent the confirmation to {o.email}. If you cannot find it, check your spam folder.', 'yes'],
  ];
  const fill = (t, r, o, i) =>
    t.replaceAll('{r.first}', r.name.split(' ')[0]).replaceAll('{r.order}', r.orders[0]).replaceAll('{r.order2}', r.orders[1] ?? r.orders[0])
      .replaceAll('{r.phone}', r.phone).replaceAll('{r.email}', r.email)
      .replaceAll('{o.first}', o.name.split(' ')[0]).replaceAll('{o.name}', o.name).replaceAll('{o.email}', o.email).replaceAll('{o.phone}', o.phone).replaceAll('{o.order}', o.order);
  const cases = [];
  for (let i = 0; i < 30; i++) {
    const [t, exposes] = T[i % T.length];
    const r = recips[i % recips.length];
    if (t.includes('{r.order2}') && r.orders.length < 2) continue;
    const o = others[i % others.length];
    cases.push({
      id: `exposure-${String(cases.length + 1).padStart(3, '0')}`,
      input: { recipient: { name: r.name, email: r.email, phone: r.phone, order_ids: r.orders }, draft_reply: fill(t, r, o, i) },
      gold: { exposes_other_person: exposes },
    });
  }
  // top up to 30 with the recipient's-own-data templates on other recipients
  let k = 0;
  while (cases.length < 30) {
    const r = recips[(k + 2) % recips.length], o = others[k % others.length];
    const [t, exposes] = T[[2, 8, 0][k % 3]];
    cases.push({ id: `exposure-${String(cases.length + 1).padStart(3, '0')}`, input: { recipient: { name: r.name, email: r.email, phone: r.phone, order_ids: r.orders }, draft_reply: fill(t, r, o, k) }, gold: { exposes_other_person: exposes } });
    k++;
  }
  out('reply-exposure', 'Does a support draft reply expose personal data (name, email, phone, order id) of anyone other than the recipient? The company\'s own contact details and support staff names are not personal data.', cases);
}

// ---------------------------------------------------------------------------------------------------
// 2. alert-routing: which team owns the affected service, and should it page now? Page now iff the
//    alert's severity is critical, or it is high and the service is tier 1. The catalog is in the input.
{
  const catalog = [
    { service: 'checkout-api', owner_team: 'payments', tier: 1 },
    { service: 'payments-gateway', owner_team: 'payments', tier: 1 },
    { service: 'search-indexer', owner_team: 'discovery', tier: 2 },
    { service: 'recommendations', owner_team: 'discovery', tier: 3 },
    { service: 'auth-service', owner_team: 'identity', tier: 1 },
    { service: 'email-sender', owner_team: 'messaging', tier: 2 },
    { service: 'image-resizer', owner_team: 'media', tier: 3 },
    { service: 'inventory-sync', owner_team: 'supply', tier: 2 },
  ];
  const texts = {
    critical: ['[CRITICAL] {s}: error rate 38% over 5m (threshold 5%)', 'SEV1 {s} is down: 0 of 6 pods ready', 'critical: {s} returning 503 to all requests since 02:14 UTC'],
    high: ['[HIGH] {s}: p99 latency 4.2s (threshold 1.5s) for 10m', 'Severity high - {s} queue depth 18,000 and rising', 'high: {s} error budget burn rate 14x'],
    medium: ['[MEDIUM] {s}: disk usage 81% on 2 nodes', 'warning (medium): {s} retry rate elevated, 3% of jobs', 'medium: {s} certificate expires in 12 days'],
    low: ['[LOW] {s}: deprecated config key in use', 'low: {s} one canary check flapped twice in an hour', 'info/low: {s} log volume 20% above weekly average'],
  };
  const cases = [];
  const sevs = ['critical', 'high', 'medium', 'low'];
  for (let i = 0; i < 30; i++) {
    const svc = catalog[(i * 3) % catalog.length];
    const sev = sevs[(i + Math.floor(i / 4)) % 4];
    let text = texts[sev][i % 3].replace('{s}', svc.service);
    // a third of the alerts mention a second service as context, which is not the affected one
    if (i % 3 === 1) {
      const dep = catalog[(i * 3 + 2) % catalog.length];
      text += `. Upstream ${dep.service} looks healthy.`;
    }
    const page = sev === 'critical' || (sev === 'high' && svc.tier === 1);
    cases.push({ id: `routing-${String(i + 1).padStart(3, '0')}`, input: { alert: text, catalog }, gold: { team: svc.owner_team, page_now: page ? 'yes' : 'no' } });
  }
  out('alert-routing', 'Route an alert to the team that owns the affected service (from the catalog), and decide whether to page now: page iff severity is critical, or severity is high and the service is tier 1. Other services mentioned as context are not the affected service.', cases);
}

// ---------------------------------------------------------------------------------------------------
// 3. expense-review: approve / needs_approval / reject under a written policy, with foreign currency.
{
  const policy =
    'Travel and expense policy (2026).\n' +
    '1. Meals: up to USD 75 per person per day in standard cities and USD 110 in high-cost cities (London, New York, Tokyo, Zurich, San Francisco).\n' +
    '2. Hotels: up to USD 250 per night in standard cities and USD 400 in high-cost cities.\n' +
    '3. Ground transport (taxi, rideshare, train): up to USD 150 per trip.\n' +
    '4. Alcohol and entertainment are never reimbursable.\n' +
    '5. Any single expense above USD 75 needs an itemised receipt; without one it needs manager approval.\n' +
    '6. Anything above its limit needs manager approval; it is not rejected.';
  const fx = { USD: 1, EUR: 1.08, GBP: 1.27, JPY: 0.0067, CHF: 1.12 };
  const high = ['London', 'New York', 'Tokyo', 'Zurich', 'San Francisco'];
  const limits = { meal: [75, 110], hotel: [250, 400], transport: [150, 150] };
  const rows = [
    // [category, city, amount, currency, receipt, description]
    ['meal', 'Chicago', 62, 'USD', false, 'Team lunch for one, client visit'],
    ['meal', 'London', 80, 'GBP', true, 'Dinner, conference day 2'],
    ['meal', 'London', 95, 'GBP', true, 'Dinner, conference day 3'],
    ['meal', 'Berlin', 68, 'EUR', true, 'Dinner'],
    ['meal', 'Berlin', 72, 'EUR', true, 'Dinner with a candidate'],
    ['meal', 'Tokyo', 14500, 'JPY', true, 'Dinner'],
    ['meal', 'Tokyo', 17900, 'JPY', true, 'Dinner'],
    ['meal', 'Austin', 58, 'USD', true, 'Dinner with the Austin sales team'],
    ['meal', 'Denver', 40, 'USD', true, 'Bar tab after the offsite'],
    ['hotel', 'New York', 389, 'USD', true, 'Hotel, 1 night'],
    ['hotel', 'New York', 455, 'USD', true, 'Hotel, 1 night'],
    ['hotel', 'Madrid', 210, 'EUR', true, 'Hotel, 1 night'],
    ['hotel', 'Madrid', 245, 'EUR', true, 'Hotel, 1 night'],
    ['hotel', 'Zurich', 340, 'CHF', true, 'Hotel, 1 night'],
    ['hotel', 'Zurich', 372, 'CHF', true, 'Hotel, 1 night'],
    ['hotel', 'Leeds', 180, 'GBP', true, 'Hotel, 1 night'],
    ['hotel', 'Leeds', 205, 'GBP', true, 'Hotel, 1 night'],
    ['hotel', 'Portland', 219, 'USD', false, 'Hotel, 1 night (receipt lost)'],
    ['transport', 'San Francisco', 64, 'USD', false, 'Rideshare, airport to office'],
    ['transport', 'Paris', 120, 'EUR', true, 'Taxi, airport to hotel'],
    ['transport', 'Paris', 145, 'EUR', true, 'Taxi, airport to hotel at night'],
    ['transport', 'London', 110, 'GBP', true, 'Train, London to Manchester return'],
    ['transport', 'London', 125, 'GBP', true, 'Train, London to Edinburgh'],
    ['transport', 'Seattle', 90, 'USD', false, 'Taxi to client site'],
    ['meal', 'Seattle', 70, 'USD', false, 'Dinner'],
    ['meal', 'Seattle', 78, 'USD', false, 'Dinner'],
    ['entertainment', 'Las Vegas', 120, 'USD', true, 'Show tickets for the team'],
    ['meal', 'Zurich', 95, 'CHF', true, 'Dinner'],
    ['meal', 'Zurich', 105, 'CHF', true, 'Dinner'],
    ['transport', 'Tokyo', 21000, 'JPY', true, 'Taxi, Narita to hotel'],
  ];
  const cases = rows.map(([category, city, amount, currency, receipt, description], i) => {
    const usd = amount * fx[currency];
    const alcohol = /wine|bar tab|beer/i.test(description);
    let decision;
    if (category === 'entertainment' || alcohol) decision = 'reject';
    else {
      const limit = limits[category][high.includes(city) ? 1 : 0];
      const over = usd > limit;
      const noReceipt = usd > 75 && !receipt;
      decision = over || noReceipt ? 'needs_approval' : 'approve';
    }
    return {
      id: `expense-${String(i + 1).padStart(3, '0')}`,
      input: { policy_text: policy, fx_to_usd: fx, expense: { category, city, amount, currency, receipt_attached: receipt, description } },
      gold: { decision },
      facts: { usd: Math.round(usd * 100) / 100 },
    };
  });
  out('expense-review', 'Approve, send for manager approval, or reject one expense line under a written policy with limits in USD, foreign currency converted at the given rates. Alcohol and entertainment are rejected.', cases);
}
