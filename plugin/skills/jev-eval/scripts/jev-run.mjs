#!/usr/bin/env node
/**
 * jev-run — run a labelled suite through Jev and write one JSONL row per case, in the format
 * jev-audit reads. Zero dependencies; Node 18+. `node jev-run.mjs --help` lists every flag.
 *
 * Two ways to reach Jev, chosen by which key is set (or --provider):
 *   TYPESAFE_API_KEY    TypeSafe's API, https://api.typesafe.ai/v1/systemone, model jev-latest.
 *                       The only route that can pin a version (--model jev-1.13.0).
 *   AI_GATEWAY_API_KEY  Vercel AI Gateway, https://ai-gateway.vercel.sh/typesafe/v1/systemone,
 *                       model typesafe-ai/jev. Reports the gateway's billed cost on each row.
 * Both take the same request and return the same answers. --check needs no key and makes no calls.
 *
 * Suite file:
 *   {
 *     "questions": { "<id>": { "type": "noul" | "choice" | "score", "instructions": "...", "criteria": ... } },
 *     "cases": [ { "id": "c1", "state": { ... }, "gold": { "<question or derived field>": "<label>" }, "tags": [] } ]
 *   }
 * With --map, cases carry `input` instead of `state` and the suite needs no `questions`. A .jsonl
 * file is read as one case per line (for --map runs over large case sets).
 *
 * Gold labels: a Noul is graded "yes"/"no" at 0.5; a Choice by option name; a Score by the level's
 * name (the text before the first colon of its criterion, else the whole criterion).
 *
 * --derive loads a module whose default export is (answers, state) => ({ predicted, confidence }):
 * fields computed in code from the answers, graded like any other (derive-vs-ask on the same run).
 *
 * --map loads a question map written to the standard interface (jev-questions, "The interface a map
 * exposes"): buildState(input), questions(input) and decide(answers, input). decide() returns the
 * decision fields ({ outcome: "avoided" }, or "abstain" to send the case to a person), graded against
 * `gold`: right, wrong, abstain, coverage.
 *
 * --pad appends ~N tokens of filler as an extra `appendix` field, for the pad test. Use --pad-file
 * with plausible material from your own domain when you can.
 */
