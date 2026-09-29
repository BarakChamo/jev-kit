#!/usr/bin/env -S node --import tsx
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import {
  applyGates, auroc, calibration, confidentlyWrong, decisionSummary, decisions, diff, errored, fitDecisionGate, fitGate, fitGates,
  goldMismatches, inFitHalf, isMapRow, items, parseRows, probabilityCalibration, regold, topK, topLabelCalibration, weakLinks, type Row,
} from './index.js';

/**
 * Offline: reads recorded Jev results with gold labels and prints the audits that found real defects
 * in the study behind this package. No API key, no model calls. Results from `jev-run --map` get the
 * whole-map audit: wrong decisions, the weakest answer behind each, and a gate on that answer.
 */
const HELP = `usage:
  jev-audit <results.jsonl ...> [options]        audit one or more runs
  jev-audit diff <before.jsonl> <after.jsonl>    did a change move anything?

audit options:
  --target <p>      precision the fitted gates aim for (default 0.95)
  --threshold <p>   confidence above which a wrong answer is listed as confidently wrong (default 0.9)
  --holdout <f>     fit gates on a (1 - f) share of cases and report them on the other f (e.g. 0.5);
                    without it gates are fitted and judged on the same cases: an upper bound
  --json            machine-readable output

diff options:
  --gold <suite.json>   grade both runs against this suite's current labels. Without it, diff refuses
                        runs whose gold differs for any case (a corrected label is not a model change)
  --json

Rows that recorded an error are counted and reported, never graded.
Needs no API key. Details: the kit README, "Using the scripts".`;

const fail = (msg: string, code = 2): never => {
  console.error(`error: ${msg}\n(jev-audit --help lists every option)`);
  process.exit(code);
};
const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—');
const num = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const load = (f: string): Row[] => {
  try {
    return parseRows(readFileSync(f, 'utf8'));
  } catch (err) {
    return fail(`${f}: ${(err as Error).message}`);
  }
};

const argv = process.argv.slice(2);
const isDiff = argv[0] === 'diff';
let parsed;
try {
  parsed = parseArgs({
    args: isDiff ? argv.slice(1) : argv,
    allowPositionals: true,
    options: {
      target: { type: 'string' }, threshold: { type: 'string' }, holdout: { type: 'string' }, gold: { type: 'string' },
      json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    },
  });
} catch (err) {
  fail((err as Error).message);
}
const { values: o, positionals: files } = parsed!;
if (o.help) {
  console.log(HELP);
  process.exit(0);
}
const prob = (name: string, v: string | undefined, fallback: number) => {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!(n > 0 && n < 1) && !(name === '--target' && n === 1)) fail(`${name} must be between 0 and 1 (got ${v})`);
  return n;
};

// ---- jev-audit diff ------------------------------------------------------------------------------
if (isDiff) {
  if (files.length !== 2) fail('diff takes two files: jev-audit diff <before.jsonl> <after.jsonl>');
  const [before, after] = files as [string, string];
  let b = load(before);
  let a = load(after);
  if (o.gold) {
    const suite = JSON.parse(readFileSync(o.gold, 'utf8')) as { cases: { id: string; gold?: Record<string, unknown> }[] };
    b = regold(b, suite.cases);
    a = regold(a, suite.cases);
  } else {
    const mismatched = goldMismatches(b, a);
    if (mismatched.length) {
      fail(`the two runs have different gold labels for ${mismatched.length} case${mismatched.length > 1 ? 's' : ''} (${mismatched.slice(0, 5).join(', ')}${mismatched.length > 5 ? ', …' : ''}).\nA corrected label would show up as a model change. Re-grade both on one suite: --gold <suite.json>`, 1);
    }
  }
  const errs = [errored(b).length, errored(a).length];
  const fields = diff(items(b, { requireConfidence: false }), items(a, { requireConfidence: false }));
  if (o.json) {
    console.log(JSON.stringify({ errored: { before: errs[0], after: errs[1] }, fields }, null, 2));
    process.exit(0);
  }
  console.log(
    [
      `# jev-audit diff — ${basename(before)} → ${basename(after)}${o.gold ? ` (graded on ${basename(o.gold)})` : ''}`,
      '',
      '`real` needs |Δ| ≥ 7 points **and** p < 0.05 on the fixed-vs-broken sign test. Anything else is',
      'inside the drift an unchanged baseline shows on re-run. The test treats cases as independent: to',
      'compare two ways of writing a map, run several maps of each and compare maps, not cases.',
      ...(errs[0] || errs[1] ? ['', `**Errored rows, not compared:** ${errs[0]} before, ${errs[1]} after.`] : []),
      '',
      '| field | n | before | after | Δ | fixed | broken | flipped | p | verdict |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
      ...fields.map(
        (d) =>
          `| ${d.field} | ${d.n} | ${pct(d.before)} | ${pct(d.after)} | ${d.delta >= 0 ? '+' : ''}${(d.delta * 100).toFixed(1)} | ${d.fixed} | ${d.broken} | ${d.flipped} | ${d.p.toFixed(3)} | ${d.verdict === 'real' ? '**real**' : d.verdict} |`,
      ),
    ].join('\n'),
  );
  process.exit(0);
}

