/**
 * Offline audits for Jev eval results.
 *
 * Every function here runs on results you have already recorded — no model calls, no API key. Each
 * one exists because it found something real in a 57-suite study, and none of them lint question
 * text: a static checker over the design laws was measured at 0 useful fixes out of 7, while the
 * outcome-based confidently-wrong queue found 7 real defects out of 7. Read outcomes, not prose.
 *
 * Input is one JSON object per case:
 *
 *   { "caseId": "c1", "gold": { "verdict": "block" }, "raw": { "verdict": <Jev answer> } }
 *
 * where a Jev answer is the object the API returns for that question. Fields you derive in code can
 * be supplied as `predicted` and `confidence` maps instead of `raw`.
 */

export type NoulAnswer = { type: 'noul'; noul: number };
export type ChoiceAnswer = { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> };
/** `legend` maps a level index ("0", "1") to that level's criterion text; `probabilities` is keyed by index. */
export type ScoreAnswer = {
  type: 'score';
  score: number;
  confidence: number;
  legend?: Record<string, string>;
  probabilities: Record<string, number>;
};
export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export type Row = {
  caseId: string;
  gold: Record<string, string>;
  raw?: Record<string, Answer | undefined>;
  predicted?: Record<string, string | undefined>;
  confidence?: Record<string, number | undefined>;
  /** A whole-map run (`jev-run --map`): the map's decision per gold field, and its grade. */
  decision?: Record<string, unknown>;
  grades?: Record<string, string>;
  error?: string;
  arm?: string;
};

/** One graded answer, whatever primitive produced it. */
export type Item = {
  caseId: string;
  field: string;
  gold: string;
  label: string;
  /** the scalar the API reports — systematically under-confident, see `calibration` */
  confidence: number;
  /** the full distribution, when the primitive has one */
  probabilities?: Record<string, number>;
  primitive: 'noul' | 'choice' | 'score' | 'derived';
};

/** Flatten rows into one graded item per (case, field). A `yes`/`no` gold reads a Noul at 0.5. */
export function items(rows: Row[], opts: { requireConfidence?: boolean } = {}): Item[] {
  const requireConfidence = opts.requireConfidence ?? true;
  const out: Item[] = [];
  for (const row of rows) {
    for (const [field, listed] of Object.entries(row.gold ?? {})) {
      const answer = row.raw?.[field];
      // A gold may list several acceptable labels: grade against the one the answer gave, if listed.
      const given = answer?.type === 'choice' ? answer.choice : row.predicted?.[field] ?? row.decision?.[field];
      const gold = Array.isArray(listed) ? (listed.includes(given) ? String(given) : String(listed[0])) : listed;
      if (answer?.type === 'noul') {
        out.push({
          caseId: row.caseId,
          field,
          gold,
          label: answer.noul > 0.5 ? 'yes' : 'no',
          confidence: Math.max(answer.noul, 1 - answer.noul),
          probabilities: { yes: answer.noul, no: 1 - answer.noul },
          primitive: 'noul',
        });
      } else if (answer?.type === 'choice') {
        out.push({ caseId: row.caseId, field, gold, label: answer.choice, confidence: answer.confidence, probabilities: answer.probabilities, primitive: 'choice' });
      } else if (answer?.type === 'score') {
        // Score levels come back as indices. Grade the way the study did — round `score` — and name
        // each level from its legend: the text before the first colon when the rubric is written
        // "name: description", otherwise the whole criterion. Probabilities are re-keyed the same way.
        const name = (index: string) => {
          const text = answer.legend?.[index];
          if (text === undefined) return index;
          const colon = text.indexOf(':');
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
          primitive: 'score',
        });
      } else {
        // A map run's decision reads like a derived field with no confidence: usable for `diff`.
        const decided = row.decision?.[field];
        const label = row.predicted?.[field] ?? (typeof decided === 'string' ? decided : undefined);
        const confidence = row.confidence?.[field];
        // A comparator arm (an LLM) reports labels with no confidence: usable for `diff`, not for
        // calibration or gates, so it is only admitted when the caller says confidence is not needed.
        if (label !== undefined && (confidence !== undefined || !requireConfidence)) {
          out.push({ caseId: row.caseId, field, gold, label, confidence: confidence ?? Number.NaN, primitive: 'derived' });
        }
      }
    }
  }
  return out;
}