import { createWriteStream, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const PROVIDERS = {
  typesafe: { url: 'https://api.typesafe.ai/v1/systemone', env: 'TYPESAFE_API_KEY', model: 'jev-latest' },
  gateway: { url: 'https://ai-gateway.vercel.sh/typesafe/v1/systemone', env: 'AI_GATEWAY_API_KEY', model: 'typesafe-ai/jev' },
};
export const DEFAULT_MODEL = PROVIDERS.gateway.model;
/** list price, USD per input token; output is free */
export const LIST_PRICE = 0.042 / 1e6;
const CHOICE_MAX = 255;
/** TypeSafe's documented limit: 32k tokens for the state plus the longest question (64k per request). */
const STATE_TOKENS_MAX = 32000;
const approxTokens = (x) => Math.ceil((typeof x === 'string' ? x : JSON.stringify(x ?? '')).length / 4);

/**
 * Which API to call, with which key and model. An explicit provider wins; otherwise TYPESAFE_API_KEY,
 * then AI_GATEWAY_API_KEY. A model named for the other route is translated (jev-latest <->
 * typesafe-ai/jev); the gateway serves only the unversioned model, so pinning needs TypeSafe's API.
 */
export function resolveProvider({ provider, model, key, env = process.env } = {}) {
  const name = provider ?? env.JEV_PROVIDER ?? (env.TYPESAFE_API_KEY ? 'typesafe' : env.AI_GATEWAY_API_KEY ? 'gateway' : undefined);
  if (name && !PROVIDERS[name]) throw new Error(`unknown provider "${name}": use typesafe or gateway`);
  const p = PROVIDERS[name ?? 'gateway'];
  let m = model ?? p.model;
  if (name === 'typesafe' && m.startsWith('typesafe-ai/')) m = m === 'typesafe-ai/jev' ? 'jev-latest' : m.slice('typesafe-ai/'.length);
  if (name !== 'typesafe' && !m.includes('/')) m = m === 'jev-latest' || m === 'jev' ? 'typesafe-ai/jev' : `typesafe-ai/${m}`;
  return { name: name ?? 'gateway', url: env.JEV_BASE_URL ?? p.url, key: key ?? env[p.env], keyEnv: p.env, model: m };
}

export const NO_KEY = [
  'no API key: set one of',
  '  TYPESAFE_API_KEY    TypeSafe API (keys at https://docs.typesafe.ai)',
  '  AI_GATEWAY_API_KEY  Vercel AI Gateway (https://vercel.com/docs/ai-gateway)',
  'Without a key you can still: validate with --check, and audit recorded runs with jev-audit',
  '(see "Try it without a key" in the kit README).',
].join('\n');

/** Structural checks on a questions map against the documented API. Validity, not quality. */
export function checkQuestions(questions, where = '') {
  const problems = [];
  for (const [id, q] of Object.entries(questions ?? {})) {
    const at = `${where}${id}`;
    if (!q || typeof q !== 'object') { problems.push(`${at}: not an object`); continue; }
    if (!['noul', 'choice', 'score'].includes(q.type)) problems.push(`${at}: type must be noul, choice or score (got ${JSON.stringify(q.type)})`);
    if (typeof q.instructions !== 'string' || !q.instructions.trim()) problems.push(`${at}: empty instructions`);
    if (q.type === 'choice') {
      const n = Object.keys(q.criteria ?? {}).length;
      if (n < 2) problems.push(`${at}: a choice needs at least two options`);
      if (n > CHOICE_MAX) problems.push(`${at}: ${n} options exceeds the ${CHOICE_MAX}-option ceiling (the API refuses, it does not truncate)`);
    }
    if (q.type === 'score' && (!Array.isArray(q.criteria) || q.criteria.length < 2)) problems.push(`${at}: a score needs at least two ordered levels`);
  }
  return problems;
}

/** Structural checks on a suite. With `map`, cases need `input` (or `state`) and no questions. */
export function checkSuite(suite, { map = false } = {}) {
  const questions = suite?.questions ?? {};
  const ids = Object.keys(questions);
  const problems = [];
  if (ids.length === 0 && !map) problems.push('no questions');
  problems.push(...checkQuestions(questions));
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
  const warnings = [];
  const unlabelled = map ? [] : ids.filter((id) => !labelled.has(id));
  if (unlabelled.length) warnings.push(`questions with no gold labels (answered, never graded): ${unlabelled.join(', ')}`);
  if (labelled.size === 0) warnings.push('no case has gold labels: the run is answered but not graded');
  if (cases.length > 0 && cases.length < 30) warnings.push(`${cases.length} cases: below ~30 no single-field gap under ~7 points is distinguishable from re-run drift`);
  if (!map) for (const c of cases) if (approxTokens(c.state) > STATE_TOKENS_MAX) warnings.push(`${c.id}: state is ~${approxTokens(c.state)} tokens, over the documented ${STATE_TOKENS_MAX}`);
  return { problems, warnings };
}

/** A plausible answer to one question, for exercising decide() without calling Jev. */
export function syntheticAnswer(q, pick = 0) {
  if (q.type === 'noul') return { type: 'noul', noul: pick % 2 ? 0.1 : 0.9 };
  if (q.type === 'choice') {
    const keys = Object.keys(q.criteria ?? {});
    const choice = keys[pick % Math.max(keys.length, 1)];
    return { type: 'choice', choice, confidence: 0.9, probabilities: Object.fromEntries(keys.map((k) => [k, k === choice ? 0.9 : 0.1 / Math.max(keys.length - 1, 1)])) };
  }
  const n = Array.isArray(q.criteria) ? q.criteria.length : 2;
  const level = pick % n;
  return { type: 'score', score: level, confidence: 0.9, probabilities: Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i), i === level ? 0.9 : 0.1 / (n - 1)])) };
}

/**
 * Exercise a map on every case without calling Jev: build each state and question set, validate them
 * against the API's limits, and run decide() on synthetic answers. Catches bad question shapes, states
 * over the size limit, crashes, and decision fields that never match the gold. Runs the map's code.
 */
