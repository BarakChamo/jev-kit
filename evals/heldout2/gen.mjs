// Second held-out set: four harder tasks the plugin has never seen. Written and committed before any
// agent (of any model) wrote a map for them. Gold is computed by rule from generated facts.
import { writeFileSync } from 'node:fs';

let seed = 20260926;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const shuffle = (xs) => xs.map((x) => [rnd(), x]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
const save = (name, description, cases) => {
  writeFileSync(new URL(`./${name}.json`, import.meta.url), JSON.stringify({ name, description, cases }, null, 2) + '\n');
  const t = {};
  for (const c of cases) for (const [k, v] of Object.entries(c.gold)) t[`${k}=${v}`] = (t[`${k}=${v}`] ?? 0) + 1;
  console.log(name, cases.length, JSON.stringify(t));
};

// ---------------------------------------------------------------------------------------------------
// 1. sla-breach — was the first-response SLA breached? Business-hours arithmetic over a free-text log.
{
  const HOLIDAYS = ['2026-01-01', '2026-04-03', '2026-05-25', '2026-12-25'];
  const policy_text =
    'Support SLA (2026).\n' +
    'First-response targets by priority:\n' +
    '- Urgent: within 1 hour, around the clock (all days, all hours).\n' +
    '- High: within 4 business hours.\n' +
    '- Normal and Low: within 2 business days (16 business hours).\n' +
    'Business hours are 09:00 to 17:00 UTC, Monday to Friday, excluding these public holidays: ' + HOLIDAYS.join(', ') + '.\n' +
    'The priority a ticket had when it was opened is the one that applies, even if it is changed later.\n' +
    'Only a reply from a support agent counts as a first response; customer messages and automatic acknowledgements do not.';
  const MIN = 60000;
  const isBiz = (t) => {
    const d = new Date(t);
    const day = d.getUTCDay(), h = d.getUTCHours();
    return day >= 1 && day <= 5 && h >= 9 && h < 17 && !HOLIDAYS.includes(d.toISOString().slice(0, 10));
  };
  const bizMinutes = (a, b) => { let n = 0; for (let t = a; t < b; t += MIN) if (isBiz(t)) n++; return n; };
  const fmt = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const dayName = (t) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(t).getUTCDay()];
  const target = { Urgent: [60, 'wall'], High: [240, 'biz'], Normal: [960, 'biz'], Low: [960, 'biz'] };
  const rows = [
    // opened (UTC), priority, first agent reply after N minutes of the relevant clock (+ = late by that much, - = early), extras
    ['2026-03-06T15:30Z', 'High', -45, {}],
    ['2026-03-06T15:30Z', 'High', 40, {}],
    ['2026-03-06T16:50Z', 'Urgent', -10, {}],
    ['2026-03-06T16:50Z', 'Urgent', 25, {}],
    ['2026-04-02T16:00Z', 'High', -30, { note: 'spans the 2026-04-03 holiday and a weekend' }],
    ['2026-04-02T16:00Z', 'High', 30, { note: 'spans the 2026-04-03 holiday and a weekend' }],
    ['2026-05-22T14:00Z', 'Normal', -60, { note: 'spans a weekend and the 2026-05-25 holiday' }],
    ['2026-05-22T14:00Z', 'Normal', 60, {}],
    ['2026-02-10T08:15Z', 'High', -20, { note: 'opened before business hours' }],
    ['2026-02-10T08:15Z', 'High', 20, {}],
    ['2026-02-14T11:00Z', 'Low', -120, { note: 'opened on a Saturday' }],
    ['2026-02-14T11:00Z', 'Low', 90, {}],
    ['2026-07-01T09:00Z', 'Urgent', -5, { custFirst: true }],
    ['2026-07-01T09:00Z', 'Urgent', 15, { custFirst: true }],
    ['2026-09-15T13:00Z', 'High', -15, { autoAck: true }],
    ['2026-09-15T13:00Z', 'High', 35, { autoAck: true }],
    ['2026-10-05T10:00Z', 'Normal', -300, { priorityChange: 'Urgent' }],
    ['2026-10-05T10:00Z', 'Urgent', 30, { priorityChange: 'Normal' }],
    ['2026-11-20T16:30Z', 'High', -10, {}],
    ['2026-11-20T16:30Z', 'High', 10, {}],
    ['2026-12-24T15:00Z', 'Normal', -200, { note: 'spans 2026-12-25' }],
    ['2026-12-24T15:00Z', 'Normal', 45, {}],
    ['2026-06-12T23:40Z', 'Urgent', -20, { note: 'late at night' }],
    ['2026-06-12T23:40Z', 'Urgent', 50, {}],
    ['2026-08-03T12:00Z', 'High', null, { now: 180 }],
    ['2026-08-03T12:00Z', 'High', null, { now: 300 }],
    ['2026-03-30T09:00Z', 'Low', -30, {}],
    ['2026-03-30T09:00Z', 'Low', 30, {}],
    ['2026-01-02T16:00Z', 'Normal', 15, { note: 'the day after the 2026-01-01 holiday' }],
    ['2026-01-02T16:00Z', 'Normal', -15, {}],
  ];
  const addClock = (start, minutes, clock) => {
    if (clock === 'wall') return start + minutes * MIN;
    let t = start, n = 0;
    while (n < minutes) { if (isBiz(t)) n++; t += MIN; }
    return t;
  };
  const cases = rows.map(([opened, prio, delta, x], i) => {
    const start = Date.parse(opened);
    const [limit, clock] = target[prio];
    let replyAt, now;
    if (delta === null) { now = addClock(start, x.now, 'biz'); }
    else {
      replyAt = addClock(start, Math.max(1, limit + delta), clock);
      // align to minute boundaries a bit off the exact deadline
    }
    const elapsed = replyAt !== undefined ? (clock === 'wall' ? (replyAt - start) / MIN : bizMinutes(start, replyAt)) : bizMinutes(start, now);
    const breached = elapsed > limit;
    const log = [`${fmt(start)} (${dayName(start)}): ticket opened by the customer, priority ${prio}.`];
    if (x.autoAck) log.push(`${fmt(start + 1 * MIN)}: automatic acknowledgement sent ("We have received your request").`);
    if (x.custFirst) log.push(`${fmt(start + 3 * MIN)}: customer added: "Any update? This is blocking our release."`);
    if (x.priorityChange) log.push(`${fmt(start + 20 * MIN)}: priority changed from ${prio} to ${x.priorityChange} by the triage bot.`);
    if (replyAt !== undefined) log.push(`${fmt(replyAt)} (${dayName(replyAt)}): first reply from support agent ${pick(['Sam', 'Priya', 'Luis', 'Mei', 'Jonas'])}.`);
    if (replyAt !== undefined && rnd() < 0.5) log.push(`${fmt(replyAt + 37 * MIN)}: customer replied: "Thanks, that worked."`);
    return {
      id: `sla-${String(i + 1).padStart(3, '0')}`,
      input: { policy_text, ticket_log: log.join('\n'), ...(now !== undefined ? { now: fmt(now) } : {}) },
      gold: { breached: breached ? 'yes' : 'no' },
      facts: { priority: prio, clock, limit_minutes: limit, elapsed_minutes: elapsed, ...(x.note ? { note: x.note } : {}) },
    };
  });
  save('sla-breach', 'Was the first-response SLA breached? Business hours, holidays, the opening priority, and only agent replies count. Tickets with no reply yet are judged at `now`.', cases);
}