export type ConfidentError = Item & { direction: string };

export type FieldPattern = {
  field: string;
  errors: number;
  /** the most common gold -> predicted pair among the confident errors */
  dominant: string;
  /** share of the field's confident errors that follow the dominant pair */
  share: number;
  /**
   * True when three or more confident errors mostly run one way. In the study behind this package,
   * this was a defect in the question or the labels — not the model — six times out of seven: a
   * question broader than its labels, or a label answering a different question from the one written.
   */
  oneDirection: boolean;
};

/**
 * Every case the model got wrong while sure. Confidence tracks ambiguity, so a confident error is
 * either the model's real boundary or a label that does not follow its own rubric. Both deserve a
 * human minute, and this list costs nothing because the run already happened.
 */
export function confidentlyWrong(all: Item[], threshold = 0.9): { errors: ConfidentError[]; patterns: FieldPattern[] } {
  const errors = all
    .filter((i) => i.label !== i.gold && i.confidence >= threshold)
    .map((i) => ({ ...i, direction: `${i.gold} -> ${i.label}` }))
    .sort((a, b) => b.confidence - a.confidence);

  const byField = new Map<string, ConfidentError[]>();
  for (const e of errors) byField.set(e.field, [...(byField.get(e.field) ?? []), e]);

  const patterns: FieldPattern[] = [...byField.entries()].map(([field, es]) => {
    const counts = new Map<string, number>();
    for (const e of es) counts.set(e.direction, (counts.get(e.direction) ?? 0) + 1);
    const [dominant, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
    const share = n / es.length;
    return { field, errors: es.length, dominant, share, oneDirection: es.length >= 3 && share >= 0.8 };
  });

  return { errors, patterns: patterns.sort((a, b) => b.errors - a.errors) };
}

export type Bin = { lo: number; hi: number; n: number; claimed: number; delivered: number };

export type Calibration = {
  answers: number;
  ece: number;
  /** mean confidence when right minus mean confidence when wrong — what a gate lives on */
  separation: number;
  bins: Bin[];
};

function binned(points: { p: number; hit: boolean }[], binCount: number): Calibration & { answers: number } {
  const bins: Bin[] = [];
  let ece = 0;
  for (let i = 0; i < binCount; i += 1) {
    const lo = i / binCount;
    const hi = (i + 1) / binCount;
    const inBin = points.filter((x) => x.p >= lo && (i === binCount - 1 ? x.p <= hi : x.p < hi));
    if (inBin.length === 0) continue;
    const claimed = inBin.reduce((a, x) => a + x.p, 0) / inBin.length;
    const delivered = inBin.filter((x) => x.hit).length / inBin.length;
    bins.push({ lo, hi, n: inBin.length, claimed, delivered });
    ece += (inBin.length / points.length) * Math.abs(claimed - delivered);
  }
  const hits = points.filter((x) => x.hit);
  const misses = points.filter((x) => !x.hit);
  const mean = (xs: { p: number }[]) => (xs.length ? xs.reduce((a, x) => a + x.p, 0) / xs.length : Number.NaN);
  return { answers: points.length, ece, separation: mean(hits) - mean(misses), bins };
}

/**
 * Calibration of the **confidence scalar**. Across 5,227 answers in the study it was mostly
 * under-confident — a 0.2–0.3 claim delivered 55% — so a default 0.9 gate on it discards answers that
 * are mostly right. It is not the top label's probability (a right answer can carry 0.000), and single
 * suites can differ: read your own bins. Gate on the probability instead (`topLabelCalibration`).
 */
export function calibration(all: Item[], binCount = 10): Calibration {
  return binned(all.map((i) => ({ p: i.confidence, hit: i.label === i.gold })), binCount);
}

/**
 * Calibration of **every probability in every distribution**, not just the winning label. Pooled over
 * 5,227 answers it tracked the diagonal within about four points where the scalar was off by up to 29.
 * Caution: the many near-zero probabilities of labels nobody chose dominate this pool and flatter the
 * ECE. For gating, read `topLabelCalibration` and `auroc`, which only look at the label acted on.
 */
export function probabilityCalibration(all: Item[], binCount = 10): Calibration {
  const points: { p: number; hit: boolean }[] = [];
  for (const i of all) {
    if (!i.probabilities) continue;
    for (const [label, p] of Object.entries(i.probabilities)) points.push({ p, hit: label === i.gold });
  }
  return binned(points, binCount);
}

/**
 * Calibration of the probability of the label the answer gave: the number a gate reads. Middle bins
 * are where single suites wander; with ~30 cases each bin holds a handful of answers.
 */
export function topLabelCalibration(all: Item[], binCount = 10): Calibration {
  return binned(all.map((i) => ({ p: i.probabilities?.[i.label] ?? i.confidence, hit: i.label === i.gold })), binCount);
}

/**
 * Area under the ROC curve of the top-label probability as a right/wrong detector: the chance a random
 * right answer is more certain than a random wrong one. A gate fitted on labelled cases needs this
 * (ranking), not calibration. NaN when there are no wrong answers or no right ones.
 */
export function auroc(all: Item[], on: Gate['on'] = 'probability'): number {
  const s = (i: Item) => (on === 'probability' ? (i.probabilities?.[i.label] ?? i.confidence) : i.confidence);
  const right = all.filter((i) => i.label === i.gold).map(s);
  const wrong = all.filter((i) => i.label !== i.gold).map(s);
  if (!right.length || !wrong.length) return Number.NaN;
  let wins = 0;
  for (const r of right) for (const w of wrong) wins += r > w ? 1 : r === w ? 0.5 : 0;
  return wins / (right.length * wrong.length);
}

/**
 * Share of cases where the truth is among the top `k` labels. `argmax` discarded 12–25 points of
 * recall in the study: when the top label was wrong, the truth was the runner-up 67–100% of the time.
 * Show two labels **to a person**; handing a shortlist to another model measured negative.
 */
export function topK(all: Item[], k = 2): { field: string; n: number; top1: number; topK: number }[] {
  const byField = new Map<string, Item[]>();
  // Only questions with more than k options: on a two-option question top-2 is trivially 100%, and
  // reporting it would make every binary field look perfect.
  for (const i of all) {
    if (!i.probabilities || i.primitive === 'noul' || Object.keys(i.probabilities).length <= k) continue;
    byField.set(i.field, [...(byField.get(i.field) ?? []), i]);
  }
  return [...byField.entries()].map(([field, xs]) => {
    const ranked = (i: Item) => Object.entries(i.probabilities!).sort((a, b) => b[1] - a[1]).map(([l]) => l);
    return {
      field,
      n: xs.length,
      top1: xs.filter((i) => i.label === i.gold).length / xs.length,
      topK: xs.filter((i) => ranked(i).slice(0, k).includes(i.gold)).length / xs.length,
    };
  });
}

export type Gate = {
  on: 'confidence' | 'probability';
  /** the question the gate is for; undefined for a gate pooled over every question */
  field?: string;
  target: number;
  /** answers the gate was fitted on */
  n: number;
  /** null when no threshold reaches the target precision on this data */
  threshold: number | null;
  coverage: number;
  precision: number;
  /** 95% Wilson lower bound on that precision: at ~30 cases, "95% precise" can mean 80% */
  lower: number;
  /** true when the answers held no wrong ones, so any threshold "reaches" the target */
  noErrors: boolean;
};

/** 95% Wilson score lower bound for k successes in n. */
export function wilsonLower(k: number, n: number, z = 1.96): number {
  if (n === 0) return Number.NaN;
  const p = k / n;
  const d = 1 + (z * z) / n;
  return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
}

/**
 * The lowest threshold at which everything at or above it is at least `target` precise, and how much
 * of the queue that automates. Fit this on held-out labelled cases, never guess it: on adversarial
 * cases the ordering survived while coverage collapsed to one case in eight.
 */
export function fitGate(all: Item[], target = 0.95, on: Gate['on'] = 'probability'): Gate {
  const score = (i: Item) => (on === 'probability' && i.probabilities ? (i.probabilities[i.label] ?? i.confidence) : i.confidence);
  const scored = all.map((i) => ({ s: score(i), hit: i.label === i.gold })).sort((a, b) => b.s - a.s);
  const noErrors = scored.every((x) => x.hit);
  let best: Gate = { on, target, n: scored.length, threshold: null, coverage: 0, precision: Number.NaN, lower: Number.NaN, noErrors };
  let hits = 0;
  for (let n = 1; n <= scored.length; n += 1) {
    const current = scored[n - 1]!;
    if (current.hit) hits += 1;
    const next = scored[n];
    // only evaluate at the end of a run of equal scores, so a threshold never splits ties
    if (next && next.s === current.s) continue;
    const precision = hits / n;
    if (precision >= target) best = { ...best, threshold: current.s, coverage: n / scored.length, precision, lower: wilsonLower(hits, n) };
  }
  return best;
}

/**
 * One gate per question. Questions differ in how their certainty tracks correctness (a noul's never
 * drops below 0.5; a 30-way choice's can sit at 0.3 and be right), so a pooled threshold is wrong for
 * most of them.
 */
export function fitGates(all: Item[], target = 0.95, on: Gate['on'] = 'probability'): Gate[] {
  const by = new Map<string, Item[]>();
  for (const i of all) by.set(i.field, [...(by.get(i.field) ?? []), i]);
  return [...by].map(([field, xs]) => ({ ...fitGate(xs, target, on), field }));
}

/** Apply fitted per-question gates to other answers: the precision and coverage they actually get. */
export function applyGates(all: Item[], gates: Gate[]): { field: string; n: number; coverage: number; precision: number }[] {
  return gates.map((g) => {
    const xs = all.filter((i) => i.field === g.field);
    const s = (i: Item) => (g.on === 'probability' && i.probabilities ? (i.probabilities[i.label] ?? i.confidence) : i.confidence);
    // no wrong answers where it was fitted: no gate, so everything passes
    const kept = g.noErrors ? xs : g.threshold === null ? [] : xs.filter((i) => s(i) >= g.threshold!);
    return { field: g.field!, n: xs.length, coverage: xs.length ? kept.length / xs.length : Number.NaN, precision: kept.length ? kept.filter((i) => i.label === i.gold).length / kept.length : Number.NaN };
  });
}

/**
 * Deterministic split by case id: the same case always lands on the same side. FNV-1a, then a murmur3
 * finaliser, because ids that differ only in their last characters (triage-001, triage-002) otherwise
 * share their high bits and land on one side together.
 */
export function inFitHalf(caseId: string, fraction = 0.5): boolean {
  let h = 0x811c9dc5;
  for (let i = 0; i < caseId.length; i += 1) h = Math.imul(h ^ caseId.charCodeAt(i), 0x01000193);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 2 ** 32 < fraction;
}

/** Rows that recorded an error instead of answers: counted, never graded. */
export const errored = (rows: Row[]) => rows.filter((r) => r.error);

/**
 * Cases whose gold differs between two runs. A diff across different labels is meaningless: the same
 * answers can move from right to wrong because a label was corrected.
 */
export function goldMismatches(before: Row[], after: Row[]): string[] {
  const prior = new Map(before.map((r) => [r.caseId, JSON.stringify(r.gold ?? {})]));
  return after.filter((r) => prior.has(r.caseId) && prior.get(r.caseId) !== JSON.stringify(r.gold ?? {})).map((r) => r.caseId);
}

/** Replace each row's gold with the suite's current labels, so two runs are graded on the same truth. */
export function regold(rows: Row[], cases: { id: string; gold?: Record<string, unknown> }[]): Row[] {
  const gold = new Map(cases.map((c) => [c.id, c.gold ?? {}]));
  return rows.filter((r) => gold.has(r.caseId)).map((r) => ({ ...r, gold: gold.get(r.caseId) as Row['gold'] }));
}

/** Parse JSONL text into rows, skipping blank lines. */
export function parseRows(text: string): Row[] {
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Row);
}