export async function checkMap(map, suite) {
  const problems = [];
  const warnings = [];
  const questionCounts = [];
  const decisionFields = new Set();
  const goldFields = new Set(suite.cases.flatMap((c) => Object.keys(c.gold ?? {})));
  const goldLabels = new Map();
  for (const c of suite.cases) for (const [k, g] of Object.entries(c.gold ?? {})) for (const v of [g].flat()) (goldLabels.get(k) ?? goldLabels.set(k, new Set()).get(k)).add(String(v));
  const seenLabels = new Map();
  let bigStates = 0;
  for (const c of suite.cases) {
    const input = c.input ?? c.state;
    try {
      const state = await map.buildState(input);
      if (state === undefined || state === null || state === '') problems.push(`${c.id}: buildState returned an empty state`);
      if (approxTokens(state) > STATE_TOKENS_MAX) bigStates += 1;
      const questions = map.questions ? await map.questions(input) : suite.questions;
      questionCounts.push(Object.keys(questions ?? {}).length);
      problems.push(...checkQuestions(questions, `${c.id}: `));
      for (const pick of [0, 1]) {
        const answers = Object.fromEntries(Object.entries(questions ?? {}).map(([k, q]) => [k, syntheticAnswer(q, pick)]));
        let d = await map.decide(answers, input);
        if ((typeof d === 'string' || typeof d === 'number') && goldFields.size === 1) d = { [[...goldFields][0]]: d };
        if (!d || typeof d !== 'object') { problems.push(`${c.id}: decide() returned ${JSON.stringify(d)}, not an object of decision fields`); break; }
        for (const [k, v] of Object.entries(d)) {
          decisionFields.add(k);
          if (v !== 'abstain') for (const x of [v].flat()) (seenLabels.get(k) ?? seenLabels.set(k, new Set()).get(k)).add(String(x));
        }
      }
    } catch (err) {
      problems.push(`${c.id}: ${err?.message ?? err}`);
    }
  }
  // one line per distinct problem, with the cases it hit, rather than the same line thirty times
  const grouped = new Map();
  for (const p of problems) {
    const [id, ...rest] = p.split(': ');
    const key = rest.join(': ');
    (grouped.get(key) ?? grouped.set(key, []).get(key)).push(id);
  }
  problems.length = 0;
  for (const [msg, ids] of grouped) problems.push(`${msg} (${ids.length === 1 ? ids[0] : `${ids.length} cases: ${ids.slice(0, 3).join(', ')}${ids.length > 3 ? ', …' : ''}`})`);
  const missing = [...goldFields].filter((k) => !decisionFields.has(k));
  if (missing.length) problems.unshift(`decide() never returns the gold field${missing.length > 1 ? 's' : ''} ${missing.join(', ')} (it returns: ${[...decisionFields].join(', ') || 'nothing'})`);
  for (const [k, labels] of seenLabels) {
    const gold = goldLabels.get(k);
    const stray = gold ? [...labels].filter((l) => !gold.has(l)) : [];
    if (gold && stray.length && gold.size < 50) warnings.push(`${k}: decide() can return ${stray.map((s) => JSON.stringify(s)).join(', ')}, which no gold label uses (a typo, or a label the suite never tests)`);
  }
  if (bigStates) warnings.push(`${bigStates} states are over the documented ${STATE_TOKENS_MAX}-token limit`);
  return { problems, warnings, questionCounts, decisionFields: [...decisionFields] };
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

/** An error that no retry will fix (a bad key, a refused request): stops the whole run. */
export class FatalError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One call: a state and a questions map. Up to `attempts` tries (default 6) for 429, 5xx, timeouts and
 * network errors, backing off 0.5 s doubling to 16 s (or the server's retry-after). 401/403 are fatal.
 */
export async function evaluate(state, questions, { provider, model, key, attempts = 6, timeoutMs = 60000, fetchImpl = fetch } = {}) {
  const p = typeof provider === 'object' ? provider : resolveProvider({ provider, model, key });
  if (!p.key) throw new FatalError(NO_KEY);
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(last?.retryAfterMs ?? Math.min(16000, 500 * 2 ** (attempt - 1)));
    const started = performance.now();
    let res;
    try {
      res = await fetchImpl(p.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: p.model, state, questions }),
        signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined,
      });
    } catch (err) {
      last = err?.name === 'TimeoutError' ? new Error(`timed out after ${timeoutMs} ms`) : err;
      continue;
    }
    const latencyMs = performance.now() - started;
    // 503s appeared at concurrency 8 on 20k-token states, and intermittently on requests with several
    // large choices: retried like rate limits (429) and TypeSafe's 529 Overloaded.
    if (res.status === 429 || res.status >= 500) {
      last = new Error(`HTTP ${res.status}: ${await res.text()}`);
      const after = Number(res.headers?.get?.('retry-after'));
      last.retryAfterMs = Number.isFinite(after) && after > 0 ? after * 1000 : undefined;
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new FatalError(`HTTP ${res.status} from ${p.name}: ${(await res.text()).slice(0, 200)} (check ${p.keyEnv})`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const body = await res.json();
    const inputTokens = body.usage?.input_tokens ?? 0;
    const billed = Number(body.provider_metadata?.gateway?.cost);
    return { answers: body.answers, latencyMs, inputTokens, servedBy: body.model, provider: p.name, ...(Number.isFinite(billed) ? { costUsd: billed } : {}) };
  }
  throw last;
}

