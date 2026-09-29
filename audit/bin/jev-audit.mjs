#!/usr/bin/env node
// Generated from audit/src by scripts/build-audit.mjs. Do not edit: change audit/src and rebuild.

// audit/src/cli.ts
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";

// audit/src/index.ts
function items(rows2, opts = {}) {
  const requireConfidence = opts.requireConfidence ?? true;
  const out2 = [];
  for (const row of rows2) {
    for (const [field, listed] of Object.entries(row.gold ?? {})) {
      const answer = row.raw?.[field];
      const given = answer?.type === "choice" ? answer.choice : row.predicted?.[field] ?? row.decision?.[field];
      const gold = Array.isArray(listed) ? listed.includes(given) ? String(given) : String(listed[0]) : listed;
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
        const decided = row.decision?.[field];
        const label = row.predicted?.[field] ?? (typeof decided === "string" ? decided : void 0);
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
function topLabelCalibration(all2, binCount = 10) {
  return binned(all2.map((i) => ({ p: i.probabilities?.[i.label] ?? i.confidence, hit: i.label === i.gold })), binCount);
}
function auroc(all2, on = "probability") {
  const s = (i) => on === "probability" ? i.probabilities?.[i.label] ?? i.confidence : i.confidence;
  const right = all2.filter((i) => i.label === i.gold).map(s);
  const wrong = all2.filter((i) => i.label !== i.gold).map(s);
  if (!right.length || !wrong.length) return Number.NaN;
  let wins = 0;
  for (const r of right) for (const w of wrong) wins += r > w ? 1 : r === w ? 0.5 : 0;
  return wins / (right.length * wrong.length);
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
function wilsonLower(k, n, z = 1.96) {
  if (n === 0) return Number.NaN;
  const p = k / n;
  const d = 1 + z * z / n;
  return (p + z * z / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
}
function fitGate(all2, target2 = 0.95, on = "probability") {
  const score = (i) => on === "probability" && i.probabilities ? i.probabilities[i.label] ?? i.confidence : i.confidence;
  const scored = all2.map((i) => ({ s: score(i), hit: i.label === i.gold })).sort((a, b) => b.s - a.s);
  const noErrors = scored.every((x) => x.hit);
  let best = { on, target: target2, n: scored.length, threshold: null, coverage: 0, precision: Number.NaN, lower: Number.NaN, noErrors };
  let hits = 0;
  for (let n = 1; n <= scored.length; n += 1) {
    const current = scored[n - 1];
    if (current.hit) hits += 1;
    const next = scored[n];
    if (next && next.s === current.s) continue;
    const precision = hits / n;
    if (precision >= target2) best = { ...best, threshold: current.s, coverage: n / scored.length, precision, lower: wilsonLower(hits, n) };
  }
  return best;
}
function fitGates(all2, target2 = 0.95, on = "probability") {
  const by = /* @__PURE__ */ new Map();
  for (const i of all2) by.set(i.field, [...by.get(i.field) ?? [], i]);
  return [...by].map(([field, xs]) => ({ ...fitGate(xs, target2, on), field }));
}
function applyGates(all2, gates2) {
  return gates2.map((g) => {
    const xs = all2.filter((i) => i.field === g.field);
    const s = (i) => g.on === "probability" && i.probabilities ? i.probabilities[i.label] ?? i.confidence : i.confidence;
    const kept = g.noErrors ? xs : g.threshold === null ? [] : xs.filter((i) => s(i) >= g.threshold);
    return { field: g.field, n: xs.length, coverage: xs.length ? kept.length / xs.length : Number.NaN, precision: kept.length ? kept.filter((i) => i.label === i.gold).length / kept.length : Number.NaN };
  });
}
function inFitHalf(caseId, fraction = 0.5) {
  let h = 2166136261;
  for (let i = 0; i < caseId.length; i += 1) h = Math.imul(h ^ caseId.charCodeAt(i), 16777619);
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 2 ** 32 < fraction;
}
var errored = (rows2) => rows2.filter((r) => r.error);
function goldMismatches(before, after) {
  const prior = new Map(before.map((r) => [r.caseId, JSON.stringify(r.gold ?? {})]));
  return after.filter((r) => prior.has(r.caseId) && prior.get(r.caseId) !== JSON.stringify(r.gold ?? {})).map((r) => r.caseId);
}
function regold(rows2, cases) {
  const gold = new Map(cases.map((c) => [c.id, c.gold ?? {}]));
  return rows2.filter((r) => gold.has(r.caseId)).map((r) => ({ ...r, gold: gold.get(r.caseId) }));
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
function answerCertainty(answer) {
  if (answer.type === "noul") return Math.max(answer.noul, 1 - answer.noul);
  if (answer.type === "choice") return answer.probabilities?.[answer.choice] ?? answer.confidence;
  const ps = Object.values(answer.probabilities ?? {});
  return ps.length ? Math.max(...ps) : answer.confidence;
}
var isMapRow = (row) => row.decision !== void 0 || row.grades !== void 0 || row.arm === "jev-map";
function gradeDecision(pred, gold) {
  if (pred === void 0 || pred === null || pred === "abstain" || Array.isArray(pred) && pred.length === 0) return "abstain";
  const p = Array.isArray(pred) ? pred[0] : pred;
  return (Array.isArray(gold) ? gold.includes(p) : p === gold) ? "right" : "wrong";
}
function decisions(rows2) {
  const out2 = [];
  for (const row of rows2) {
    if (row.error) continue;
    let weakest = null;
    for (const [question, answer] of Object.entries(row.raw ?? {})) {
      if (!answer) continue;
      const certainty = answerCertainty(answer);
      if (!weakest || certainty < weakest.certainty) weakest = { question, certainty };
    }
    for (const [field, gold] of Object.entries(row.gold ?? {})) {
      const decision = row.decision?.[field];
      const grade = row.grades?.[field] ?? gradeDecision(decision, gold);
      out2.push({ caseId: row.caseId, field, gold, decision, grade, weakest });
    }
  }
  return out2;
}
function decisionSummary(all2) {
  const by = /* @__PURE__ */ new Map();
  for (const d of all2) by.set(d.field, [...by.get(d.field) ?? [], d]);
  return [...by].map(([field, ds]) => {
    const c = (g) => ds.filter((d) => d.grade === g).length;
    const n = ds.length;
    return { field, n, right: c("right"), wrong: c("wrong"), abstain: c("abstain"), accuracy: c("right") / n, wrongRate: c("wrong") / n, coverage: (c("right") + c("wrong")) / n };
  });
}
function weakLinks(all2) {
  const by = /* @__PURE__ */ new Map();
  for (const d of all2) {
    if (!d.weakest || d.grade === "abstain") continue;
    const w = by.get(d.weakest.question) ?? { question: d.weakest.question, wrong: 0, right: 0 };
    w[d.grade] += 1;
    by.set(d.weakest.question, w);
  }
  return [...by.values()].sort((a, b) => b.wrong - a.wrong || a.right - b.right);
}
function fitDecisionGate(all2, target2 = 0.95) {
  const decided = all2.filter((d) => d.grade !== "abstain").map((d) => ({ s: d.weakest?.certainty ?? 1, hit: d.grade === "right" })).sort((a, b) => b.s - a.s);
  const wrongTotal = decided.filter((d) => !d.hit).length;
  const rightTotal = decided.length - wrongTotal;
  let best = { target: target2, threshold: null, coverage: 0, precision: Number.NaN, wrongRemoved: wrongTotal, rightLost: rightTotal, lower: Number.NaN, noErrors: wrongTotal === 0 };
  if (wrongTotal === 0) return { ...best, coverage: decided.length / all2.length, precision: decided.length ? 1 : Number.NaN, wrongRemoved: 0, rightLost: 0, lower: wilsonLower(decided.length, decided.length) };
  let hits = 0;
  for (let n = 1; n <= decided.length; n += 1) {
    const current = decided[n - 1];
    if (current.hit) hits += 1;
    const next = decided[n];
    if (next && next.s === current.s) continue;
    const precision = hits / n;
    if (precision >= target2) best = { ...best, threshold: current.s, coverage: n / all2.length, precision, wrongRemoved: wrongTotal - (n - hits), rightLost: rightTotal - hits, lower: wilsonLower(hits, n) };
  }
  return best;
}

// audit/src/cli.ts
var HELP = `usage:
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
var fail = (msg, code = 2) => {
  console.error(`error: ${msg}
(jev-audit --help lists every option)`);
  process.exit(code);
};
var pct = (x) => Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "\u2014";
var num = (x, d = 3) => Number.isFinite(x) ? x.toFixed(d) : "\u2014";
var load = (f) => {
  try {
    return parseRows(readFileSync(f, "utf8"));
  } catch (err) {
    return fail(`${f}: ${err.message}`);
  }
};
var argv = process.argv.slice(2);
var isDiff = argv[0] === "diff";
var parsed;
try {
  parsed = parseArgs({
    args: isDiff ? argv.slice(1) : argv,
    allowPositionals: true,
    options: {
      target: { type: "string" },
      threshold: { type: "string" },
      holdout: { type: "string" },
      gold: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" }
    }
  });
} catch (err) {
  fail(err.message);
}
var { values: o, positionals: files } = parsed;
if (o.help) {
  console.log(HELP);
  process.exit(0);
}
var prob = (name, v, fallback) => {
  if (v === void 0) return fallback;
  const n = Number(v);
  if (!(n > 0 && n < 1) && !(name === "--target" && n === 1)) fail(`${name} must be between 0 and 1 (got ${v})`);
  return n;
};
if (isDiff) {
  if (files.length !== 2) fail("diff takes two files: jev-audit diff <before.jsonl> <after.jsonl>");
  const [before, after] = files;
  let b = load(before);
  let a = load(after);
  if (o.gold) {
    const suite = JSON.parse(readFileSync(o.gold, "utf8"));
    b = regold(b, suite.cases);
    a = regold(a, suite.cases);
  } else {
    const mismatched = goldMismatches(b, a);
    if (mismatched.length) {
      fail(`the two runs have different gold labels for ${mismatched.length} case${mismatched.length > 1 ? "s" : ""} (${mismatched.slice(0, 5).join(", ")}${mismatched.length > 5 ? ", \u2026" : ""}).
A corrected label would show up as a model change. Re-grade both on one suite: --gold <suite.json>`, 1);
    }
  }
  const errs2 = [errored(b).length, errored(a).length];
  const fields = diff(items(b, { requireConfidence: false }), items(a, { requireConfidence: false }));
  if (o.json) {
    console.log(JSON.stringify({ errored: { before: errs2[0], after: errs2[1] }, fields }, null, 2));
    process.exit(0);
  }
  console.log(
    [
      `# jev-audit diff \u2014 ${basename(before)} \u2192 ${basename(after)}${o.gold ? ` (graded on ${basename(o.gold)})` : ""}`,
      "",
      "`real` needs |\u0394| \u2265 7 points **and** p < 0.05 on the fixed-vs-broken sign test. Anything else is",
      "inside the drift an unchanged baseline shows on re-run. The test treats cases as independent: to",
      "compare two ways of writing a map, run several maps of each and compare maps, not cases.",
      ...errs2[0] || errs2[1] ? ["", `**Errored rows, not compared:** ${errs2[0]} before, ${errs2[1]} after.`] : [],
      "",
      "| field | n | before | after | \u0394 | fixed | broken | flipped | p | verdict |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
      ...fields.map(
        (d) => `| ${d.field} | ${d.n} | ${pct(d.before)} | ${pct(d.after)} | ${d.delta >= 0 ? "+" : ""}${(d.delta * 100).toFixed(1)} | ${d.fixed} | ${d.broken} | ${d.flipped} | ${d.p.toFixed(3)} | ${d.verdict === "real" ? "**real**" : d.verdict} |`
      )
    ].join("\n")
  );
  process.exit(0);
}
if (files.length === 0) fail("no results file");
var threshold = prob("--threshold", o.threshold, 0.9);
var target = prob("--target", o.target, 0.95);
var holdout = o.holdout === void 0 ? void 0 : prob("--holdout", o.holdout, 0.5);
var prefixed = (file, rows2) => {
  if (files.length === 1) return rows2;
  const tag = basename(file).split(".")[0];
  const re = (m) => m ? Object.fromEntries(Object.entries(m).map(([k, v]) => [`${tag}/${k}`, v])) : void 0;
  return rows2.map((r) => ({ ...r, gold: re(r.gold), raw: re(r.raw), predicted: re(r.predicted), confidence: re(r.confidence), decision: re(r.decision), grades: re(r.grades) }));
};
var rows = files.flatMap((f) => prefixed(f, load(f)));
var errs = errored(rows);
var out = [];
if (errs.length) {
  out.push(`> **${errs.length} of ${rows.length} rows errored and are not graded.** First: ${errs[0].caseId}: ${String(errs[0].error).slice(0, 160)}`, "");
}
if (errs.length === rows.length) {
  console.error(`every row errored (${rows.length}); nothing to audit. First error: ${String(errs[0]?.error ?? "").slice(0, 300)}`);
  process.exit(1);
}
var fitSide = (caseId) => holdout === void 0 || inFitHalf(caseId, 1 - holdout);
var judgeSide = (caseId) => holdout === void 0 || !inFitHalf(caseId, 1 - holdout);
if (rows.some(isMapRow)) {
  const ds = decisions(rows);
  const gate = fitDecisionGate(ds.filter((d) => fitSide(d.caseId)), target);
  const judged = holdout === void 0 ? void 0 : (() => {
    const held = ds.filter((d) => judgeSide(d.caseId) && d.grade !== "abstain");
    const kept = gate.threshold === null && !gate.noErrors ? [] : held.filter((d) => (d.weakest?.certainty ?? 1) >= (gate.threshold ?? 0));
    return { n: held.length, coverage: held.length ? kept.length / held.length : Number.NaN, precision: kept.length ? kept.filter((d) => d.grade === "right").length / kept.length : Number.NaN };
  })();
  const report2 = { decisions: ds.length, errored: errs.length, fields: decisionSummary(ds), weakLinks: weakLinks(ds), gate, heldOut: judged, wrong: ds.filter((d) => d.grade === "wrong") };
  if (o.json) {
    console.log(JSON.stringify(report2, null, 2));
    process.exit(0);
  }
  const show = (v) => typeof v === "string" ? v : JSON.stringify(v);
  out.unshift(`# jev-audit \u2014 map run, ${report2.decisions} graded decisions${errs.length ? `, ${errs.length} errored` : ""}`, "");
  out.push("| decision | n | right | wrong | abstain | accuracy | coverage |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const f of report2.fields) out.push(`| ${f.field} | ${f.n} | ${f.right} | ${f.wrong} | ${f.abstain} | ${pct(f.accuracy)} | ${pct(f.coverage)} |`);
  out.push("", 'Accuracy counts an abstention as not right; "wrong" counts only decisions made and missed.');
  out.push("", `## Wrong decisions \u2014 ${report2.wrong.length}`, "");
  out.push("Read these first. The weakest answer is the least certain read behind the decision (over every");
  out.push("question the map asked, whether or not `decide()` used it): the likeliest culprit when it is low.");
  out.push("A wrong decision whose weakest answer is still sure came from the code in `decide()` or from a");
  out.push("question that is confidently wrong, and a gate cannot catch it.", "");
  if (report2.wrong.length) {
    out.push("| case | decision | gold | map decided | weakest answer | certainty |", "| --- | --- | --- | --- | --- | ---: |");
    for (const d of report2.wrong.slice(0, 40)) {
      out.push(`| ${d.caseId} | ${d.field} | ${show(d.gold)} | ${show(d.decision)} | ${d.weakest?.question ?? "\u2014"} | ${d.weakest ? d.weakest.certainty.toFixed(2) : "\u2014"} |`);
    }
  } else out.push("None.");
  if (report2.weakLinks.some((w) => w.wrong)) {
    out.push("", "## Weak links", "", "How often each question was the least certain answer behind a wrong or a right decision.", "");
    out.push("| question | in wrong decisions | in right decisions |", "| --- | ---: | ---: |");
    for (const w of report2.weakLinks.filter((w2) => w2.wrong).slice(0, 15)) out.push(`| ${w.question} | ${w.wrong} | ${w.right} |`);
  }
  const g = report2.gate;
  out.push("", `## Gate for ${pct(target)} precision, on the weakest answer${holdout === void 0 ? "" : ` (fitted on ${pct(1 - holdout)} of cases)`}`, "");
  if (g.noErrors) {
    out.push("No wrong decisions to remove: no gate is needed on these cases. That is not evidence one is");
    out.push("unnecessary in production; keep the map's own abstain rules.");
  } else {
    out.push("| threshold | coverage | precision | 95% lower bound | wrong decisions removed | right decisions lost |", "| ---: | ---: | ---: | ---: | ---: | ---: |");
    out.push(`| ${g.threshold === null ? "unreachable" : g.threshold.toFixed(3)} | ${pct(g.coverage)} | ${pct(g.precision)} | ${pct(g.lower)} | ${g.wrongRemoved} | ${g.rightLost} |`);
    out.push("", 'In `decide()`, return "abstain" when any answer the decision uses is less certain than the threshold.');
  }
  if (judged) out.push("", `**On the held-out ${pct(holdout)}** (${judged.n} decisions): coverage ${pct(judged.coverage)}, precision ${pct(judged.precision)}.`);
  else out.push("Fitted and judged on the same cases, so an upper bound: add `--holdout 0.5` to judge it on unseen cases.");
  console.log(out.join("\n"));
  process.exit(0);
}
var all = items(rows);
var fitItems = all.filter((i) => fitSide(i.caseId));
var gates = fitGates(fitItems, target, "probability");
var report = {
  answers: all.length,
  errored: errs.length,
  confidentlyWrong: confidentlyWrong(all, threshold),
  topLabel: { calibration: topLabelCalibration(all), auroc: auroc(all, "probability"), aurocScalar: auroc(all, "confidence") },
  calibration: calibration(all),
  probabilityCalibration: probabilityCalibration(all),
  topK: topK(all, 2),
  gates,
  pooledGates: [fitGate(fitItems, target, "probability"), fitGate(fitItems, target, "confidence")],
  heldOut: holdout === void 0 ? void 0 : applyGates(all.filter((i) => judgeSide(i.caseId)), gates)
};
if (o.json) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}
out.unshift(`# jev-audit \u2014 ${report.answers} graded answers${errs.length ? `, ${errs.length} errored rows` : ""}`, "");
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
var calTable = (title, c, note) => {
  out.push("", `## ${title}`, "", note, "", `ECE **${num(c.ece)}** \xB7 separation (right \u2212 wrong) **${num(c.separation)}**`, "");
  out.push("| bin | n | claimed | delivered | gap |", "| --- | ---: | ---: | ---: | ---: |");
  for (const b of c.bins) {
    const gap = b.delivered - b.claimed;
    out.push(`| ${b.lo.toFixed(1)}\u2013${b.hi.toFixed(1)} | ${b.n} | ${b.claimed.toFixed(3)} | ${b.delivered.toFixed(3)} | ${gap >= 0 ? "+" : ""}${gap.toFixed(3)} |`);
  }
};
calTable(
  "Calibration of the top label's probability \u2014 what a gate reads",
  report.topLabel.calibration,
  `AUROC (how well it ranks right answers above wrong ones) **${num(report.topLabel.auroc)}**, against **${num(report.topLabel.aurocScalar)}** for the confidence scalar. A gate fitted on labelled cases depends on the ranking; calibration matters when you read the number as a probability. Bins with a handful of answers are noise.`
);
calTable("Calibration of the confidence scalar", report.calibration, "Positive gaps mean under-confident: the answer is right more often than it claims.");
calTable("Calibration of every probability in the distribution", report.probabilityCalibration, "Pooled over every label, chosen or not. Near-zero probabilities of unchosen labels dominate the pool and flatter the ECE: use the top-label table for gating.");
if (report.topK.length) {
  out.push("", "## Top-2 recall \u2014 what argmax discards", "", "Show two labels to a person. Do not hand a shortlist to another model.", "");
  out.push("| field | n | top-1 | top-2 |", "| --- | ---: | ---: | ---: |");
  for (const t of report.topK) out.push(`| ${t.field} | ${t.n} | ${pct(t.top1)} | ${pct(t.topK)} |`);
}
out.push("", `## Gates for ${pct(target)} precision, one per question, on the top label's probability${holdout === void 0 ? "" : ` (fitted on ${pct(1 - holdout)} of cases)`}`, "");
out.push("| question | n | threshold | coverage | precision | 95% lower bound |", "| --- | ---: | ---: | ---: | ---: | ---: |");
for (const g of report.gates) {
  const t = g.noErrors ? "no errors to fit" : g.threshold === null ? "unreachable" : g.threshold.toFixed(3);
  out.push(`| ${g.field} | ${g.n} | ${t} | ${pct(g.coverage)} | ${pct(g.precision)} | ${pct(g.lower)} |`);
}
out.push("", '"no errors to fit": no wrong answers on these cases, so no threshold can be fitted. That says little about', "unseen cases at ~30 per question: check with `--holdout`. Pooled over every question, for reference:", "");
out.push("| gating on | threshold | coverage | precision |", "| --- | ---: | ---: | ---: |");
for (const g of report.pooledGates) out.push(`| ${g.on} | ${g.threshold === null ? "unreachable" : g.threshold.toFixed(3)} | ${pct(g.coverage)} | ${pct(g.precision)} |`);
if (report.heldOut) {
  out.push("", `### The same gates on the held-out ${pct(holdout)}`, "", "| question | n | coverage | precision |", "| --- | ---: | ---: | ---: |");
  for (const h of report.heldOut) out.push(`| ${h.field} | ${h.n} | ${pct(h.coverage)} | ${pct(h.precision)} |`);
} else {
  out.push("", "Fitted and judged on the same cases, so an upper bound: add `--holdout 0.5` to judge them on unseen cases.");
}
console.log(out.join("\n"));
