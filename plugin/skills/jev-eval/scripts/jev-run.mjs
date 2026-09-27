#!/usr/bin/env node
/**
 * jev-run — run a labelled suite through Jev and write one JSONL row per case, in the format
 * jev-audit reads. Zero dependencies; Node 18+.
 *
 *   node jev-run.mjs <suite.json> [--out results.jsonl] [--concurrency 2] [--model typesafe-ai/jev]
 *                    [--derive derive.mjs] [--pad 4000] [--pad-file filler.txt] [--check]
 *
 * Needs AI_GATEWAY_API_KEY (Vercel AI Gateway), except with --check, which validates the suite's
 * shape against the API's documented limits and makes no calls.
 *
 * Suite file:
 *   {
 *     "questions": { "<id>": { "type": "noul" | "choice" | "score", "instructions": "...", "criteria": ... } },
 *     "cases": [ { "id": "c1", "state": { ... }, "gold": { "<question or derived field>": "<label>" }, "tags": [] } ]
 *   }
 *
 * Gold labels: a Noul is graded "yes"/"no" at 0.5; a Choice by option name; a Score by the level's
 * name (the text before the first colon of its criterion, else the whole criterion).
 *
 * --derive loads a module whose default export is (answers, state) => ({ predicted, confidence }):
 * fields computed in code from the answers, graded like any other. This is how you measure
 * derive-vs-ask on the same run.
 *
 * --map loads a question map written to the standard interface (see jev-questions, "The interface a
 * map exposes"): a module exporting buildState(input), questions(input) and decide(answers, input).
 * Each case then carries `input` instead of `state`, and the suite needs no `questions`. decide()
 * returns the decision fields ({ outcome: "avoided" }, or "abstain" for a case it sends to a person),
 * which are graded against `gold` and summarised: right, wrong, abstain, coverage. Use it to compare
 * whole maps end to end, including the code that turns answers into decisions.
 *
 * --pad appends ~N tokens of filler as an extra `appendix` field, for the pad test. Run once without
 * and once with, then `jev-audit diff`. Use --pad-file with plausible material from your own domain
 * when you can: generic filler is a weaker test than realistic filler.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const BASE = 'https://ai-gateway.vercel.sh/typesafe/v1/systemone';
export const DEFAULT_MODEL = 'typesafe-ai/jev';
/** list price, USD per input token; output is free */
export const LIST_PRICE = 0.042 / 1e6;
const CHOICE_MAX = 255;

/** Structural checks against the documented API. These are validity, not quality: quality is measured. */
export function checkSuite(suite, { map = false } = {}) {
  const problems = [];
  const questions = suite?.questions ?? {};
  const ids = Object.keys(questions);
  if (ids.length === 0 && !map) problems.push('no questions');
  for (const [id, q] of Object.entries(questions)) {
    if (!q || typeof q !== 'object') { problems.push(`${id}: not an object`); continue; }
    if (!['noul', 'choice', 'score'].includes(q.type)) problems.push(`${id}: type must be noul, choice or score`);
    if (typeof q.instructions !== 'string' || !q.instructions.trim()) problems.push(`${id}: empty instructions`);
    if (q.type === 'choice') {
      const n = Object.keys(q.criteria ?? {}).length;
      if (n < 2) problems.push(`${id}: a choice needs at least two options`);
      if (n > CHOICE_MAX) problems.push(`${id}: ${n} options exceeds the ${CHOICE_MAX}-option ceiling (the API refuses, it does not truncate)`);
    }
    if (q.type === 'score' && (!Array.isArray(q.criteria) || q.criteria.length < 2)) problems.push(`${id}: a score needs at least two ordered levels`);
  }
  const cases = suite?.cases ?? [];
  if (cases.length === 0) problems.push('no cases');
  const seen = new Set();
  for (const c of cases) {
    if (!c.id) problems.push('a case has no id');
    else if (seen.has(c.id)) problems.push(`${c.id}: duplicate id`);
    seen.add(c.id);
    if (map ? c.input === undefined && c.state === undefined : c.state === undefined) problems.push(`${c.id}: no ${map ? 'input' : 'state'}`);
  }
  const labelled = new Set(cases.flatMap((c) => Object.keys(c.gold ?? {})));
  const unlabelled = map ? [] : ids.filter((id) => !labelled.has(id));
  const warnings = [];
  if (unlabelled.length) warnings.push(`questions with no gold labels (answered, never graded): ${unlabelled.join(', ')}`);
  if (cases.length > 0 && cases.length < 30) warnings.push(`${cases.length} cases: below ~30 no single-field gap under ~7 points is distinguishable from re-run drift`);
  return { problems, warnings };
}