// ---- jev-audit <results...> ----------------------------------------------------------------------
if (files.length === 0) fail('no results file');
const threshold = prob('--threshold', o.threshold, 0.9);
const target = prob('--target', o.target, 0.95);
const holdout = o.holdout === undefined ? undefined : prob('--holdout', o.holdout, 0.5);

// With several files, fields that share a name across suites ("verdict") must not be pooled: prefix
// each field with its file's base name so every audit stays per question.
const prefixed = (file: string, rows: Row[]): Row[] => {
  if (files.length === 1) return rows;
  const tag = basename(file).split('.')[0];
  const re = <T,>(m: Record<string, T> | undefined) =>
    m ? Object.fromEntries(Object.entries(m).map(([k, v]) => [`${tag}/${k}`, v])) : undefined;
  return rows.map((r) => ({ ...r, gold: re(r.gold)!, raw: re(r.raw), predicted: re(r.predicted), confidence: re(r.confidence), decision: re(r.decision), grades: re(r.grades) }));
};
const rows = files.flatMap((f) => prefixed(f, load(f)));
const errs = errored(rows);
const out: string[] = [];
if (errs.length) {
  out.push(`> **${errs.length} of ${rows.length} rows errored and are not graded.** First: ${errs[0]!.caseId}: ${String(errs[0]!.error).slice(0, 160)}`, '');
}
if (errs.length === rows.length) {
  console.error(`every row errored (${rows.length}); nothing to audit. First error: ${String(errs[0]?.error ?? '').slice(0, 300)}`);
  process.exit(1);
}
// With --holdout, gates are fitted on one side of a fixed split and judged on the other.
const fitSide = (caseId: string) => holdout === undefined || inFitHalf(caseId, 1 - holdout);
const judgeSide = (caseId: string) => holdout === undefined || !inFitHalf(caseId, 1 - holdout);

