#!/usr/bin/env -S node --import tsx
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
  calibration, confidentlyWrong, decisionSummary, decisions, diff, fitDecisionGate, fitGate, isMapRow, items, parseRows,
  probabilityCalibration, topK, weakLinks, type Row,
} from './index.js';

/**
 * jev-audit <results.jsonl ...> [--threshold 0.9] [--target 0.95] [--json]
 * jev-audit diff <before.jsonl> <after.jsonl> [--json]
 *
 * Offline: reads recorded Jev results with gold labels and prints the audits that found real defects
 * in the study behind this package. No API key, no model calls. Results from `jev-run --map` get the
 * whole-map audit: wrong decisions, the weakest answer behind each, and a gate on that answer.
 */
const args = process.argv.slice(2);

// jev-audit diff <before.jsonl> <after.jsonl> — did a question change actually move anything?
if (args[0] === 'diff') {
  const [before, after] = args.slice(1).filter((a) => !a.startsWith('--'));
  if (!before || !after) {
    console.error('usage: jev-audit diff <before.jsonl> <after.jsonl> [--json]');
    process.exit(2);
  }
  const load = (f: string) => items(parseRows(readFileSync(f, 'utf8')), { requireConfidence: false });
  const fields = diff(load(before), load(after));
  if (args.includes('--json')) {
    console.log(JSON.stringify(fields, null, 2));
  } else {
    const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
    console.log(
      [
        `# jev-audit diff — ${basename(before)} → ${basename(after)}`,
        '',
        '`real` needs |Δ| ≥ 7 points **and** p < 0.05 on the fixed-vs-broken sign test. Anything else is',
        'inside the drift an unchanged baseline shows on re-run. Re-run your comparator on the same change.',
        '',
        '| field | n | before | after | Δ | fixed | broken | flipped | p | verdict |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
        ...fields.map(
          (d) =>
            `| ${d.field} | ${d.n} | ${pct(d.before)} | ${pct(d.after)} | ${d.delta >= 0 ? '+' : ''}${(d.delta * 100).toFixed(1)} | ${d.fixed} | ${d.broken} | ${d.flipped} | ${d.p.toFixed(3)} | ${d.verdict === 'real' ? '**real**' : d.verdict} |`,
        ),
      ].join('\n'),
    );
  }
  process.exit(0);
}

const flag = (name: string, fallback: number) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const files = args.filter((a, i) => !a.startsWith('--') && !['--threshold', '--target'].includes(args[i - 1] ?? ''));

if (files.length === 0) {
  console.error('usage: jev-audit <results.jsonl ...> [--threshold 0.9] [--target 0.95] [--json]');
  process.exit(2);
}

// With several files, fields that share a name across suites ("verdict") must not be pooled: prefix
// each field with its file's base name so every audit stays per question.
const prefixed = (file: string, rows: Row[]): Row[] => {
  if (files.length === 1) return rows;
  const tag = basename(file).split('.')[0];
  const re = <T,>(m: Record<string, T> | undefined) =>
    m ? Object.fromEntries(Object.entries(m).map(([k, v]) => [`${tag}/${k}`, v])) : undefined;
  return rows.map((r) => ({ ...r, gold: re(r.gold)!, raw: re(r.raw), predicted: re(r.predicted), confidence: re(r.confidence), decision: re(r.decision), grades: re(r.grades) }));
};
const rows = files.flatMap((f) => prefixed(f, parseRows(readFileSync(f, 'utf8'))));
const threshold = flag('--threshold', 0.9);
const target = flag('--target', 0.95);
const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—');

