function items(rows, opts = {}) {
  const requireConfidence = opts.requireConfidence ?? true;
  const out = [];
  for (const row of rows) {
    for (const [field, listed] of Object.entries(row.gold ?? {})) {
      const answer = row.raw?.[field];
      const given = answer?.type === "choice" ? answer.choice : row.predicted?.[field] ?? row.decision?.[field];
      const gold = Array.isArray(listed) ? listed.includes(given) ? String(given) : String(listed[0]) : listed;
      if (answer?.type === "noul") {
        out.push({
          caseId: row.caseId,
          field,
          gold,
          label: answer.noul > 0.5 ? "yes" : "no",
          confidence: Math.max(answer.noul, 1 - answer.noul),
          probabilities: { yes: answer.noul, no: 1 - answer.noul },
          primitive: "noul"
        });
      } else if (answer?.type === "choice") {
        out.push({ caseId: row.caseId, field, gold, label: answer.choice, confidence: answer.confidence, probabilities: answer.probabilities, primitive: "choice" });
      } else if (answer?.type === "score") {
        const name = (index2) => {
          const text = answer.legend?.[index2];
          if (text === void 0) return index2;
          const colon = text.indexOf(":");
          return colon > 0 ? text.slice(0, colon).trim() : text.trim();
        };
        const levels = Object.keys(answer.probabilities).length;
        const index = String(Math.min(levels - 1, Math.max(0, Math.round(answer.score))));
        out.push({
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
          out.push({ caseId: row.caseId, field, gold, label, confidence: confidence ?? Number.NaN, primitive: "derived" });
        }
      }
    }
  }
  return out;
}
function confidentlyWrong(all, threshold = 0.9) {
  const errors = all.filter((i) => i.label !== i.gold && i.confidence >= threshold).map((i) => ({ ...i, direction: `${i.gold} -> ${i.label}` })).sort((a, b) => b.confidence - a.confidence);
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
function calibration(all, binCount = 10) {
  return binned(all.map((i) => ({ p: i.confidence, hit: i.label === i.gold })), binCount);
}
function probabilityCalibration(all, binCount = 10) {
  const points = [];
  for (const i of all) {
    if (!i.probabilities) continue;
    for (const [label, p] of Object.entries(i.probabilities)) points.push({ p, hit: label === i.gold });
  }
  return binned(points, binCount);
}
function topLabelCalibration(all, binCount = 10) {
  return binned(all.map((i) => ({ p: i.probabilities?.[i.label] ?? i.confidence, hit: i.label === i.gold })), binCount);
}
function auroc(all, on = "probability") {
  const s = (i) => on === "probability" ? i.probabilities?.[i.label] ?? i.confidence : i.confidence;
  const right = all.filter((i) => i.label === i.gold).map(s);
  const wrong = all.filter((i) => i.label !== i.gold).map(s);
  if (!right.length || !wrong.length) return Number.NaN;
  let wins = 0;
  for (const r of right) for (const w of wrong) wins += r > w ? 1 : r === w ? 0.5 : 0;
  return wins / (right.length * wrong.length);
}
function topK(all, k = 2) {
  const byField = /* @__PURE__ */ new Map();
  for (const i of all) {
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
function fitGate(all, target = 0.95, on = "probability") {
  const score = (i) => on === "probability" && i.probabilities ? i.probabilities[i.label] ?? i.confidence : i.confidence;
  const scored = all.map((i) => ({ s: score(i), hit: i.label === i.gold })).sort((a, b) => b.s - a.s);
  const noErrors = scored.every((x) => x.hit);
  let best = { on, target, n: scored.length, threshold: null, coverage: 0, precision: Number.NaN, lower: Number.NaN, noErrors };
  let hits = 0;
  for (let n = 1; n <= scored.length; n += 1) {
    const current = scored[n - 1];
    if (current.hit) hits += 1;
    const next = scored[n];
    if (next && next.s === current.s) continue;
    const precision = hits / n;
    if (precision >= target) best = { ...best, threshold: current.s, coverage: n / scored.length, precision, lower: wilsonLower(hits, n) };
  }
  return best;
}
function fitGates(all, target = 0.95, on = "probability") {
  const by = /* @__PURE__ */ new Map();
  for (const i of all) by.set(i.field, [...by.get(i.field) ?? [], i]);
  return [...by].map(([field, xs]) => ({ ...fitGate(xs, target, on), field }));
}
function applyGates(all, gates) {
  return gates.map((g) => {
    const xs = all.filter((i) => i.field === g.field);
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
const errored = (rows) => rows.filter((r) => r.error);
function goldMismatches(before, after) {
  const prior = new Map(before.map((r) => [r.caseId, JSON.stringify(r.gold ?? {})]));
  return after.filter((r) => prior.has(r.caseId) && prior.get(r.caseId) !== JSON.stringify(r.gold ?? {})).map((r) => r.caseId);
}
function regold(rows, cases) {
  const gold = new Map(cases.map((c) => [c.id, c.gold ?? {}]));
  return rows.filter((r) => gold.has(r.caseId)).map((r) => ({ ...r, gold: gold.get(r.caseId) }));
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
const isMapRow = (row) => row.decision !== void 0 || row.grades !== void 0 || row.arm === "jev-map";
function gradeDecision(pred, gold) {
  if (pred === void 0 || pred === null || pred === "abstain" || Array.isArray(pred) && pred.length === 0) return "abstain";
  const p = Array.isArray(pred) ? pred[0] : pred;
  return (Array.isArray(gold) ? gold.includes(p) : p === gold) ? "right" : "wrong";
}
function decisions(rows) {
  const out = [];
  for (const row of rows) {
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
      out.push({ caseId: row.caseId, field, gold, decision, grade, weakest });
    }
  }
  return out;
}
function decisionSummary(all) {
  const by = /* @__PURE__ */ new Map();
  for (const d of all) by.set(d.field, [...by.get(d.field) ?? [], d]);
  return [...by].map(([field, ds]) => {
    const c = (g) => ds.filter((d) => d.grade === g).length;
    const n = ds.length;
    return { field, n, right: c("right"), wrong: c("wrong"), abstain: c("abstain"), accuracy: c("right") / n, wrongRate: c("wrong") / n, coverage: (c("right") + c("wrong")) / n };
  });
}
function weakLinks(all) {
  const by = /* @__PURE__ */ new Map();
  for (const d of all) {
    if (!d.weakest || d.grade === "abstain") continue;
    const w = by.get(d.weakest.question) ?? { question: d.weakest.question, wrong: 0, right: 0 };
    w[d.grade] += 1;
    by.set(d.weakest.question, w);
  }
  return [...by.values()].sort((a, b) => b.wrong - a.wrong || a.right - b.right);
}
function fitDecisionGate(all, target = 0.95) {
  const decided = all.filter((d) => d.grade !== "abstain").map((d) => ({ s: d.weakest?.certainty ?? 1, hit: d.grade === "right" })).sort((a, b) => b.s - a.s);
  const wrongTotal = decided.filter((d) => !d.hit).length;
  const rightTotal = decided.length - wrongTotal;
  let best = { target, threshold: null, coverage: 0, precision: Number.NaN, wrongRemoved: wrongTotal, rightLost: rightTotal, lower: Number.NaN, noErrors: wrongTotal === 0 };
  if (wrongTotal === 0) return { ...best, coverage: decided.length / all.length, precision: decided.length ? 1 : Number.NaN, wrongRemoved: 0, rightLost: 0, lower: wilsonLower(decided.length, decided.length) };
  let hits = 0;
  for (let n = 1; n <= decided.length; n += 1) {
    const current = decided[n - 1];
    if (current.hit) hits += 1;
    const next = decided[n];
    if (next && next.s === current.s) continue;
    const precision = hits / n;
    if (precision >= target) best = { ...best, threshold: current.s, coverage: n / all.length, precision, wrongRemoved: wrongTotal - (n - hits), rightLost: rightTotal - hits, lower: wilsonLower(hits, n) };
  }
  return best;
}
export {
  answerCertainty,
  applyGates,
  auroc,
  calibration,
  confidentlyWrong,
  decisionSummary,
  decisions,
  diff,
  errored,
  fitDecisionGate,
  fitGate,
  fitGates,
  goldMismatches,
  inFitHalf,
  isMapRow,
  items,
  parseRows,
  probabilityCalibration,
  regold,
  topK,
  topLabelCalibration,
  weakLinks,
  wilsonLower
};