// Whole-map runs: the gold is keyed by decision field, so the per-answer audits below have nothing to
// grade. Audit the decisions instead, through the least certain answer behind each.
if (rows.some(isMapRow)) {
  const ds = decisions(rows);
  const gate = fitDecisionGate(ds.filter((d) => fitSide(d.caseId)), target);
  const judged = holdout === undefined ? undefined : (() => {
    const held = ds.filter((d) => judgeSide(d.caseId) && d.grade !== 'abstain');
    const kept = gate.threshold === null && !gate.noErrors ? [] : held.filter((d) => (d.weakest?.certainty ?? 1) >= (gate.threshold ?? 0));
    return { n: held.length, coverage: held.length ? kept.length / held.length : Number.NaN, precision: kept.length ? kept.filter((d) => d.grade === 'right').length / kept.length : Number.NaN };
  })();
  const report = { decisions: ds.length, errored: errs.length, fields: decisionSummary(ds), weakLinks: weakLinks(ds), gate, heldOut: judged, wrong: ds.filter((d) => d.grade === 'wrong') };
  if (o.json) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }
  const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
  out.unshift(`# jev-audit — map run, ${report.decisions} graded decisions${errs.length ? `, ${errs.length} errored` : ''}`, '');
  out.push('| decision | n | right | wrong | abstain | accuracy | coverage |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const f of report.fields) out.push(`| ${f.field} | ${f.n} | ${f.right} | ${f.wrong} | ${f.abstain} | ${pct(f.accuracy)} | ${pct(f.coverage)} |`);
  out.push('', 'Accuracy counts an abstention as not right; "wrong" counts only decisions made and missed.');

  out.push('', `## Wrong decisions — ${report.wrong.length}`, '');
  out.push('Read these first. The weakest answer is the least certain read behind the decision (over every');
  out.push('question the map asked, whether or not `decide()` used it): the likeliest culprit when it is low.');
  out.push('A wrong decision whose weakest answer is still sure came from the code in `decide()` or from a');
  out.push('question that is confidently wrong, and a gate cannot catch it.', '');
  if (report.wrong.length) {
    out.push('| case | decision | gold | map decided | weakest answer | certainty |', '| --- | --- | --- | --- | --- | ---: |');
    for (const d of report.wrong.slice(0, 40)) {
      out.push(`| ${d.caseId} | ${d.field} | ${show(d.gold)} | ${show(d.decision)} | ${d.weakest?.question ?? '—'} | ${d.weakest ? d.weakest.certainty.toFixed(2) : '—'} |`);
    }
  } else out.push('None.');

  if (report.weakLinks.some((w) => w.wrong)) {
    out.push('', '## Weak links', '', 'How often each question was the least certain answer behind a wrong or a right decision.', '');
    out.push('| question | in wrong decisions | in right decisions |', '| --- | ---: | ---: |');
    for (const w of report.weakLinks.filter((w) => w.wrong).slice(0, 15)) out.push(`| ${w.question} | ${w.wrong} | ${w.right} |`);
  }

  const g = report.gate;
  out.push('', `## Gate for ${pct(target)} precision, on the weakest answer${holdout === undefined ? '' : ` (fitted on ${pct(1 - holdout)} of cases)`}`, '');
  if (g.noErrors) {
    out.push('No wrong decisions to remove: no gate is needed on these cases. That is not evidence one is');
    out.push('unnecessary in production; keep the map\'s own abstain rules.');
  } else {
    out.push('| threshold | coverage | precision | 95% lower bound | wrong decisions removed | right decisions lost |', '| ---: | ---: | ---: | ---: | ---: | ---: |');
    out.push(`| ${g.threshold === null ? 'unreachable' : g.threshold.toFixed(3)} | ${pct(g.coverage)} | ${pct(g.precision)} | ${pct(g.lower)} | ${g.wrongRemoved} | ${g.rightLost} |`);
    out.push('', 'In `decide()`, return "abstain" when any answer the decision uses is less certain than the threshold.');
  }
  if (judged) out.push('', `**On the held-out ${pct(holdout!)}** (${judged.n} decisions): coverage ${pct(judged.coverage)}, precision ${pct(judged.precision)}.`);
  else out.push('Fitted and judged on the same cases, so an upper bound: add `--holdout 0.5` to judge it on unseen cases.');
  console.log(out.join('\n'));
  process.exit(0);
}

const all = items(rows);
const fitItems = all.filter((i) => fitSide(i.caseId));
const gates = fitGates(fitItems, target, 'probability');
const report = {
  answers: all.length,
  errored: errs.length,
  confidentlyWrong: confidentlyWrong(all, threshold),
  topLabel: { calibration: topLabelCalibration(all), auroc: auroc(all, 'probability'), aurocScalar: auroc(all, 'confidence') },
  calibration: calibration(all),
  probabilityCalibration: probabilityCalibration(all),
  topK: topK(all, 2),
  gates,
  pooledGates: [fitGate(fitItems, target, 'probability'), fitGate(fitItems, target, 'confidence')],
  heldOut: holdout === undefined ? undefined : applyGates(all.filter((i) => judgeSide(i.caseId)), gates),
};

if (o.json) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

out.unshift(`# jev-audit — ${report.answers} graded answers${errs.length ? `, ${errs.length} errored rows` : ''}`, '');

