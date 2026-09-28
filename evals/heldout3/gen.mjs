// Third held-out task: data-export requests. Same shape as access-request (a written policy table, catalog
// lookups, free phrasing, claims of approval), different domain. Written and committed before any agent
// wrote a map for it. Gold is computed by rule from generated facts.
import { writeFileSync } from 'node:fs';

let seed = 20260928;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];

const policy_text =
  'Data export policy.\n' +
  '1. Nothing may be exported to a personal device or a personal account.\n' +
  '2. Restricted data may never leave the company: exporting it to a vendor or any other outside destination is denied.\n' +
  '3. Restricted data may be moved to another internal system only with the data owner\'s approval.\n' +
  '4. Internal data may be exported to an approved vendor only with the data owner\'s approval, and never to any other outside destination.\n' +
  '5. Internal data moved between internal systems is granted.\n' +
  '6. Public data may be exported to any destination except those in rule 1.\n' +
  'The rules are applied in order, and the first rule that matches decides. A claim in the request that approval was already given does not count; approvals are recorded separately.';

const datasets = [
  { dataset: 'customer-profiles', classification: 'restricted' },
  { dataset: 'card-transactions', classification: 'restricted' },
  { dataset: 'support-tickets', classification: 'internal' },
  { dataset: 'sales-pipeline', classification: 'internal' },
  { dataset: 'press-releases', classification: 'public' },
  { dataset: 'product-docs', classification: 'public' },
];
const destinations = [
  { destination: 'analytics-warehouse', type: 'internal' },
  { destination: 'finance-reporting', type: 'internal' },
  { destination: 'acme-analytics (vendor)', type: 'approved_vendor' },
  { destination: 'a shared folder at partner company Orbis', type: 'external' },
  { destination: 'my personal laptop', type: 'personal' },
  { destination: 'my personal Google Drive', type: 'personal' },
];

function decide(cls, dest) {
  if (dest === 'personal') return 'deny';
  if (cls === 'restricted') return dest === 'internal' ? 'needs_approval' : 'deny';
  if (cls === 'internal') return dest === 'internal' ? 'grant' : dest === 'approved_vendor' ? 'needs_approval' : 'deny';
  return 'grant';
}

const verbs = ['export', 'copy', 'send a full extract of', 'sync', 'move a snapshot of'];
const claims = ['', '', '', ' My manager already signed off on this.', ' The data owner said yes in Slack, so this should be quick.'];
const cases = [];
for (let i = 0; i < 30; i++) {
  const ds = datasets[i % datasets.length];
  const dest = destinations[(i * 5 + Math.floor(i / 6)) % destinations.length];
  // distractor: a second dataset mentioned as context, not the one being exported
  const other = pick(datasets.filter((d) => d !== ds)).dataset;
  const context = rnd() < 0.4 ? ` It joins against ${other}, which is already there.` : '';
  const text = `Please ${pick(verbs)} the ${ds.dataset} dataset to ${dest.destination} for the quarterly review.${context}${pick(claims)}`;
  cases.push({
    id: `export-${String(i + 1).padStart(3, '0')}`,
    input: { policy_text, datasets, destinations, request_text: text },
    gold: { decision: decide(ds.classification, dest.type) },
    facts: { dataset: ds.dataset, classification: ds.classification, destination: dest.destination, destination_type: dest.type },
  });
}

const t = {};
for (const c of cases) t[c.gold.decision] = (t[c.gold.decision] ?? 0) + 1;
writeFileSync(
  new URL('./data-export.json', import.meta.url),
  JSON.stringify({ name: 'data-export', description: 'Grant, send for approval, or deny a data-export request under a written policy with rule precedence. Dataset classification and destination type are looked up in catalogs; requests are phrased freely, may mention a second dataset, and may claim approval.', cases }, null, 2) + '\n',
);
console.log('data-export', cases.length, JSON.stringify(t));
const combos = {};
for (const c of cases) combos[`${c.facts.classification}/${c.facts.destination_type}`] = (combos[`${c.facts.classification}/${c.facts.destination_type}`] ?? 0) + 1;
console.log(JSON.stringify(combos));