// Whole-map runs: the gold is keyed by decision field, so the per-answer audits below have nothing to
// grade. Audit the decisions instead, through the least certain answer behind each.
if (rows.some(isMapRow)) {
  const ds = decisions(rows);
  const report = { decisions: ds.length, fields: decisionSummary(ds), weakLinks: weakLinks(ds), gate: fitDecisionGate(ds, target), wrong: ds.filter((d) => d.grade === 'wrong') };
  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }
  const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
  const out: string[] = [`# jev-audit — map run, ${report.decisions} graded decisions`, ''];
  out.push('| decision | n | right | wrong | abstain | accuracy | coverage |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const f of report.fields) out.push(`| ${f.field} | ${f.n} | ${f.right} | ${f.wrong} | ${f.abstain} | ${pct(f.accuracy)} | ${pct(f.coverage)} |`);

  out.push('', `## Wrong decisions — ${report.wrong.length}`, '');
  out.push('Read these first. The weakest answer is the least certain read behind the decision: the likeliest');
  out.push('culprit when it is low. A wrong decision whose weakest answer is still sure came from the code in');
  out.push('`decide()` or from a question that is confidently wrong, and a gate cannot catch it.', '');
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
  out.push('', `## Gate for ${pct(target)} precision, on the weakest answer`, '');
  out.push('| threshold | coverage | precision | wrong decisions removed | right decisions lost |', '| ---: | ---: | ---: | ---: | ---: |');
  out.push(`| ${g.threshold === null ? 'unreachable' : g.threshold.toFixed(3)} | ${pct(g.coverage)} | ${pct(g.precision)} | ${g.wrongRemoved} | ${g.rightLost} |`);
  out.push('', 'In `decide()`, return "abstain" when any answer the decision uses is less certain than the threshold.');
  out.push('Fit it on held-out cases: a gate fitted on the cases it is judged on is an upper bound.');
  console.log(out.join('\n'));
  process.exit(0);
}

const all = items(rows);

const report = {
  answers: all.length,
  confidentlyWrong: confidentlyWrong(all, threshold),
  calibration: calibration(all),
  probabilityCalibration: probabilityCalibration(all),
  topK: topK(all, 2),
  gates: [fitGate(all, target, 'probability'), fitGate(all, target, 'confidence')],
};

if (args.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const out: string[] = [`# jev-audit — ${report.answers} graded answers`, ''];

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

const calTable = (title: string, c: typeof report.calibration) => {
  out.push('', `## ${title}`, '', `ECE **${c.ece.toFixed(3)}** · separation (right − wrong) **${c.separation.toFixed(3)}**`, '');
  out.push('| bin | n | claimed | delivered | gap |', '| --- | ---: | ---: | ---: | ---: |');
  for (const b of c.bins) {
    const gap = b.delivered - b.claimed;
    out.push(`| ${b.lo.toFixed(1)}–${b.hi.toFixed(1)} | ${b.n} | ${b.claimed.toFixed(3)} | ${b.delivered.toFixed(3)} | ${gap >= 0 ? '+' : ''}${gap.toFixed(3)} |`);
  }
};
calTable('Calibration of the confidence scalar', report.calibration);
calTable('Calibration of every probability in the distribution', report.probabilityCalibration);

if (report.topK.length) {
  out.push('', '## Top-2 recall — what argmax discards', '', 'Show two labels to a person. Do not hand a shortlist to another model.', '');
  out.push('| field | n | top-1 | top-2 |', '| --- | ---: | ---: | ---: |');
  for (const t of report.topK) out.push(`| ${t.field} | ${t.n} | ${pct(t.top1)} | ${pct(t.topK)} |`);
}

out.push('', `## Gate for ${pct(target)} precision`, '', '| gating on | threshold | coverage | precision |', '| --- | ---: | ---: | ---: |');
for (const g of report.gates) {
  out.push(`| ${g.on} | ${g.threshold === null ? 'unreachable' : g.threshold.toFixed(3)} | ${pct(g.coverage)} | ${pct(g.precision)} |`);
}
out.push('', 'Fit the gate on held-out cases. Coverage measured on your own hand-written cases is an upper bound.');

console.log(out.join('\n'));