export type FieldDiff = {
  field: string;
  /** cases present in both runs */
  n: number;
  before: number;
  after: number;
  delta: number;
  /** wrong before, right after */
  fixed: number;
  /** right before, wrong after */
  broken: number;
  /** answers whose label changed at all, right or wrong */
  flipped: number;
  /** two-sided exact sign test on fixed vs broken */
  p: number;
  /**
   * `real` needs both |Δ| ≥ 7 points and p < 0.05. Re-running an unchanged baseline drifted 2.5 and
   * 5.9 points at n=20–50 in the study, and a single-suite gap under ~7 points never replicated.
   */
  verdict: 'real' | 'unproven' | 'no change';
};

function signTest(a: number, b: number): number {
  const n = a + b;
  if (n === 0) return 1;
  const k = Math.min(a, b);
  let tail = 0;
  let c = 1; // C(n, 0)
  for (let i = 0; i <= k; i += 1) {
    tail += c;
    c = (c * (n - i)) / (i + 1);
  }
  return Math.min(1, (2 * tail) / 2 ** n);
}

/**
 * Compare two runs of the same cases — before and after a question change, a recompile, or a model
 * version bump. A no-op rewording once moved 82% of one suite's answers, so `flipped` matters even
 * when accuracy does not move. Re-run the comparator arm too: a clearer question helps every model.
 */
