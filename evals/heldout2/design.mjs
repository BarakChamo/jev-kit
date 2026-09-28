// Design-only analysis of API-authored maps: what each map asks, read without calling Jev.
// Usage: node design.mjs [maps-api|maps|maps-v4]. Loads each map, calls questions(input) on the first case of its suite, and inspects decide()'s source.
// This says nothing about accuracy; it says which of the skill's rules a map follows.
import { readdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { TASKS } from './prompt.mjs';

const sub = process.argv[2] ?? 'maps-api';
const dir = new URL(`./${sub}/`, import.meta.url).pathname;
const rows = [];
for (const n of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  const task = Object.keys(TASKS).find((t) => n.startsWith(t + '-'));
  const [arm, rep] = n.slice(task.length + 1).split('-');
  const author = n.slice(task.length + arm.length + rep.length + 3);
  const f = `${dir}${n}/map.mjs`;
  const row = { task, arm, author, map: existsSync(f) };
  if (row.map) {
    try {
      const suite = JSON.parse(readFileSync(new URL(TASKS[task].suite ?? `./${task}.json`, import.meta.url), 'utf8'));
      const m = await import(pathToFileURL(f).href);
      const input = suite.cases[0].input;
      const qs = await m.questions(input);
      const q = Object.values(qs);
      const text = q.map((x) => x.instructions ?? '').join(' \n ');
      const src = readFileSync(f, 'utf8');
      const decide = String(m.decide);
      row.questions = q.length;
      row.types = [...new Set(q.map((x) => x.type))].sort().join('+');
      row.maxOptions = Math.max(0, ...q.filter((x) => x.type === 'choice').map((x) => Object.keys(x.criteria ?? {}).length));
      // a gate: reads a choice's probabilities, or holds a noul against a threshold other than 0.5
      row.gatesOnProbabilities = /probabilities/.test(src) || /noul[^;\n]*(>=|<=|>|<)\s*(0\.[0-46-9]\d*|0\.5\d+|[A-Z_]{3,})/.test(src);
      row.usesScalarConfidence = /\.confidence\b/.test(decide);
      row.abstains = /abstain/.test(src);
      if (task === 'sla-breach') {
        row.asksBreachDirectly = /breach|within (the|its) (SLA|target|deadline|response)|exceed|on time|late\b|violat|miss(ed)? the/i.test(text);
        row.computesTimeInCode = /Date\.UTC|new Date|getTime|getUTC|setUTC/.test(src);
      }
      if (task === 'culprit') {
        const n = input.log_lines.length;
        const choice = q.find((x) => x.type === 'choice' && Object.keys(x.criteria ?? {}).length >= n * 0.9);
        row.oneChoiceOverAllLines = !!choice;
        row.nounPerLine = q.filter((x) => x.type === 'noul').length >= n * 0.5;
        row.preFilter = !choice && !row.nounPerLine;
      }
      if (task === 'refund-eligibility') {
        // questions about the case only: a question about what `policy_text` requires is not a verdict
        const caseText = q.map((x) => x.instructions ?? '').filter((t) => !/^[^`]*`policy/i.test(t)).join(' \n ');
        row.asksEligibleDirectly = /(is|are) (the|this|these) [^?]*(eligible|refundable|returnable)|eligible for (a )?(refund|return)|entitled to (a )?(refund|return)|(does|do) [^?]*qualif(y|ies) for (a )?(refund|return)/i.test(caseText);
        row.computesDaysInCode = /Date\.UTC|new Date|getTime|86400000|864e5/.test(src);
        row.asksIncludesExcluded = /includ|any item|final sale|gift card/i.test(text);
      }
    } catch (e) { row.loadError = String(e.message).slice(0, 120); }
  }
  rows.push(row);
}
writeFileSync(new URL(`./design.${sub}.json`, import.meta.url), JSON.stringify(rows, null, 2));

const pct = (xs, k) => { const v = xs.filter((r) => r[k] !== undefined); return v.length ? `${v.filter((r) => r[k]).length}/${v.length}` : '—'; };
const feats = {
  'sla-breach': ['asksBreachDirectly', 'computesTimeInCode', 'gatesOnProbabilities', 'abstains'],
  'refund-eligibility': ['asksEligibleDirectly', 'computesDaysInCode', 'gatesOnProbabilities', 'abstains'],
  culprit: ['oneChoiceOverAllLines', 'nounPerLine', 'preFilter', 'gatesOnProbabilities'],
};
let md = '';
for (const [task, ks] of Object.entries(feats)) {
  md += `\n### ${task}\n\n| arm | maps loaded | ${ks.join(' | ')} |\n| --- | ---: |${ks.map(() => ' ---: |').join('')}\n`;
  for (const arm of ['base', 'plugin']) {
    const xs = rows.filter((r) => r.task === task && r.arm === arm && r.map && !r.loadError);
    md += `| ${arm === 'base' ? 'no plugin' : 'plugin'} | ${xs.length} | ${ks.map((k) => pct(xs, k)).join(' | ')} |\n`;
  }
}
writeFileSync(new URL(`./design.${sub}.md`, import.meta.url), md.trim() + '\n');
console.log(md);
console.log('load errors:', rows.filter((r) => r.loadError).map((r) => `${r.task}-${r.arm}-${r.author}: ${r.loadError}`));