/** Deterministic, plausible-looking filler of roughly `tokens` tokens (~4 characters each). */
export function filler(tokens, source) {
  const target = tokens * 4;
  const base = source ?? [
    'The quarterly planning review covered staffing, vendor renewals and the office move.',
    'Facilities confirmed the new badge readers will be installed on the third floor next month.',
    'The finance team circulated the updated travel policy and a reminder about expense deadlines.',
    'Several teams asked for more meeting rooms with video equipment during the afternoon.',
    'The internal newsletter will feature the volunteer day and the results of the engagement survey.',
    'IT scheduled routine maintenance for the shared drives over the weekend, with no action needed.',
    'The onboarding checklist was revised to include the new security awareness module.',
    'Catering for the all-hands will be vegetarian by default, with other options on request.',
  ].join(' ');
  let out = '';
  while (out.length < target) out += (out ? ' ' : '') + base;
  return out.slice(0, target);
}

export function pad(state, tokens, source) {
  const appendix = filler(tokens, source);
  if (state && typeof state === 'object' && !Array.isArray(state)) return { ...state, appendix };
  return { content: state, appendix };
}

export async function evaluate(state, questions, { model = DEFAULT_MODEL, key = process.env.AI_GATEWAY_API_KEY, attempts = 6, fetchImpl = fetch } = {}) {
  if (!key) throw new Error('AI_GATEWAY_API_KEY is not set');
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const started = performance.now();
    let res;
    try {
      res = await fetchImpl(BASE, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, state, questions }),
      });
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, Math.min(16000, 500 * 2 ** attempt)));
      continue;
    }
    const latencyMs = performance.now() - started;
    // 503s appeared at concurrency 8 on 20k-token states, and intermittently on requests with several
    // large choices; retry them like rate limits, backing off up to 16 s over six attempts
    if (res.status === 429 || res.status >= 500) {
      last = new Error(`HTTP ${res.status}: ${await res.text()}`);
      const after = Number(res.headers?.get?.('retry-after'));
      await new Promise((r) => setTimeout(r, Number.isFinite(after) && after > 0 ? after * 1000 : Math.min(16000, 500 * 2 ** attempt)));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const body = await res.json();
    return { answers: body.answers, latencyMs, inputTokens: body.usage?.input_tokens ?? 0, servedBy: body.model };
  }
  throw last;
}

async function pool(items, concurrency, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/** Grade one decision field: an array gold means "any of these", an array prediction uses its first item. */
export function gradeField(pred, gold) {
  if (pred === undefined || pred === null || pred === 'abstain' || (Array.isArray(pred) && pred.length === 0)) return 'abstain';
  const p = Array.isArray(pred) ? pred[0] : pred;
  return (Array.isArray(gold) ? gold.includes(p) : p === gold) ? 'right' : 'wrong';
}

export async function runSuite(suite, { model, concurrency = 2, derive, map, padTokens, padSource, suiteName = 'suite', fetchImpl, key, onProgress } = {}) {
  let done = 0;
  return pool(suite.cases, concurrency, async (c) => {
    const input = c.input ?? c.state;
    const row = { suite: suiteName, arm: padTokens ? `jev-pad${padTokens}` : map ? 'jev-map' : 'jev', caseId: c.id, tags: c.tags ?? [], gold: c.gold ?? {} };
    try {
      let state = map ? await map.buildState(input) : c.state;
      if (padTokens) state = pad(state, padTokens, padSource);
      const questions = map ? (map.questions ? await map.questions(input) : suite.questions) : suite.questions;
      const r = Object.keys(questions ?? {}).length
        ? await evaluate(state, questions, { model, fetchImpl, key })
        : { answers: {}, latencyMs: 0, inputTokens: 0 }; // a map may settle a case in code without asking
      Object.assign(row, { raw: r.answers, latencyMs: r.latencyMs, inputTokens: r.inputTokens, listCostUsd: r.inputTokens * LIST_PRICE, servedBy: r.servedBy });
      if (derive) Object.assign(row, derive(r.answers, c.state));
      if (map) {
        row.decision = await map.decide(r.answers, input);
        // A bare label is unambiguous when the gold has one field; accept it rather than grade it as abstain.
        const goldKeys = Object.keys(row.gold);
        if ((typeof row.decision === 'string' || typeof row.decision === 'number') && goldKeys.length === 1) row.decision = { [goldKeys[0]]: row.decision };
        row.grades = Object.fromEntries(Object.entries(row.gold).map(([k, g]) => [k, gradeField(row.decision?.[k], g)]));
      }
    } catch (err) {
      row.error = String(err?.message ?? err);
    }
    onProgress?.(++done, suite.cases.length);
    return row;
  });
}

/** Per-field right / wrong / abstain for rows produced with a map. */
export function summarise(rows) {
  const fields = {};
  for (const r of rows) {
    for (const [k, g] of Object.entries(r.grades ?? {})) {
      const f = (fields[k] ??= { right: 0, wrong: 0, abstain: 0, errors: 0, n: 0 });
      f[g] += 1;
      f.n += 1;
    }
    if (r.error) for (const k of Object.keys(r.gold ?? {})) { const f = (fields[k] ??= { right: 0, wrong: 0, abstain: 0, errors: 0, n: 0 }); f.errors += 1; f.n += 1; }
  }
  return Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, { ...f, accuracy: f.right / f.n, wrongRate: f.wrong / f.n, coverage: (f.right + f.wrong) / f.n }]));
}