export function diff(before: Item[], after: Item[]): FieldDiff[] {
  const key = (i: Item) => `${i.field}\u0000${i.caseId}`;
  const prior = new Map(before.map((i) => [key(i), i]));
  const byField = new Map<string, { b: Item; a: Item }[]>();
  for (const a of after) {
    const b = prior.get(key(a));
    if (!b) continue;
    byField.set(a.field, [...(byField.get(a.field) ?? []), { b, a }]);
  }
  return [...byField.entries()]
    .map(([field, pairs]) => {
      const n = pairs.length;
      const right = (i: Item) => i.label === i.gold;
      const fixed = pairs.filter(({ b, a }) => !right(b) && right(a)).length;
      const broken = pairs.filter(({ b, a }) => right(b) && !right(a)).length;
      const flipped = pairs.filter(({ b, a }) => b.label !== a.label).length;
      const beforeAcc = pairs.filter(({ b }) => right(b)).length / n;
      const afterAcc = pairs.filter(({ a }) => right(a)).length / n;
      const delta = afterAcc - beforeAcc;
      const p = signTest(fixed, broken);
      const verdict: FieldDiff['verdict'] = fixed + broken === 0 ? 'no change' : Math.abs(delta) >= 0.07 && p < 0.05 ? 'real' : 'unproven';
      return { field, n, before: beforeAcc, after: afterAcc, delta, fixed, broken, flipped, p, verdict };
    })
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
}

