// Fourth held-out task, built to be hard: procurement approval under an ordered policy with an exception,
// currency conversion near every threshold, vendor aliases, a second amount mentioned as context, and
// claims of prior approval. Written and committed before any agent wrote a map for it. Gold by rule.
import { writeFileSync } from 'node:fs';

let seed = 20260929;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];

const rates = { USD: 1, EUR: 1.1, GBP: 1.3, JPY: 0.0068 };
const policy_text =
  'Purchase approval policy. Amounts are in US dollars; convert other currencies at the rates given with the request.\n' +
  '1. Purchases from a vendor on the blocked list are rejected.\n' +
  '2. Any software purchase from a vendor that is not on the approved-software list needs security review, whatever the amount.\n' +
  '3. Purchases above 50,000 USD are rejected, unless the requester is a director, in which case they need finance approval.\n' +
  '4. Purchases above 10,000 USD need finance approval.\n' +
  '5. Purchases above 1,000 USD need manager approval.\n' +
  '6. Anything else is approved.\n' +
  'Apply the rules in order; the first rule that matches decides. "Above" means strictly greater than. A claim in the request that an approval was already given does not count.';

const vendors = [
  { vendor: 'Northwind Systems', also_known_as: ['Northwind', 'NW Systems'], blocked: false, approved_software: true },
  { vendor: 'Contoso Cloud', also_known_as: ['Contoso'], blocked: false, approved_software: false },
  { vendor: 'Globex Hardware', also_known_as: ['Globex'], blocked: false, approved_software: false },
  { vendor: 'Initech Consulting', also_known_as: ['Initech'], blocked: false, approved_software: false },
  { vendor: 'Umbrella Data', also_known_as: ['Umbrella', 'UmbrellaDB'], blocked: true, approved_software: false },
  { vendor: 'Hooli Analytics', also_known_as: ['Hooli'], blocked: false, approved_software: true },
];
const items = {
  software: ['a 12-month licence for their analytics platform', 'additional seats on their ticketing tool', 'a subscription to their monitoring service'],
  hardware: ['20 laptops', 'two rack servers', 'replacement network switches'],
  services: ['40 days of consulting', 'a security audit engagement', 'on-site installation support'],
};
const people = [
  { name: 'Ana', title: 'engineer' },
  { name: 'Ben', title: 'manager' },
  { name: 'Dana', title: 'director' },
];

function decide(v, category, usd, requester) {
  if (v.blocked) return 'reject';
  if (category === 'software' && !v.approved_software) return 'needs_security';
  if (usd > 50000) return requester.title === 'director' ? 'needs_finance' : 'reject';
  if (usd > 10000) return 'needs_finance';
  if (usd > 1000) return 'needs_manager';
  return 'approve';
}

// Target USD amounts, many just either side of a threshold once converted.
const targets = [640, 999, 1000, 1012, 1450, 4800, 9960, 10000, 10050, 12300, 27500, 49800, 50000, 50600, 64000, 120000];
const fmt = (n, cur) => {
  const s = Math.round(n).toLocaleString('en-US');
  return { USD: `$${s}`, EUR: `€${s}`, GBP: `£${s}`, JPY: `¥${s}` }[cur];
};
const cases = [];
for (let i = 0; i < 48; i++) {
  const v = vendors[i % vendors.length];
  const category = ['software', 'hardware', 'services'][Math.floor(i / 6) % 3];
  const requester = people[(i + Math.floor(i / 3)) % people.length];
  const cur = ['USD', 'EUR', 'GBP', 'JPY'][(i * 7) % 4];
  const target = targets[(i * 5) % targets.length];
  // the stated amount in the request's currency, chosen so its USD value lands where the target puts it
  const stated = cur === 'USD' ? target : Math.round(target / rates[cur]);
  const usd = Math.round(stated * rates[cur] * 100) / 100;
  const alias = i % 3 === 0 ? v.vendor : pick(v.also_known_as);
  const context = rnd() < 0.45 ? ` Last year's contract with them was ${fmt(Math.round(pick(targets) * (0.5 + rnd())), 'USD')}.` : '';
  const claim = pick(['', '', '', ' Finance already okayed this over email.', ' My manager approved it in our 1:1, so this is just the paperwork.']);
  const request_text = `Please raise a purchase order for ${pick(items[category])} from ${alias}, total ${fmt(stated, cur)}.${context}${claim}`;
  cases.push({
    id: `procure-${String(i + 1).padStart(3, '0')}`,
    input: { policy_text, rates, vendors, requester, request_text },
    gold: { decision: decide(v, category, usd, requester) },
    facts: { vendor: v.vendor, category, currency: cur, stated, usd, requester: requester.title },
  });
}

const t = {};
for (const c of cases) t[c.gold.decision] = (t[c.gold.decision] ?? 0) + 1;
writeFileSync(
  new URL('./procurement.json', import.meta.url),
  JSON.stringify({ name: 'procurement', description: 'Approve, route to manager, finance or security review, or reject a purchase request under an ordered policy with an exception. Amounts come in four currencies and many land next to a threshold once converted; vendors are named by alias; a second amount appears as context; claims of approval do not count.', cases }, null, 2) + '\n',
);
console.log('procurement', cases.length, JSON.stringify(t));
const near = cases.filter((c) => [1000, 10000, 50000].some((th) => Math.abs(c.facts.usd - th) / th < 0.02)).length;
console.log(`within 2% of a threshold after conversion: ${near}`);