async function pool(items, concurrency, fn, shouldStop) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length && !shouldStop()) {
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

/**
 * Run every case. Returns rows in case order; `onRow` sees each as it finishes (for streaming output).
 * A FatalError (no key, bad key) stops the run and is rethrown.
 */
export async function runSuite(suite, { model, provider, concurrency = 2, derive, map, padTokens, padSource, suiteName = 'suite', fetchImpl, key, timeoutMs, onProgress, onRow } = {}) {
  const p = typeof provider === 'object' ? provider : resolveProvider({ provider, model, key });
  if (!p.key) throw new FatalError(NO_KEY);
  let done = 0;
  let fatal;
  const rows = await pool(suite.cases, concurrency, async (c) => {
    const input = c.input ?? c.state;
    const row = { suite: suiteName, arm: padTokens ? `jev-pad${padTokens}` : map ? 'jev-map' : 'jev', caseId: c.id, tags: c.tags ?? [], gold: c.gold ?? {} };
    try {
      let state = map ? await map.buildState(input) : c.state;
      if (padTokens) state = pad(state, padTokens, padSource);
      const questions = map ? (map.questions ? await map.questions(input) : suite.questions) : suite.questions;
      const r = Object.keys(questions ?? {}).length
        ? await evaluate(state, questions, { provider: p, fetchImpl, timeoutMs })
        : { answers: {}, latencyMs: 0, inputTokens: 0 }; // a map may settle a case in code without asking
      Object.assign(row, { raw: r.answers, latencyMs: r.latencyMs, inputTokens: r.inputTokens, listCostUsd: r.inputTokens * LIST_PRICE, servedBy: r.servedBy, provider: r.provider });
      if (r.costUsd !== undefined) row.costUsd = r.costUsd;
      if (derive) Object.assign(row, derive(r.answers, c.state ?? input));
      if (map) {
        row.decision = await map.decide(r.answers, input);
        // A bare label is unambiguous when the gold has one field; accept it rather than grade it as abstain.
        const goldKeys = Object.keys(row.gold);
        if ((typeof row.decision === 'string' || typeof row.decision === 'number') && goldKeys.length === 1) row.decision = { [goldKeys[0]]: row.decision };
        row.grades = Object.fromEntries(Object.entries(row.gold).map(([k, g]) => [k, gradeField(row.decision?.[k], g)]));
      }
    } catch (err) {
      if (err instanceof FatalError) { fatal ??= err; return undefined; }
      row.error = String(err?.message ?? err);
    }
    onRow?.(row);
    onProgress?.(++done, suite.cases.length);
    return row;
  }, () => fatal !== undefined);
  if (fatal) throw fatal;
  return rows;
}

/** Per-field right / wrong / abstain / errors for rows produced with a map. */
export function summarise(rows) {
  const fields = {};
  for (const r of rows.filter(Boolean)) {
    for (const [k, g] of Object.entries(r.grades ?? {})) {
      const f = (fields[k] ??= { right: 0, wrong: 0, abstain: 0, errors: 0, n: 0 });
      f[g] += 1;
      f.n += 1;
    }
    if (r.error) for (const k of Object.keys(r.gold ?? {})) { const f = (fields[k] ??= { right: 0, wrong: 0, abstain: 0, errors: 0, n: 0 }); f.errors += 1; f.n += 1; }
  }
  return Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, { ...f, accuracy: f.right / f.n, wrongRate: f.wrong / f.n, coverage: (f.right + f.wrong) / f.n }]));
}

