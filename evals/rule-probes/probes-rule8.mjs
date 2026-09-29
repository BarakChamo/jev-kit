// Rule 8, harder: when does asking Jev to compare break? Simple stated numbers compared perfectly
// (probes.mjs). Here the comparison needs a conversion, a computed limit, distance, or mixed units.
import { writeFileSync } from 'node:fs';
import { evaluate } from '../../plugin/skills/jev-eval/scripts/jev-run.mjs';

const opts = (xs) => Object.fromEntries(xs.map((x) => [String(x), null]));
const yes = (a) => a.noul > 0.5;
const conf = (a) => (a.type === 'noul' ? Math.abs(a.noul - 0.5) * 2 : a.probabilities?.[a.choice] ?? a.confidence);
const pad = 'Routine update: the team reviewed the backlog, closed stale tickets and scheduled the next planning session. '.repeat(120);

const P = [
  {
    domain: 'unit conversion (g vs kg)',
    items: Array.from({ length: 12 }, (_, i) => {
      const limitKg = [2, 5, 10][i % 3];
      const grams = limitKg * 1000 + [-400, -50, 50, 600][i % 4];
      return { state: { limit: `Carry-on items may weigh at most ${limitKg} kg.`, item: `The item weighs ${grams.toLocaleString('en-US')} g.` }, truth: grams <= limitKg * 1000, v: grams, l: limitKg * 1000 };
    }),
    unit: 'grams',
  },
  {
    domain: 'computed limit',
    items: Array.from({ length: 12 }, (_, i) => {
      const contract = [10000, 40000, 80000][i % 3];
      const cap = Math.max(500, contract * 0.02);
      const amt = cap + [-120, -10, 15, 300][i % 4];
      return { state: { limit: `A single expense may not exceed the greater of $500 or 2% of the contract value. The contract value is $${contract.toLocaleString('en-US')}.`, item: `The expense is $${amt.toLocaleString('en-US')}.` }, truth: amt <= cap, v: amt, l: cap };
    }),
    unit: 'US dollars',
  },
  {
    domain: 'distance (3k tokens apart)',
    items: Array.from({ length: 12 }, (_, i) => {
      const cap = [300, 750, 1200][i % 3];
      const amt = cap + [-60, -5, 5, 90][i % 4];
      return { state: { limit: `Travel booked without approval is capped at $${cap}.`, notes: pad, item: `The booking total is $${amt}.` }, truth: amt <= cap, v: amt, l: cap };
    }),
    unit: 'US dollars',
  },
  {
    domain: 'mixed periods (months vs days)',
    items: Array.from({ length: 12 }, (_, i) => {
      const months = [1, 2, 3][i % 3];
      const days = months * 30 + [-12, -2, 3, 20][i % 4];
      return { state: { limit: `Notice of at least ${months} month${months > 1 ? 's' : ''} is required.`, item: `Notice was given ${days} days before the end of the term.` }, truth: days >= months * 30, v: days, l: months * 30 };
    }),
    unit: 'days (one month = 30 days)',
  },
];

const out = [];
for (const p of P) {
  const vals = [...new Set(p.items.flatMap((x) => [x.v, x.l]))].sort((a, b) => a - b);
  const ge = p.domain.startsWith('mixed');
  const variants = {
    'direct comparison (warned)': {
      questions: () => ({ q: { type: 'noul', instructions: ge ? 'Does the notice described in `item` meet the requirement in `limit`?' : 'Is the amount in `item` within the limit set by `limit`?' } }),
      read: (a) => yes(a.q),
    },
    'read both, compare in code (recommended)': {
      questions: () => ({
        value: { type: 'choice', instructions: `What quantity does \`item\` state, in ${p.unit}? Convert if needed.`, criteria: opts(vals) },
        limit: { type: 'choice', instructions: `What limit does \`limit\` set, in ${p.unit}? Work it out if it is given as a rule.`, criteria: opts(vals) },
      }),
      read: (a) => (ge ? Number(a.value.choice) >= Number(a.limit.choice) : Number(a.value.choice) <= Number(a.limit.choice)),
    },
  };
  const res = {};
  for (const [name, v] of Object.entries(variants)) {
    let right = 0; const confs = [];
    for (const it of p.items) {
      const { answers } = await evaluate(it.state, v.questions(it));
      if (v.read(answers, it) === it.truth) right++;
      confs.push(Math.min(...Object.values(answers).map(conf)));
    }
    res[name] = { right, n: p.items.length, decisiveness: confs.reduce((a, b) => a + b, 0) / confs.length };
  }
  out.push({ rule: 8, domain: p.domain, results: res });
  console.log(`rule 8 · ${p.domain.padEnd(28)} ` + Object.entries(res).map(([k, r]) => `${k}: ${r.right}/${r.n} (dec ${r.decisiveness.toFixed(2)})`).join('  |  '));
}
writeFileSync(new URL('./results-rule8.json', import.meta.url), JSON.stringify(out, null, 2));