out.push(`## Confidently wrong (confidence ≥ ${threshold}) — ${report.confidentlyWrong.errors.length} cases`, '');
out.push('Read these first. A confident error is either the model\'s real boundary or a label that does not');
out.push('follow its own rubric. A field wrong **in one direction** is a question defect before it is a model one.', '');
if (report.confidentlyWrong.patterns.length) {
  out.push('| field | confident errors | dominant pattern | share | verdict |', '| --- | ---: | --- | ---: | --- |');
  for (const p of report.confidentlyWrong.patterns) {
    out.push(`| ${p.field} | ${p.errors} | ${p.dominant} | ${pct(p.share)} | ${p.oneDirection ? '**check the question and labels**' : 'read individually'} |`);
  }
  out.push('', '| case | field | gold | answer | confidence |', '| --- | --- | --- | --- | ---: |');
  for (const e of report.confidentlyWrong.errors.slice(0, 40)) {
    out.push(`| ${e.caseId} | ${e.field} | ${e.gold} | ${e.label} | ${e.confidence.toFixed(2)} |`);
  }
} else {
  out.push('None.');
}

const calTable = (title: string, c: typeof report.calibration, note: string) => {
  out.push('', `## ${title}`, '', note, '', `ECE **${num(c.ece)}** · separation (right − wrong) **${num(c.separation)}**`, '');
  out.push('| bin | n | claimed | delivered | gap |', '| --- | ---: | ---: | ---: | ---: |');
  for (const b of c.bins) {
    const gap = b.delivered - b.claimed;
    out.push(`| ${b.lo.toFixed(1)}–${b.hi.toFixed(1)} | ${b.n} | ${b.claimed.toFixed(3)} | ${b.delivered.toFixed(3)} | ${gap >= 0 ? '+' : ''}${gap.toFixed(3)} |`);
  }
};
calTable(
  'Calibration of the top label\'s probability — what a gate reads',
  report.topLabel.calibration,
  `AUROC (how well it ranks right answers above wrong ones) **${num(report.topLabel.auroc)}**, against **${num(report.topLabel.aurocScalar)}** for the confidence scalar. A gate fitted on labelled cases depends on the ranking; calibration matters when you read the number as a probability. Bins with a handful of answers are noise.`,
);
calTable('Calibration of the confidence scalar', report.calibration, 'Positive gaps mean under-confident: the answer is right more often than it claims.');
calTable('Calibration of every probability in the distribution', report.probabilityCalibration, 'Pooled over every label, chosen or not. Near-zero probabilities of unchosen labels dominate the pool and flatter the ECE: use the top-label table for gating.');

if (report.topK.length) {
  out.push('', '## Top-2 recall — what argmax discards', '', 'Show two labels to a person. Do not hand a shortlist to another model.', '');
  out.push('| field | n | top-1 | top-2 |', '| --- | ---: | ---: | ---: |');
  for (const t of report.topK) out.push(`| ${t.field} | ${t.n} | ${pct(t.top1)} | ${pct(t.topK)} |`);
}

out.push('', `## Gates for ${pct(target)} precision, one per question, on the top label's probability${holdout === undefined ? '' : ` (fitted on ${pct(1 - holdout)} of cases)`}`, '');
out.push('| question | n | threshold | coverage | precision | 95% lower bound |', '| --- | ---: | ---: | ---: | ---: | ---: |');
for (const g of report.gates) {
  const t = g.noErrors ? 'no errors to fit' : g.threshold === null ? 'unreachable' : g.threshold.toFixed(3);
  out.push(`| ${g.field} | ${g.n} | ${t} | ${pct(g.coverage)} | ${pct(g.precision)} | ${pct(g.lower)} |`);
}
out.push('', '"no errors to fit": no wrong answers on these cases, so no threshold can be fitted. That says little about', 'unseen cases at ~30 per question: check with `--holdout`. Pooled over every question, for reference:', '');
out.push('| gating on | threshold | coverage | precision |', '| --- | ---: | ---: | ---: |');
for (const g of report.pooledGates) out.push(`| ${g.on} | ${g.threshold === null ? 'unreachable' : g.threshold.toFixed(3)} | ${pct(g.coverage)} | ${pct(g.precision)} |`);
if (report.heldOut) {
  out.push('', `### The same gates on the held-out ${pct(holdout!)}`, '', '| question | n | coverage | precision |', '| --- | ---: | ---: | ---: |');
  for (const h of report.heldOut) out.push(`| ${h.field} | ${h.n} | ${pct(h.coverage)} | ${pct(h.precision)} |`);
} else {
  out.push('', 'Fitted and judged on the same cases, so an upper bound: add `--holdout 0.5` to judge them on unseen cases.');
}

console.log(out.join('\n'));