// ---- whole-map runs ------------------------------------------------------------------------------
//
// A map run (`jev-run --map`) grades the map's decisions, not Jev's answers: its gold is keyed by
// decision field ("outcome"), and the answers behind each decision sit in `raw`. There is no single
// probability for a decision made in code, so these audits use the least certain answer behind it:
// a decision is only as sure as its weakest read.

/** How sure one answer is: a noul's distance from its nearer end, a choice's or score's top probability. */
export function answerCertainty(answer: Answer): number {
  if (answer.type === 'noul') return Math.max(answer.noul, 1 - answer.noul);
  if (answer.type === 'choice') return answer.probabilities?.[answer.choice] ?? answer.confidence;
  const ps = Object.values(answer.probabilities ?? {});
  return ps.length ? Math.max(...ps) : answer.confidence;
}

export type Decision = {
  caseId: string;
  field: string;
  gold: unknown;
  decision: unknown;
  grade: 'right' | 'wrong' | 'abstain';
  /** the least certain answer behind the decision; null when the map asked Jev nothing for this case */
  weakest: { question: string; certainty: number } | null;
};

/** True for rows written by `jev-run --map`. */
export const isMapRow = (row: Row) => row.decision !== undefined || row.grades !== undefined || row.arm === 'jev-map';

function gradeDecision(pred: unknown, gold: unknown): Decision['grade'] {
  if (pred === undefined || pred === null || pred === 'abstain' || (Array.isArray(pred) && pred.length === 0)) return 'abstain';
  const p = Array.isArray(pred) ? pred[0] : pred;
  return (Array.isArray(gold) ? gold.includes(p) : p === gold) ? 'right' : 'wrong';
}

