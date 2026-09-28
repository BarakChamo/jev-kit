// Grade maps through the plugin's own runner (jev-run's runSuite with --map semantics), no adapters.
//   node grade.mjs <map dirs...> [--out results.json]      (CONCURRENCY env, default 2)
// With several dirs, each map is graded in its own child process (MAP_PARALLEL at a time, default 3) with
// a time limit (MAP_TIMEOUT_S, default 900): a map that loops forever blocks nothing else and is recorded
// as a failure ("hung"), like a map that fails to load.
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runSuite } from '../../../plugin/skills/jev-eval/scripts/jev-run.mjs';
import { TASKS } from './prompt.mjs';

const argv = process.argv.slice(2);
const outPath = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : undefined;
const dirs = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out');
const results = [];
const meta = (dir) => {
  const name = basename(dir);
  const task = Object.keys(TASKS).sort((a, b) => b.length - a.length).find((t) => name.startsWith(t + '-'));
  const [arm, rep, ...rest] = name.slice(task.length + 1).split('-');
  return { map: name, task, arm, rep: Number(rep), author: rest.join('-') };
};
if (dirs.length > 1 && !process.env.GRADE_CHILD) {
  const tmp = mkdtempSync(join(tmpdir(), 'grade-'));
  const limit = Number(process.env.MAP_TIMEOUT_S ?? 900) * 1000;
  const one = (dir, i) => new Promise((done) => {
    const out = join(tmp, `${i}.json`);
    const child = spawn(process.execPath, [...process.execArgv, new URL(import.meta.url).pathname, dir, '--out', out], { env: { ...process.env, GRADE_CHILD: '1' }, stdio: ['ignore', 'inherit', 'inherit'] });
    const timer = setTimeout(() => child.kill('SIGKILL'), limit);
    child.on('exit', () => {
      clearTimeout(timer);
      if (existsSync(out)) results[i] = JSON.parse(readFileSync(out, 'utf8'))[0];
      else { results[i] = { ...meta(dir), loadError: `hung: no result within ${limit / 1000} s` }; console.log(JSON.stringify(results[i])); }
      done();
    });
  });
  let next = 0;
  await Promise.all(Array.from({ length: Number(process.env.MAP_PARALLEL ?? 3) }, async () => { while (next < dirs.length) { const i = next++; await one(dirs[i], i); } }));
  if (outPath) writeFileSync(outPath, JSON.stringify(results, null, 2));
  process.exit(0);
}
for (const dir of dirs) {
  const name = basename(dir);
  const task = Object.keys(TASKS).sort((a, b) => b.length - a.length).find((t) => name.startsWith(t + '-'));
  const [arm, rep, ...rest] = name.slice(task.length + 1).split('-');
  const author = rest.join('-');
  const suite = JSON.parse(readFileSync(new URL(TASKS[task].suite ?? `./${task}.json`, import.meta.url), 'utf8'));
  const base = { map: name, task, arm, rep: Number(rep), author };
  let map;
  try {
    const file = resolve(dir, 'map.mjs');
    if (!existsSync(file)) throw new Error('no map.mjs');
    map = await import(pathToFileURL(file).href + `?t=${Date.now()}`);
    for (const f of ['buildState', 'questions', 'decide']) if (typeof map[f] !== 'function') throw new Error(`missing export ${f}`);
  } catch (err) {
    results.push({ ...base, loadError: String(err.message ?? err) });
    console.log(JSON.stringify({ ...base, loadError: String(err.message ?? err).slice(0, 160) }));
    continue;
  }
  const rows = await runSuite(suite, { map, concurrency: Number(process.env.CONCURRENCY ?? 2) });
  const g = rows.map((r) => (r.error ? 'error' : Object.values(r.grades ?? {}).includes('wrong') ? 'wrong' : Object.values(r.grades ?? {}).every((x) => x === 'right') ? 'right' : 'abstain'));
  const n = rows.length, c = (x) => g.filter((y) => y === x).length;
  const s = { ...base, n, right: c('right'), wrong: c('wrong'), abstain: c('abstain'), errors: c('error'), accuracy: c('right') / n, wrongRate: c('wrong') / n, coverage: (c('right') + c('wrong')) / n };
  results.push({ ...s, rows, firstError: rows.find((r) => r.error)?.error });
  console.log(JSON.stringify(s));
}
if (outPath) writeFileSync(outPath, JSON.stringify(results, null, 2));
