// Grade every held-out map with the plugin's own runner, through the standard interface: no adapters.
//   NODE_USE_ENV_PROXY=1 node --env-file=../../.env.local grade.mjs maps/<run>... [--out results.json] [--mock]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runSuite } from '../../plugin/skills/jev-eval/scripts/jev-run.mjs';

const argv = process.argv.slice(2);
const mock = argv.includes('--mock');
const hard = argv.includes('--hard');
const outPath = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : undefined;
const dirs = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out');

// a fake Jev for --mock: plausible shapes, meaningless values
const fakeFetch = async (_u, init) => {
  const { questions } = JSON.parse(init.body);
  const answers = Object.fromEntries(Object.entries(questions).map(([k, q]) => {
    if (q.type === 'noul') return [k, { type: 'noul', noul: 0.8 }];
    if (q.type === 'choice') { const o = Object.keys(q.criteria)[0]; return [k, { type: 'choice', choice: o, confidence: 0.9, probabilities: { [o]: 0.9 } }]; }
    return [k, { type: 'score', score: 0.4, confidence: 0.6, legend: Object.fromEntries(q.criteria.map((c, i) => [String(i), c])), probabilities: { 0: 0.6 } }];
  }));
  return { ok: true, status: 200, headers: new Map(), json: async () => ({ answers, usage: { input_tokens: 1 } }), text: async () => '' };
};

const results = [];
for (const dir of dirs) {
  const name = basename(dir);
  const task = name.split('-').slice(0, 2).join('-');
  const suite = JSON.parse(readFileSync(new URL(`./${task}${hard ? '.hard' : ''}.json`, import.meta.url), 'utf8'));
  const file = resolve(dir, 'map.mjs');
  let map;
  try {
    if (!existsSync(file)) throw new Error('no map.mjs');
    map = await import(pathToFileURL(file).href);
    for (const f of ['buildState', 'questions', 'decide']) if (typeof map[f] !== 'function') throw new Error(`missing export ${f}`);
  } catch (err) {
    results.push({ map: name, task, loadError: String(err.message ?? err) });
    console.log(JSON.stringify({ map: name, loadError: String(err.message ?? err) }));
    continue;
  }
  const rows = await runSuite(suite, { map, concurrency: Number(process.env.CONCURRENCY ?? 3), ...(mock ? { fetchImpl: fakeFetch, key: 'mock' } : {}) });
  const n = rows.length;
  const caseGrade = (r) => (r.error ? 'error' : Object.values(r.grades ?? {}).includes('wrong') ? 'wrong' : Object.values(r.grades ?? {}).every((g) => g === 'right') ? 'right' : 'abstain');
  const g = rows.map(caseGrade);
  const count = (x) => g.filter((y) => y === x).length;
  const s = { map: name, task, n, right: count('right'), wrong: count('wrong'), abstain: count('abstain'), errors: count('error'), accuracy: count('right') / n, wrongRate: count('wrong') / n, coverage: (count('right') + count('wrong')) / n };
  if (task === 'reply-exposure') {
    const keep = rows.map((r, i) => [r, g[i]]).filter(([r]) => r.caseId !== 'exposure-020');
    s.accuracy_undisputed = keep.filter(([, x]) => x === 'right').length / keep.length;
    s.wrongRate_undisputed = keep.filter(([, x]) => x === 'wrong').length / keep.length;
  }
  results.push({ ...s, rows: mock ? undefined : rows, firstError: rows.find((r) => r.error)?.error });
  console.log(JSON.stringify(s));
}
if (outPath) writeFileSync(outPath, JSON.stringify(results, null, 2));