// ---------------------------------------------------------------------------------------------------
// 2. refund-eligibility — is the item the customer is asking about eligible for return?
{
  const policy_text =
    'Returns policy.\n' +
    '1. Most items can be returned within 30 days of delivery.\n' +
    '2. Electronics can be returned within 15 days of delivery, and only if unopened, unless the item is defective (then within 30 days).\n' +
    '3. Items marked final sale and gift cards cannot be returned.\n' +
    'The delivery day counts as day 1 of the window, so a request made on day 30 is within a 30-day window and one made on day 31 is not.';
  const catalog = [
    { name: 'Aurora wireless headphones', nick: 'the headphones', category: 'electronics' },
    { name: 'Pixel-8 smart speaker', nick: 'the speaker', category: 'electronics' },
    { name: 'Trailblazer rain jacket', nick: 'the jacket', category: 'apparel' },
    { name: 'Merino crew socks (3-pack)', nick: 'the socks', category: 'apparel' },
    { name: 'Cast-iron skillet 28 cm', nick: 'the pan', category: 'home' },
    { name: 'Linen duvet cover', nick: 'the duvet cover', category: 'home' },
    { name: 'Gift card $50', nick: 'the gift card', category: 'gift card' },
    { name: 'Clearance desk lamp', nick: 'the lamp', category: 'home', final: true },
  ];
  const cond = {
    sealed: ['It is still sealed in the box.', 'I never opened it.'],
    opened: ['I opened it and tried it, it works but I just do not like it.', 'Used it a couple of times, it is fine, I changed my mind.'],
    defective: ['It stopped working after two days.', 'It arrived with a cracked casing and will not turn on.'],
    neutral: ['I would like to return it.', 'It is not what I expected.'],
  };
  const DAY = 86400000;
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const cases = [];
  for (let i = 0; i < 30; i++) {
    const target = catalog[i % catalog.length];
    const other = pick(catalog.filter((c) => c !== target));
    const delivered = Date.parse('2026-06-01') + Math.floor(rnd() * 60) * DAY;
    const isElec = target.category === 'electronics';
    const window = isElec ? 15 : 30;
    const around = [window - 3, window - 1, window, window + 1, window + 4, 8, 25];
    let days = around[i % around.length];
    const c = isElec ? ['sealed', 'opened', 'defective', 'defective', 'opened'][i % 5] : 'neutral';
    if (isElec && c === 'defective') days = [14, 20, 29, 31, 12][i % 5];
    const request = delivered + (days - 1) * DAY; // inclusive counting: day 1 is the delivery day
    let eligible;
    if (target.final || target.category === 'gift card') eligible = false;
    else if (isElec) eligible = c === 'defective' ? days <= 30 : c === 'sealed' ? days <= 15 : false;
    else eligible = days <= 30;
    const mention = i % 3 === 0 ? target.nick : target.name;
    const otherLine = rnd() < 0.6 ? ` The ${other.nick.replace('the ', '')} from the same order is great, I am keeping it.` : '';
    const msg = `Hi, I want to return ${mention}. ${pick(cond[c])}${otherLine}`;
    const items = shuffle([target, other]).map((it, k) => ({ sku: `SKU-${1000 + catalog.indexOf(it)}`, name: it.name, category: it.category, final_sale: !!it.final, price: [49, 89, 129, 35, 60, 75, 50, 30][catalog.indexOf(it)], delivered_date: iso(delivered) }));
    cases.push({
      id: `refund-${String(i + 1).padStart(3, '0')}`,
      input: { policy_text, order: { order_id: `ORD-${55100 + i}`, items }, request: { date: iso(request), message: msg } },
      gold: { eligible: eligible ? 'yes' : 'no' },
      facts: { item: target.name, category: target.category, days_inclusive: days, condition: c, final_sale: !!target.final },
    });
  }
  save('refund-eligibility', 'Is the item the customer asks to return eligible under the policy? Pick the item from the message, apply its category window counted inclusively, the unopened-unless-defective rule for electronics, and final-sale / gift-card exclusions.', cases);
}