async function main(argv) {
  const opt = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const valued = new Set(['--out', '--concurrency', '--model', '--derive', '--map', '--pad', '--pad-file']);
  const file = argv.find((a, i) => !a.startsWith('--') && !valued.has(argv[i - 1]));
  if (!file) {
    console.error('usage: jev-run <suite.json> [--out results.jsonl] [--concurrency 2] [--map map.mjs | --derive derive.mjs] [--pad N] [--pad-file f] [--check]');
    return 2;
  }
  const suite = JSON.parse(readFileSync(file, 'utf8'));
  const mapPath = opt('--map');
  const map = mapPath ? await import(pathToFileURL(resolve(mapPath)).href) : undefined;
  if (map && (typeof map.buildState !== 'function' || typeof map.decide !== 'function')) {
    console.error('error: --map module must export buildState(input) and decide(answers, input), and questions(input) unless the suite has questions');
    return 1;
  }
  const { problems, warnings } = checkSuite(suite, { map: !!map });
  for (const w of warnings) console.error(`warning: ${w}`);
  if (problems.length) {
    for (const p of problems) console.error(`error: ${p}`);
    return 1;
  }
  if (argv.includes('--check')) {
    console.error(`ok: ${Object.keys(suite.questions ?? {}).length} suite questions, ${suite.cases.length} cases${map ? ', map interface present' : ''}`);
    return 0;
  }
  const derivePath = opt('--derive');
  const derive = derivePath ? (await import(pathToFileURL(resolve(derivePath)).href)).default : undefined;
  const padTokens = opt('--pad') ? Number(opt('--pad')) : undefined;
  const padSource = opt('--pad-file') ? readFileSync(opt('--pad-file'), 'utf8') : undefined;
  const name = basename(file).replace(/\.json$/, '');
  const out = opt('--out') ?? `${name}.${padTokens ? `pad${padTokens}` : map ? 'map' : 'jev'}.jsonl`;

  const rows = await runSuite(suite, {
    model: opt('--model'),
    concurrency: Number(opt('--concurrency') ?? 2),
    derive,
    map,
    padTokens,
    padSource,
    suiteName: name,
    onProgress: (d, n) => process.stderr.write(`\r${d}/${n}`),
  });
  process.stderr.write('\n');
  writeFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const failed = rows.filter((r) => r.error);
  const tokens = rows.reduce((a, r) => a + (r.inputTokens ?? 0), 0);
  const latencies = rows.filter((r) => r.latencyMs).map((r) => r.latencyMs).sort((a, b) => a - b);
  const q = (p) => (latencies.length ? Math.round(latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))]) : 0);
  console.error(`wrote ${out}: ${rows.length - failed.length} answered, ${failed.length} failed · ${tokens} input tokens · $${(tokens * LIST_PRICE).toFixed(5)} at list · p50 ${q(0.5)} ms · p95 ${q(0.95)} ms`);
  for (const f of failed.slice(0, 5)) console.error(`  ${f.caseId}: ${f.error}`);
  if (map) {
    for (const [k, f] of Object.entries(summarise(rows))) {
      console.error(`${k}: accuracy ${(f.accuracy * 100).toFixed(1)}% · wrong ${f.wrong}/${f.n} · abstain ${f.abstain} · coverage ${(f.coverage * 100).toFixed(1)}%${f.errors ? ` · errors ${f.errors}` : ''}`);
    }
  }
  console.error(`next: jev-audit ${out}`);
  return failed.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => {
    console.error(err);
    process.exit(1);
  });
}
