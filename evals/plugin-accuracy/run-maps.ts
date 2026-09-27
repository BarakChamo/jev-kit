// Grade agent-written question maps by accuracy on a labelled suite.
//   node --env-file-if-exists=../../../.env.local --import tsx run-maps.ts <task> <map-dir>... [--mock] [--out results.json]
// --mock answers every question with a deterministic fake, to prove each adapter runs end to end
// before any gateway call is spent.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// @ts-expect-error plain ESM
import { evaluate } from '../../../plugin/skills/jev-eval/scripts/jev-run.mjs';

const argv = process.argv.slice(2);
const task = argv[0]!;
const mock = argv.includes('--mock');
const outIdx = argv.indexOf('--out');
const out = outIdx >= 0 ? argv[outIdx + 1] : undefined;
const dirs = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--out');
const cases = JSON.parse(readFileSync(new URL(`./${task}.cases.json`, import.meta.url), 'utf8'));

function fake(q: any, seed: number): any {
  const r = ((seed * 9301 + 49297) % 233280) / 233280;
  if (q.type === 'noul') return { type: 'noul', noul: r };
  if (q.type === 'choice') {
    const opts = Object.keys(q.criteria);
    const probs = Object.fromEntries(opts.map((o, i) => [o, i === Math.floor(r * opts.length) ? 0.7 : 0.3 / (opts.length - 1)]));
    const choice = opts[Math.floor(r * opts.length)]!;
    return { type: 'choice', choice, confidence: 0.7, probabilities: probs };
  }
  const levels = q.criteria.length;
  const idx = Math.floor(r * levels);
  return { type: 'score', score: Math.min(levels - 1, idx + 0.3), confidence: 0.6, legend: Object.fromEntries(q.criteria.map((c: string, i: number) => [String(i), c])), probabilities: Object.fromEntries(q.criteria.map((_: string, i: number) => [String(i), i === idx ? 0.6 : 0.4 / (levels - 1)])) };
}

function grade(pred: any, gold: any): 'right' | 'wrong' | 'abstain' {
  if (task === 'culprit') {
    const lines: number[] = pred?.culprit_lines ?? [];
    if (!lines.length) return 'abstain';
    return gold.culprit_lines.includes(lines[0]) ? 'right' : 'wrong';
  }
  const key = Object.keys(gold)[0]!;
  if (pred?.[key] === 'abstain') return 'abstain';
  return pred?.[key] === gold[key] ? 'right' : 'wrong';
}

const report: any[] = [];
for (const dir of dirs) {
  const adapter = await import(pathToFileURL(resolve(dir, 'adapter.ts')).href);
  const rows: any[] = [];
  for (const [i, c] of cases.entries()) {
    try {
      // Adapters were written by different agents: some take the case's input, some the whole case.
      // Pass an object that satisfies both conventions.
      const arg = { ...c.input, input: c.input, id: c.id };
      const state = await adapter.buildState(arg);
      const questions = await adapter.questions(arg);
      const raw = mock
        ? Object.fromEntries(Object.entries(questions).map(([k, q], j) => [k, fake(q, i * 31 + j)]))
        : Object.keys(questions ?? {}).length === 0
          ? {} // the map decided in code without asking Jev anything
          : (await evaluate(state, questions)).answers;
      // Scores arrive fractional (1.48). Adapters index the legend inconsistently, so every map gets
      // the score rounded to its nearest level, as the study graded it; the raw value rides along.
      const answers = Object.fromEntries(
        Object.entries(raw as Record<string, any>).map(([k, a]) => [k, a?.type === 'score' ? { ...a, score: Math.round(a.score), raw_score: a.score } : a]),
      );
      const pred = await adapter.decide(arg, answers);
      const g = grade(pred, c.gold);
      const top3 = task === 'culprit' ? (pred?.culprit_lines ?? []).slice(0, 3).some((l: number) => c.gold.culprit_lines.includes(l)) : undefined;
      rows.push({ id: c.id, gold: c.gold, pred, grade: g, top3, answers: mock ? undefined : raw });
    } catch (err: any) {
      rows.push({ id: c.id, gold: c.gold, error: String(err?.message ?? err).slice(0, 300), grade: 'error' });
    }
  }
  const n = rows.length;
  const count = (g: string) => rows.filter((r) => r.grade === g).length;
  const summary = {
    map: basename(dir),
    n,
    right: count('right'),
    wrong: count('wrong'),
    abstain: count('abstain'),
    errors: count('error'),
    accuracy_all: count('right') / n,
    accuracy_decided: count('right') / Math.max(1, count('right') + count('wrong')),
    coverage: (count('right') + count('wrong')) / n,
    ...(task === 'culprit' ? { top3_recall: rows.filter((r) => r.top3).length / n } : {}),
  };
  report.push({ ...summary, rows });
  console.log(JSON.stringify(summary));
}
if (out) writeFileSync(out, JSON.stringify(report, null, 2));