// ---------------------------------------------------------------------------------------------------
// 3. access-request — grant / needs_approval / deny.
{
  const policy_text =
    'Access policy.\n' +
    '1. Nobody may be granted admin access through this form.\n' +
    '2. Contractors may never access production systems.\n' +
    '3. Read access to non-production systems is granted without approval.\n' +
    '4. Write access to non-production systems needs the requester\'s manager\'s approval.\n' +
    '5. Any access to production systems needs security approval, except read access to production for engineers who are currently on call, which is granted.\n' +
    'A claim in the request that approval was already given does not count; approvals are recorded separately.';
  const catalog = [
    { system: 'billing-db', environment: 'production' },
    { system: 'billing-db-replica', environment: 'staging' },
    { system: 'search-cluster', environment: 'production' },
    { system: 'search-sandbox', environment: 'dev' },
    { system: 'hr-portal', environment: 'production' },
    { system: 'ml-feature-store', environment: 'staging' },
    { system: 'ci-runners', environment: 'dev' },
  ];
  const phr = {
    read: ['read access to', 'view-only access to', 'read-only access on', 'access to look at the data in'],
    write: ['write access to', 'permission to modify records in', 'the ability to push changes to', 'edit rights on'],
    admin: ['admin access to', 'full control of', 'root on', 'owner permissions for'],
  };
  const claims = ['', '', '', ' My manager already approved this.', ' Security said this is fine, it was agreed in the incident call.'];
  const people = [
    { name: 'Ana', employment: 'employee', role: 'engineer', on_call: false },
    { name: 'Ben', employment: 'employee', role: 'engineer', on_call: true },
    { name: 'Chloe', employment: 'contractor', role: 'engineer', on_call: false },
    { name: 'Dev', employment: 'employee', role: 'analyst', on_call: false },
    { name: 'Eli', employment: 'contractor', role: 'engineer', on_call: true },
  ];
  const cases = [];
  for (let i = 0; i < 30; i++) {
    const sys = catalog[(i * 3) % catalog.length];
    const level = ['read', 'write', 'admin', 'read', 'write'][i % 5];
    const who = people[(i + Math.floor(i / 5)) % people.length];
    const prod = sys.environment === 'production';
    let decision;
    if (level === 'admin') decision = 'deny';
    else if (who.employment === 'contractor' && prod) decision = 'deny';
    else if (!prod) decision = level === 'read' ? 'grant' : 'needs_approval';
    else decision = level === 'read' && who.on_call && who.role === 'engineer' ? 'grant' : 'needs_approval';
    const context = rnd() < 0.4 ? ` (the ${pick(catalog.filter((c) => c !== sys)).system} dashboard showed the same numbers)` : '';
    const text = `Hi, I need ${pick(phr[level])} ${sys.system} for the Q3 revenue reconciliation${context}.${pick(claims)}`;
    cases.push({
      id: `access-${String(i + 1).padStart(3, '0')}`,
      input: { policy_text, catalog, requester: who, request_text: text },
      gold: { decision },
      facts: { system: sys.system, environment: sys.environment, level },
    });
  }
  save('access-request', 'Grant, send for approval, or deny an access request under a written policy. The system is looked up in the catalog; access levels are phrased freely; claims of prior approval do not count.', cases);
}