export const HELP = `usage: jev-run <suite.json | cases.jsonl> [options]

Runs every case through Jev and writes one JSONL row per case for jev-audit.

  --map <map.mjs>        grade a whole map (buildState / questions / decide) end to end
  --derive <derive.mjs>  also grade fields computed in code from the answers
  --check                validate without calling Jev; with --map, builds every case's state and
                         questions and runs decide() on synthetic answers (this runs the map's code)
  --out <file>           where to write rows (default: <suite>.<jev|map|padN>.jsonl in this folder)
  --resume               keep rows already in --out that have no error; run only the rest
  --provider <name>      typesafe or gateway (default: whichever key is set, TypeSafe first)
  --model <id>           default jev-latest (TypeSafe) or typesafe-ai/jev (gateway); pin a version,
                         e.g. jev-1.13.0, through TypeSafe's API
  --concurrency <n>      parallel requests, default 2 (8 drew 503s on 20k-token states)
  --timeout <seconds>    per request, default 60; timed-out requests are retried
  --max-failures <n>     exit 0 when at most n cases fail after retries (default 0)
  --pad <tokens>         append ~N tokens of filler to each state (the pad test)
  --pad-file <file>      filler text to use instead of the built-in paragraph
  -h, --help             this help

Keys: TYPESAFE_API_KEY (api.typesafe.ai) or AI_GATEWAY_API_KEY (Vercel AI Gateway).
Exit codes: 0 ok, 1 cases failed or checks failed, 2 usage error or no key.
Behind an HTTPS proxy on Node 22.21+, set NODE_USE_ENV_PROXY=1.`;