/** One graded decision per (case, decision field) of a map run. Rows that errored are skipped: count them with `errored`. */
export function decisions(rows: Row[]): Decision[] {
  const out: Decision[] = [];
  for (const row of rows) {
    if (row.error) continue;
    let weakest: Decision['weakest'] = null;
    for (const [question, answer] of Object.entries(row.raw ?? {})) {
      if (!answer) continue;
      const certainty = answerCertainty(answer);
      if (!weakest || certainty < weakest.certainty) weakest = { question, certainty };
    }
    for (const [field, gold] of Object.entries(row.gold ?? {})) {
      const decision = row.decision?.[field];
      const grade = (row.grades?.[field] as Decision['grade'] | undefined) ?? gradeDecision(decision, gold);
      out.push({ caseId: row.caseId, field, gold, decision, grade, weakest });
    }
  }
  return out;
}

export type DecisionField = { field: string; n: number; right: number; wrong: number; abstain: number; accuracy: number; wrongRate: number; coverage: number };

/** Right / wrong / abstain per decision field. */
export function decisionSummary(all: Decision[]): DecisionField[] {
  const by = new Map<string, Decision[]>();
  for (const d of all) by.set(d.field, [...(by.get(d.field) ?? []), d]);
  return [...by].map(([field, ds]) => {
    const c = (g: Decision['grade']) => ds.filter((d) => d.grade === g).length;
    const n = ds.length;
    return { field, n, right: c('right'), wrong: c('wrong'), abstain: c('abstain'), accuracy: c('right') / n, wrongRate: c('wrong') / n, coverage: (c('right') + c('wrong')) / n };
  });
}

export type WeakLink = { question: string; wrong: number; right: number };

/**
 * Which question was the least certain answer behind each decision, counted separately for wrong and
 * right decisions. A question that is the weak link in many wrong decisions and few right ones is the
 * first one to read.
 */
export function weakLinks(all: Decision[]): WeakLink[] {
  const by = new Map<string, WeakLink>();
  for (const d of all) {
    if (!d.weakest || d.grade === 'abstain') continue;
    const w = by.get(d.weakest.question) ?? { question: d.weakest.question, wrong: 0, right: 0 };
    w[d.grade] += 1;
    by.set(d.weakest.question, w);
  }
  return [...by.values()].sort((a, b) => b.wrong - a.wrong || a.right - b.right);
}

export type DecisionGate = {
  target: number;
  /** send a case to a person when its weakest answer is below this; null if no threshold reaches the target */
  threshold: number | null;
  /** share of all cases the map still decides with the gate */
  coverage: number;
  precision: number;
  /** wrong decisions the gate turns into abstentions */
  wrongRemoved: number;
  /** right decisions it turns into abstentions */
  rightLost: number;
  /** 95% Wilson lower bound on the precision */
  lower: number;
  /** no wrong decisions at all: nothing for a gate to remove */
  noErrors: boolean;
};

/**
 * Fit a gate on the weakest answer behind each decision: the lowest threshold at which the decisions
 * kept reach the target precision. Cases the map already abstained on stay abstained. Decisions made
 * without asking Jev anything count as certain.
 */
export function fitDecisionGate(all: Decision[], target = 0.95): DecisionGate {
  const decided = all.filter((d) => d.grade !== 'abstain').map((d) => ({ s: d.weakest?.certainty ?? 1, hit: d.grade === 'right' })).sort((a, b) => b.s - a.s);
  const wrongTotal = decided.filter((d) => !d.hit).length;
  const rightTotal = decided.length - wrongTotal;
  let best: DecisionGate = { target, threshold: null, coverage: 0, precision: Number.NaN, wrongRemoved: wrongTotal, rightLost: rightTotal, lower: Number.NaN, noErrors: wrongTotal === 0 };
  if (wrongTotal === 0) return { ...best, coverage: decided.length / all.length, precision: decided.length ? 1 : Number.NaN, wrongRemoved: 0, rightLost: 0, lower: wilsonLower(decided.length, decided.length) };
  let hits = 0;
  for (let n = 1; n <= decided.length; n += 1) {
    const current = decided[n - 1]!;
    if (current.hit) hits += 1;
    const next = decided[n];
    if (next && next.s === current.s) continue;
    const precision = hits / n;
    if (precision >= target) best = { ...best, threshold: current.s, coverage: n / all.length, precision, wrongRemoved: wrongTotal - (n - hits), rightLost: rightTotal - hits, lower: wilsonLower(hits, n) };
  }
  return best;
}