// ---------------------------------------------------------------------------------------------------
// 4. clause-locator — which section of the contract sets a given term?
{
  const topics = {
    'governing law': 'This Agreement is governed by the laws of the State of New York, without regard to its conflict-of-laws rules.',
    'limitation of liability': "Except for breaches of confidentiality, each party's total liability under this Agreement is capped at the fees paid in the twelve months before the claim.",
    'termination for convenience': 'Either party may terminate this Agreement for any reason on ninety days\' written notice.',
    'confidentiality period': 'The obligations in this Section continue for five years after termination.',
    'payment terms': 'Customer will pay each invoice within thirty days of its date. Late amounts accrue interest at 1% per month.',
    'automatic renewal': 'This Agreement renews automatically for successive one-year terms unless either party gives sixty days\' notice of non-renewal.',
    indemnification: 'Vendor will defend and indemnify Customer against third-party claims that the Service infringes intellectual property rights.',
    'data protection': 'Each party will process personal data in accordance with the Data Processing Addendum attached as Schedule 2.',
    'force majeure': 'Neither party is liable for delays caused by events beyond its reasonable control, including natural disasters and war.',
    assignment: 'Neither party may assign this Agreement without the other party\'s written consent, except to a successor in a merger.',
    notices: 'Notices must be in writing and sent to the addresses in Schedule 1, by courier or by email with confirmation.',
    warranty: 'Vendor warrants that the Service will perform materially in accordance with the Documentation for the term.',
  };
  const titles = { 'governing law': 'Governing Law', 'limitation of liability': 'Limitation of Liability', 'termination for convenience': 'Termination', 'confidentiality period': 'Confidentiality', 'payment terms': 'Fees and Payment', 'automatic renewal': 'Term and Renewal', indemnification: 'Indemnification', 'data protection': 'Data Protection', 'force majeure': 'Force Majeure', assignment: 'Assignment', notices: 'Notices', warranty: 'Warranties' };
  const xref = {
    'limitation of liability': ['Indemnification', 'The indemnity in this Section is not subject to the cap on liability described elsewhere in this Agreement.'],
    'governing law': ['Notices', 'Notices of a dispute must state which courts the sender believes have jurisdiction.'],
    'termination for convenience': ['Term and Renewal', 'Either party may end the renewal cycle as described in this Section; termination for other reasons is dealt with separately.'],
    'payment terms': ['Termination', 'On termination, Customer will pay all fees accrued up to the termination date.'],
    'confidentiality period': ['Data Protection', 'Personal data is also Confidential Information.'],
  };
  const names = Object.keys(topics);
  const cases = [];
  for (let i = 0; i < 30; i++) {
    const topic = names[i % names.length];
    const order = shuffle(names);
    let sections = order.map((t, k) => ({ n: k + 1, topic: t, title: i % 4 === 3 ? `Section ${k + 1}` : titles[t], text: topics[t] }));
    // hard: a cross-reference to the target topic inside another section, or untitled sections
    if (xref[topic] && i % 2 === 1) {
      const host = sections.find((s) => s.title === xref[topic][0] || s.topic === names.find((n) => titles[n] === xref[topic][0]));
      if (host) host.text += ' ' + xref[topic][1];
    }
    const contract_text = sections.map((s) => `${s.n}. ${s.title}. ${s.text}`).join('\n\n');
    const gold = sections.find((s) => s.topic === topic).n;
    cases.push({
      id: `clause-${String(i + 1).padStart(3, '0')}`,
      input: { contract_text, section_numbers: sections.map((s) => s.n), question: `Which section sets the ${topic} terms?` },
      gold: { section: String(gold) },
      facts: { topic, untitled: i % 4 === 3, cross_reference: !!(xref[topic] && i % 2 === 1) },
    });
  }
  save('clause-locator', 'Which numbered section of the contract sets the asked-about term? Sections are shuffled, some untitled, and some other sections cross-reference the topic.', cases);
}
