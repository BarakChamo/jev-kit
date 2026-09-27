#!/usr/bin/env node
// Generated from packages/audit by scripts/build-plugin.mjs. Do not edit.

// packages/audit/src/cli.ts
import { readFileSync } from "node:fs";
import { basename } from "node:path";

// packages/audit/src/index.ts
function items(rows, opts = {}) {
  const requireConfidence = opts.requireConfidence ?? true;
  const out2 = [];
  for (const row of rows) {
    for (const [field, gold] of Object.entries(row.gold ?? {})) {
      const answer = row.raw?.[field];
      if (answer?.type === "noul") {
        out2.push({
          caseId: row.caseId,
          field,
          gold,
          label: answer.noul > 0.5 ? "yes" : "no",
          confidence: Math.max(answer.noul, 1 - answer.noul),
          probabilities: { yes: answer.noul, no: 1 - answer.noul },
          primitive: "noul"
        });
      } else if (answer?.type === "choice") {
        out2.push({ caseId: row.caseId, field, gold, label: answer.choice, confidence: answer.confidence, probabilities: answer.probabilities, primitive: "choice" });
      } else if (answer?.type === "score") {
        const name = (index2) => {
          const text = answer.legend?.[index2];
          if (text === void 0) return index2;
          const colon = text.indexOf(":");
          return colon > 0 ? text.slice(0, colon).trim() : text.trim();
        };
        const levels = Object.keys(answer.probabilities).length;
        const index = String(Math.min(levels - 1, Math.max(0, Math.round(answer.score))));
        out2.push({
          caseId: row.caseId,
          field,
          gold,
          label: name(index),
          confidence: answer.confidence,
          probabilities: Object.fromEntries(Object.entries(answer.probabilities).map(([k, v]) => [name(k), v])),
          primitive: "score"
        });
      } else {
        const label = row.predicted?.[field];
        const confidence = row.confidence?.[field];
        if (label !== void 0 && (confidence !== void 0 || !requireConfidence)) {
          out2.push({ caseId: row.caseId, field, gold, label, confidence: confidence ?? Number.NaN, primitive: "derived" });
        }
      }
    }
  }
  return out2;
}
function confidentlyWrong(all2, threshold2 = 0.9) {
  const errors = all2.filter((i) => i.label !== i.gold && i.confidence >= threshold2).map((i) => ({ ...i, direction: `${i.gold} -> ${i.label}` })).sort((a, b) => b.confidence - a.confidence);
  const byField = /* @__PURE__ */ new Map();
  for (const e of errors) byField.set(e.field, [...byField.get(e.field) ?? [], e]);
  const patterns = [...byField.entries()].map(([field, es]) => {
    const counts = /* @__PURE__ */ new Map();
    for (const e of es) counts.set(e.direction, (counts.get(e.direction) ?? 0) + 1);
    const [dominant, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const share = n / es.length;
    return { field, errors: es.length, dominant, share, oneDirection: es.length >= 3 && share >= 0.8 };
  });
  return { errors, patterns: patterns.sort((a, b) => b.errors - a.errors) };
}
function binned(points, binCount) {
  const bins = [];
  let ece = 0;
  for (let i = 0; i < binCount; i += 1) {
    const lo = i / binCount;
    const hi = (i + 1) / binCount;
    const inBin = points.filter((x) => x.p >= lo && (i === binCount - 1 ? x.p <= hi : x.p < hi));
    if (inBin.length === 0) continue;
    const claimed = inBin.reduce((a, x) => a + x.p, 0) / inBin.length;
    const delivered = inBin.filter((x) => x.hit).length / inBin.length;
    bins.push({ lo, hi, n: inBin.length, claimed, delivered });
    ece += inBin.length / points.length * Math.abs(claimed - delivered);
  }
  const hits = points.filter((x) => x.hit);
  const misses = points.filter((x) => !x.hit);
  const mean = (xs) => xs.length ? xs.reduce((a, x) => a + x.p, 0) / xs.length : Number.NaN;
  return { answers: points.length, ece, separation: mean(hits) - mean(misses), bins };
}
function calibration(all2, binCount = 10) {
  return binned(all2.map((i) => ({ p: i.confidence, hit: i.label === i.gold })), binCount);
}
function probabilityCalibration(all2, binCount = 10) {
  const points = [];
  for (const i of all2) {
    if (!i.probabilities) continue;
    for (const [label, p] of Object.entries(i.probabilities)) points.push({ p, hit: label === i.gold });
  }
  return binned(points, binCount);
}
function topK(all2, k = 2) {
  const byField = /* @__PURE__ */ new Map();
  for (const i of all2) {
    if (!i.probabilities || i.primitive === "noul" || Object.keys(i.probabilities).length <= k) continue;
    byField.set(i.field, [...byField.get(i.field) ?? [], i]);
  }
  return [...byField.entries()].map(([field, xs]) => {
    const ranked = (i) => Object.entries(i.probabilities).sort((a, b) => b[1] - a[1]).map(([l]) => l);
    return {
      field,
      n: xs.length,
      top1: xs.filter((i) => i.label === i.gold).length / xs.length,
      topK: xs.filter((i) => ranked(i).slice(0, k).includes(i.gold)).length / xs.length
    };
  });
}
function fitGate(all2, target2 = 0.95, on = "probability") {
  const score = (i) => on === "probability" && i.probabilities ? i.probabilities[i.label] ?? i.confidence : i.confidence;
  const scored = all2.map((i) => ({ s: score(i), hit: i.label === i.gold })).sort((a, b) => b.s - a.s);
  let best = { on, target: target2, threshold: null, coverage: 0, precision: Number.NaN };
  let hits = 0;
  for (let n = 1; n <= scored.length; n += 1) {
    const current = scored[n - 1];
    if (current.hit) hits += 1;
    const next = scored[n];
    if (next && next.s === current.s) continue;
    const precision = hits / n;
    if (precision >= target2) best = { on, target: target2, threshold: current.s, coverage: n / scored.length, precision };
  }
  return best;
}
function parseRows(text) {
  return text.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
}
function signTest(a, b) {
  const n = a + b;
  if (n === 0) return 1;
  const k = Math.min(a, b);
  let tail = 0;
  let c = 1;
  for (let i = 0; i <= k; i += 1) {
    tail += c;
    c = c * (n - i) / (i + 1);
  }
  return Math.min(1, 2 * tail / 2 ** n);
}
function diff(before, after) {
  const key = (i) => `${i.field}\0${i.caseId}`;
  const prior = new Map(before.map((i) => [key(i), i]));
  const byField = /* @__PURE__ */ new Map();
  for (const a of after) {
    const b = prior.get(key(a));
    if (!b) continue;
    byField.set(a.field, [...byField.get(a.field) ?? [], { b, a }]);
  }
  return [...byField.entries()].map(([field, pairs]) => {
    const n = pairs.length;
    const right = (i) => i.label === i.gold;
    const fixed = pairs.filter(({ b, a }) => !right(b) && right(a)).length;
    const broken = pairs.filter(({ b, a }) => right(b) && !right(a)).length;
    const flipped = pairs.filter(({ b, a }) => b.label !== a.label).length;
    const beforeAcc = pairs.filter(({ b }) => right(b)).length / n;
    const afterAcc = pairs.filter(({ a }) => right(a)).length / n;
    const delta = afterAcc - beforeAcc;
    const p = signTest(fixed, broken);
    const verdict = fixed + broken === 0 ? "no change" : Math.abs(delta) >= 0.07 && p < 0.05 ? "real" : "unproven";
    return { field, n, before: beforeAcc, after: afterAcc, delta, fixed, broken, flipped, p, verdict };
  }).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
}

// packages/audit/src/cli.ts
var args = process.argv.slice(2);
if (args[0] === "diff") {
  const [before, after] = args.slice(1).filter((a) => !a.startsWith("--"));
  if (!before || !after) {
    console.error("usage: jev-audit diff <before.jsonl> <after.jsonl> [--json]");
    process.exit(2);
  }
  const load = (f) => items(parseRows(readFileSync(f, "utf8")), { requireConfidence: false });
  const fields = diff(load(before), load(after));
  if (args.includes("--json")) {
    console.log(JSON.stringify(fields, null, 2));
  } else {
    const pct2 = (x) => `${(x * 100).toFixed(1)}%`;
    console.log(
      [
        `# jev-audit diff \u2014 ${basename(before)} \u2192 ${basename(after)}`,
        "",
        "`real` needs |\u0394| \u2265 7 points **and** p < 0.05 on the fixed-vs-broken sign test. Anything else is",
        "inside the drift an unchanged baseline shows on re-run. Re-run your comparator on the same change.",
        "",
        "| field | n | before | after | \u0394 | fixed | broken | flipped | p | verdict |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
        ...fields.map(
          (d) => `| ${d.field} | ${d.n} | ${pct2(d.before)} | ${pct2(d.after)} | ${d.delta >= 0 ? "+" : ""}${(d.delta * 100).toFixed(1)} | ${d.fixed} | ${d.broken} | ${d.flipped} | ${d.p.toFixed(3)} | ${d.verdict === "real" ? "**real**" : d.verdict} |`
        )
      ].join("\n")
    );
  }
  process.exit(0);
}
var flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
var files = args.filter((a, i) => !a.startsWith("--") && !["--threshold", "--target"].includes(args[i - 1] ?? ""));
if (files.length === 0) {
  console.error("usage: jev-audit <results.jsonl ...> [--threshold 0.9] [--target 0.95] [--json]");
  process.exit(2);
}
var prefixed = (file, rows) => {
  if (files.length === 1) return rows;
  const tag = basename(file).split(".")[0];
  const re = (m) => m ? Object.fromEntries(Object.entries(m).map(([k, v]) => [`${tag}/${k}`, v])) : void 0;
  return rows.map((r) => ({ ...r, gold: re(r.gold), raw: re(r.raw), predicted: re(r.predicted), confidence: re(r.confidence) }));
};
var all = items(files.flatMap((f) => prefixed(f, parseRows(readFileSync(f, "utf8")))));
var threshold = flag("--threshold", 0.9);
var target = flag("--target", 0.95);
var report = {
  answers: all.length,
  confidentlyWrong: confidentlyWrong(all, threshold),
  calibration: calibration(all),
  probabilityCalibration: probabilityCalibration(all),
  topK: topK(all, 2),
  gates: [fitGate(all, target, "probability"), fitGate(all, target, "confidence")]
};
if (args.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}
var pct = (x) => Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "\u2014";
var out = [`# jev-audit \u2014 ${report.answers} graded answers`, ""];
out.push(`## Confidently wrong (confidence \u2265 ${threshold}) \u2014 ${report.confidentlyWrong.errors.length} cases`, "");
out.push("Read these first. A confident error is either the model's real boundary or a label that does not");
out.push("follow its own rubric. A field wrong **in one direction** is a question defect before it is a model one.", "");
if (report.confidentlyWrong.patterns.length) {
  out.push("| field | confident errors | dominant pattern | share | verdict |", "| --- | ---: | --- | ---: | --- |");
  for (const p of report.confidentlyWrong.patterns) {
    out.push(`| ${p.field} | ${p.errors} | ${p.dominant} | ${pct(p.share)} | ${p.oneDirection ? "**check the question and labels**" : "read individually"} |`);
  }
  out.push("", "| case | field | gold | answer | confidence |", "| --- | --- | --- | --- | ---: |");
  for (const e of report.confidentlyWrong.errors.slice(0, 40)) {
    out.push(`| ${e.caseId} | ${e.field} | ${e.gold} | ${e.label} | ${e.confidence.toFixed(2)} |`);
  }
} else {
  out.push("None.");
}
var calTable = (title, c) => {
  out.push("", `## ${title}`, "", `ECE **${c.ece.toFixed(3)}** \xB7 separation (right \u2212 wrong) **${c.separation.toFixed(3)}**`, "");
  out.push("| bin | n | claimed | delivered | gap |", "| --- | ---: | ---: | ---: | ---: |");
  for (const b of c.bins) {
    const gap = b.delivered - b.claimed;
    out.push(`| ${b.lo.toFixed(1)}\u2013${b.hi.toFixed(1)} | ${b.n} | ${b.claimed.toFixed(3)} | ${b.delivered.toFixed(3)} | ${gap >= 0 ? "+" : ""}${gap.toFixed(3)} |`);
  }
};
calTable("Calibration of the confidence scalar", report.calibration);
calTable("Calibration of every probability in the distribution", report.probabilityCalibration);
if (report.topK.length) {
  out.push("", "## Top-2 recall \u2014 what argmax discards", "", "Show two labels to a person. Do not hand a shortlist to another model.", "");
  out.push("| field | n | top-1 | top-2 |", "| --- | ---: | ---: | ---: |");
  for (const t of report.topK) out.push(`| ${t.field} | ${t.n} | ${pct(t.top1)} | ${pct(t.topK)} |`);
}
out.push("", `## Gate for ${pct(target)} precision`, "", "| gating on | threshold | coverage | precision |", "| --- | ---: | ---: | ---: |");
for (const g of report.gates) {
  out.push(`| ${g.on} | ${g.threshold === null ? "unreachable" : g.threshold.toFixed(3)} | ${pct(g.coverage)} | ${pct(g.precision)} |`);
}
out.push("", "Fit the gate on held-out cases. Coverage measured on your own hand-written cases is an upper bound.");
console.log(out.join("\n"));