export function readSuite(file) {
  const text = readFileSync(file, 'utf8');
  if (file.endsWith('.jsonl')) return { cases: text.split('\n').filter((l) => l.trim()).map((l, i) => { try { return JSON.parse(l); } catch { throw new Error(`${file}:${i + 1}: not valid JSON`); } }) };
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${file}: not valid JSON (${err.message})`);
  }
}

const int = (name, v, min) => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new UsageError(`${name} must be a whole number of at least ${min} (got ${JSON.stringify(v)})`);
  return n;
};
class UsageError extends Error {}

async function main(argv) {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string' }, map: { type: 'string' }, derive: { type: 'string' }, check: { type: 'boolean' },
      resume: { type: 'boolean' }, provider: { type: 'string' }, model: { type: 'string' },
      concurrency: { type: 'string' }, timeout: { type: 'string' }, 'max-failures': { type: 'string' },
      pad: { type: 'string' }, 'pad-file': { type: 'string' }, help: { type: 'boolean', short: 'h' },
    },
  });
  if (o.help) { console.log(HELP); return 0; }
  if (positionals.length !== 1) throw new UsageError(positionals.length ? `one suite file, got ${positionals.join(' ')}` : 'no suite file');
  if (o.map && o.derive) throw new UsageError('--map and --derive do not combine: put derived fields in decide()');
  const concurrency = int('--concurrency', o.concurrency, 1) ?? 2;
  const timeoutMs = (int('--timeout', o.timeout, 1) ?? 60) * 1000;
  const maxFailures = int('--max-failures', o['max-failures'], 0) ?? 0;
  const padTokens = int('--pad', o.pad, 1);
  if (o.provider && !PROVIDERS[o.provider]) throw new UsageError(`--provider must be typesafe or gateway`);

  const file = positionals[0];
  if (!existsSync(file)) throw new UsageError(`${file}: no such file`);
  const suite = readSuite(file);
  const map = o.map ? await import(pathToFileURL(resolve(o.map)).href) : undefined;
  if (map && (typeof map.buildState !== 'function' || typeof map.decide !== 'function' || (typeof map.questions !== 'function' && !suite.questions))) {
    console.error('error: --map module must export buildState(input), decide(answers, input), and questions(input) unless the suite has questions');
    return 1;
  }
  const { problems, warnings } = checkSuite(suite, { map: !!map });
  for (const w of warnings) console.error(`warning: ${w}`);
  if (problems.length) {
    for (const p of problems) console.error(`error: ${p}`);
    return 1;
  }
  if (o.check) {
    if (!map) {
      console.error(`ok: ${Object.keys(suite.questions).length} questions, ${suite.cases.length} cases`);
      return 0;
    }
    const r = await checkMap(map, suite);
    for (const w of r.warnings) console.error(`warning: ${w}`);
    for (const p of r.problems.slice(0, 20)) console.error(`error: ${p}`);
    if (r.problems.length > 20) console.error(`error: …and ${r.problems.length - 20} more`);
    if (r.problems.length) return 1;
    const qs = r.questionCounts;
    console.error(`ok: ${suite.cases.length} cases built, ${Math.min(...qs)}–${Math.max(...qs)} questions each, all within API limits; decide() returns ${r.decisionFields.join(', ')}`);
    return 0;
  }

  const provider = resolveProvider({ provider: o.provider, model: o.model });
  if (!provider.key) {
    console.error(o.provider ? `error: --provider ${o.provider} needs ${provider.keyEnv}\n${NO_KEY}` : `error: ${NO_KEY}`);
    return 2;
  }
  const derive = o.derive ? (await import(pathToFileURL(resolve(o.derive)).href)).default : undefined;
  const padSource = o['pad-file'] ? readFileSync(o['pad-file'], 'utf8') : undefined;
  const name = basename(file).replace(/\.jsonl?$/, '');
  const out = o.out ?? `${name}.${padTokens ? `pad${padTokens}` : map ? 'map' : 'jev'}.jsonl`;

  let kept = [];
  if (o.resume && existsSync(out)) kept = readFileSync(out, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((r) => !r.error);
  const keptIds = new Set(kept.map((r) => r.caseId));
  const todo = { ...suite, cases: suite.cases.filter((c) => !keptIds.has(c.id)) };
  if (kept.length) console.error(`resume: keeping ${kept.length} rows from ${out}, running ${todo.cases.length}`);

  const stream = createWriteStream(out);
  for (const r of kept) stream.write(JSON.stringify(r) + '\n');
  const started = Date.now();
  const tty = process.stderr.isTTY;
  let lastLine = 0;
  let rows;
  try {
    rows = await runSuite(todo, {
      provider, concurrency, derive, map, padTokens, padSource, suiteName: name, timeoutMs,
      onRow: (r) => stream.write(JSON.stringify(r) + '\n'),
      onProgress: (d, n) => {
        const rate = d / ((Date.now() - started) / 1000);
        const line = `${d}/${n} · ${rate.toFixed(1)}/s · eta ${Math.round((n - d) / rate)} s`;
        if (tty) process.stderr.write(`\r${line}   `);
        else if (d === n || d - lastLine >= Math.max(1, Math.ceil(n / 10))) { lastLine = d; console.error(line); }
      },
    });
  } catch (err) {
    await new Promise((r) => stream.end(r));
    if (err instanceof FatalError) {
      if (!readFileSync(out, 'utf8').trim()) unlinkSync(out);
      console.error(`\nerror: ${err.message}${existsSync(out) ? `\nstopped; ${out} holds only the cases finished before the error (--resume continues).` : ''}`);
      return 2;
    }
    throw err;
  }
  await new Promise((r) => stream.end(r));
  if (tty) process.stderr.write('\n');
  rows = [...kept, ...rows];

  const failed = rows.filter((r) => r.error);
  const tokens = rows.reduce((a, r) => a + (r.inputTokens ?? 0), 0);
  const billed = rows.reduce((a, r) => a + (r.costUsd ?? 0), 0);
  const latencies = rows.filter((r) => r.latencyMs).map((r) => r.latencyMs).sort((a, b) => a - b);
  const q = (p) => (latencies.length ? Math.round(latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))]) : 0);
  console.error(`wrote ${out}: ${rows.length - failed.length} answered, ${failed.length} failed · ${provider.name} ${provider.model} · ${tokens} input tokens · $${(tokens * LIST_PRICE).toFixed(5)} at list price${billed ? ` ($${billed.toFixed(5)} billed)` : ''} · p50 ${q(0.5)} ms · p95 ${q(0.95)} ms`);
  for (const f of failed.slice(0, 5)) console.error(`  ${f.caseId}: ${f.error}`);
  if (failed.length > 5) console.error(`  …and ${failed.length - 5} more`);
  if (map) {
    for (const [k, f] of Object.entries(summarise(rows))) {
      console.error(`${k}: accuracy ${(f.accuracy * 100).toFixed(1)}% · wrong ${f.wrong}/${f.n} · abstain ${f.abstain} · coverage ${(f.coverage * 100).toFixed(1)}%${f.errors ? ` · errors ${f.errors}` : ''}`);
    }
  }
  if (failed.length === rows.length) {
    console.error('every case failed: fix the error above before auditing (re-run with --resume to keep finished rows)');
    return 1;
  }
  console.error(`next: jev-audit ${out}${failed.length ? '   (failed cases are reported, not graded; --resume retries them)' : ''}`);
  return failed.length > maxFailures ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => {
    if (err instanceof UsageError || err?.code?.startsWith?.('ERR_PARSE_ARGS')) {
      console.error(`error: ${err.message}\n(jev-run --help lists every option)`);
      process.exit(2);
    }
    console.error(`error: ${err?.message ?? err}`);
    process.exit(1);
  });
}
