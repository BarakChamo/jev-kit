import { describe, expect, it } from 'vitest';
import {
  answerCertainty, applyGates, auroc, calibration, confidentlyWrong, decisionSummary, decisions, diff, errored, fitDecisionGate, fitGate,
  fitGates, goldMismatches, inFitHalf, isMapRow, items, probabilityCalibration, regold, topK, weakLinks, wilsonLower, type Row,
} from './index.js';

const choice = (choice: string, probabilities: Record<string, number>, confidence = Math.max(...Object.values(probabilities))) => ({
  type: 'choice' as const,
  choice,
  confidence,
  probabilities,
});

const rows: Row[] = [
  { caseId: 'a', gold: { v: 'block', live: 'yes' }, raw: { v: choice('block', { allow: 0.02, block: 0.98 }), live: { type: 'noul', noul: 0.97 } } },
  { caseId: 'b', gold: { v: 'allow', live: 'no' }, raw: { v: choice('allow', { allow: 0.95, block: 0.05 }), live: { type: 'noul', noul: 0.04 } } },
  // three confident errors in one direction on `v` — the signature of a question/label defect
  { caseId: 'c', gold: { v: 'allow' }, raw: { v: choice('block', { allow: 0.05, block: 0.95 }) } },
  { caseId: 'd', gold: { v: 'allow' }, raw: { v: choice('block', { allow: 0.04, block: 0.96 }) } },
  { caseId: 'e', gold: { v: 'allow' }, raw: { v: choice('block', { allow: 0.08, block: 0.92 }) } },
  // wrong at low confidence, truth is the runner-up
  { caseId: 'f', gold: { v: 'ask' }, raw: { v: choice('allow', { allow: 0.45, ask: 0.4, block: 0.15 }) } },
  // a field derived in code, with no raw answer
  { caseId: 'g', gold: { derived: 'yes' }, predicted: { derived: 'yes' }, confidence: { derived: 0.8 } },
];

describe('jev-audit', () => {
  const all = items(rows);

  it('reads Nouls at 0.5, Choices by label, and derived fields from predicted/confidence', () => {
    expect(all).toHaveLength(9);
    expect(all.find((i) => i.caseId === 'b' && i.field === 'live')).toMatchObject({ label: 'no', confidence: 0.96 });
    expect(all.find((i) => i.field === 'derived')).toMatchObject({ primitive: 'derived', label: 'yes' });
  });

  it('names Score levels from the legend and grades by rounding the score, as the study did', () => {
    const [scored] = items([
      {
        caseId: 's',
        gold: { urgency: 'medium' },
        raw: {
          urgency: {
            type: 'score',
            score: 1.48,
            confidence: 0.26,
            legend: { '0': 'low: nothing blocked', '1': 'medium: inconvenienced', '2': 'high: blocked' },
            probabilities: { '0': 0, '1': 0.51, '2': 0.49 },
          },
        },
      },
    ]);
    expect(scored).toMatchObject({ label: 'medium', probabilities: { low: 0, medium: 0.51, high: 0.49 } });
  });

  it('flags a field whose confident errors run one way', () => {
    const { errors, patterns } = confidentlyWrong(all, 0.9);
    expect(errors).toHaveLength(3);
    expect(patterns[0]).toMatchObject({ field: 'v', dominant: 'allow -> block', oneDirection: true });
  });

  it('does not flag a low-confidence error as confidently wrong', () => {
    expect(confidentlyWrong(all, 0.9).errors.some((e) => e.caseId === 'f')).toBe(false);
  });

  it('recovers the runner-up at top-2, and ignores questions too small for top-2 to mean anything', () => {
    const v = topK(all, 2).find((t) => t.field === 'v')!;
    // only case f has three options; the two-option cases would be trivially 100% at top-2
    expect(v.n).toBe(1);
    expect(v.top1).toBe(0);
    expect(v.topK).toBe(1);
  });

  it('computes calibration for the scalar and for every probability', () => {
    expect(calibration(all).answers).toBe(9);
    // every probability in every distribution counts, not just the winner
    expect(probabilityCalibration(all).answers).toBeGreaterThan(all.length);
  });

  it('fits the lowest threshold that holds the target, and reports unreachable honestly', () => {
    const clean = items(rows.slice(0, 2));
    expect(fitGate(clean, 0.95).threshold).not.toBeNull();
    expect(fitGate(items(rows.slice(2, 5)), 0.95).threshold).toBeNull();
  });

  it('diffs two runs per field and refuses to call a small move real', () => {
    const noul = (p: number) => ({ type: 'noul' as const, noul: p });
    const run = (right: number, total: number) =>
      items(
        Array.from({ length: total }, (_, i) => ({ caseId: `k${i}`, gold: { f: 'yes' }, raw: { f: noul(i < right ? 0.9 : 0.1) } })),
      );
    const [big] = diff(run(20, 40), run(36, 40));
    expect(big).toMatchObject({ n: 40, fixed: 16, broken: 0, flipped: 16, verdict: 'real' });
    expect(big!.delta).toBeCloseTo(0.4);
    const [small] = diff(run(20, 40), run(22, 40));
    expect(small!.verdict).toBe('unproven');
    const [same] = diff(run(20, 40), run(20, 40));
    expect(same!.verdict).toBe('no change');
  });
});

describe('jev-audit on whole-map runs', () => {
  // rows as `jev-run --map` writes them: gold and grades per decision field, answers in `raw`
  const noul = (n: number) => ({ type: 'noul' as const, noul: n });
  const mapRows: Row[] = [
    { caseId: 'm1', gold: { outcome: 'yes' }, decision: { outcome: 'yes' }, grades: { outcome: 'right' }, raw: { a: noul(0.98), b: choice('x', { x: 0.97, y: 0.03 }) } },
    { caseId: 'm2', gold: { outcome: 'no' }, decision: { outcome: 'no' }, grades: { outcome: 'right' }, raw: { a: noul(0.03), b: choice('y', { x: 0.1, y: 0.9 }) } },
    // wrong, and its weakest answer is shaky: a gate can catch it
    { caseId: 'm3', gold: { outcome: 'no' }, decision: { outcome: 'yes' }, grades: { outcome: 'wrong' }, raw: { a: noul(0.95), b: choice('x', { x: 0.55, y: 0.45 }) } },
    // wrong while every answer is sure: the decide() code or a confidently wrong question
    { caseId: 'm4', gold: { outcome: 'yes' }, decision: { outcome: 'no' }, grades: { outcome: 'wrong' }, raw: { a: noul(0.02), b: choice('y', { x: 0.01, y: 0.99 }) } },
    { caseId: 'm5', gold: { outcome: 'yes' }, decision: { outcome: 'abstain' }, grades: { outcome: 'abstain' }, raw: { a: noul(0.5) } },
    // gold may list several acceptable labels; grades are recomputed when absent
    { caseId: 'm6', gold: { outcome: ['yes', 'maybe'] as unknown as string }, decision: { outcome: 'maybe' }, raw: { a: noul(0.9) } },
  ];
  const ds = decisions(mapRows);

  it('recognises map rows and grades every decision', () => {
    expect(mapRows.every(isMapRow)).toBe(true);
    expect(isMapRow(rows[0]!)).toBe(false);
    expect(ds.map((d) => d.grade)).toEqual(['right', 'right', 'wrong', 'wrong', 'abstain', 'right']);
    expect(decisionSummary(ds)).toEqual([{ field: 'outcome', n: 6, right: 3, wrong: 2, abstain: 1, accuracy: 0.5, wrongRate: 2 / 6, coverage: 5 / 6 }]);
  });

  it('finds the least certain answer behind each decision', () => {
    expect(answerCertainty(noul(0.03))).toBeCloseTo(0.97);
    expect(ds.find((d) => d.caseId === 'm3')!.weakest).toEqual({ question: 'b', certainty: 0.55 });
    // both are the weak link in one wrong decision; `a` ranks first because it is weak in fewer right ones
    expect(weakLinks(ds)).toEqual([{ question: 'a', wrong: 1, right: 1 }, { question: 'b', wrong: 1, right: 2 }]);
  });

  it('diffs two map runs by their decisions', () => {
    const after = mapRows.map((r) => (r.caseId === 'm3' ? { ...r, decision: { outcome: 'no' }, grades: { outcome: 'right' } } : r));
    const [d] = diff(items(mapRows, { requireConfidence: false }), items(after, { requireConfidence: false }));
    expect(d).toMatchObject({ field: 'outcome', fixed: 1, broken: 0 });
  });

  it('fits a gate on the weakest answer, and reports what it costs', () => {
    const g = fitDecisionGate(ds, 0.75);
    // at 0.9 the shaky wrong decision (0.55) is removed; the sure wrong one (0.98) cannot be
    expect(g).toMatchObject({ threshold: 0.9, wrongRemoved: 1, rightLost: 0, precision: 0.75, coverage: 4 / 6 });
    // a confidently wrong decision caps what any gate can reach
    expect(fitDecisionGate(ds, 0.8).threshold).toBeNull();
  });
});

describe('guards against misleading comparisons', () => {
  it('diff refuses runs graded on different labels, and regold puts both on one suite', () => {
    const before: Row[] = [{ caseId: 'x', gold: { f: 'yes' }, predicted: { f: 'yes' } }, { caseId: 'y', gold: { f: 'no' }, predicted: { f: 'no' } }];
    const after: Row[] = [{ caseId: 'x', gold: { f: 'no' }, predicted: { f: 'yes' } }, { caseId: 'y', gold: { f: 'no' }, predicted: { f: 'no' } }];
    expect(goldMismatches(before, after)).toEqual(['x']);
    const suite = [{ id: 'x', gold: { f: 'no' } }, { id: 'y', gold: { f: 'no' } }];
    expect(goldMismatches(regold(before, suite), regold(after, suite))).toEqual([]);
    const [d] = diff(items(regold(before, suite), { requireConfidence: false }), items(regold(after, suite), { requireConfidence: false }));
    expect(d).toMatchObject({ before: 0.5, after: 0.5, fixed: 0, broken: 0 });
  });

  it('counts errored rows and still treats an all-error map run as a map run', () => {
    const rs: Row[] = [{ caseId: 'a', gold: { outcome: 'x' }, arm: 'jev-map', error: 'HTTP 503' }, { caseId: 'b', gold: { outcome: 'x' }, decision: { outcome: 'x' } }];
    expect(errored(rs)).toHaveLength(1);
    expect(isMapRow(rs[0]!)).toBe(true);
    expect(decisions(rs)).toHaveLength(1);
  });

  it('fits one gate per question, with a lower bound, and says when none is needed', () => {
    const all = items(rows);
    const gates = fitGates(all, 0.95);
    expect(gates.map((g) => g.field).sort()).toEqual(['derived', 'live', 'v']);
    expect(gates.find((g) => g.field === 'live')).toMatchObject({ noErrors: true });
    expect(gates.find((g) => g.field === 'v')).toMatchObject({ threshold: 0.98, coverage: 1 / 6, noErrors: false });
    expect(wilsonLower(29, 30)).toBeGreaterThan(0.8);
    expect(wilsonLower(29, 30)).toBeLessThan(0.9);
    expect(applyGates(all, gates).find((h) => h.field === 'v')).toMatchObject({ coverage: 1 / 6, precision: 1 });
  });

  it('ranks with AUROC and splits cases deterministically', () => {
    const all = items(rows);
    expect(auroc(all)).toBeGreaterThanOrEqual(0);
    expect(auroc(all.filter((i) => i.label === i.gold))).toBeNaN();
    const ids = Array.from({ length: 1000 }, (_, i) => `case-${i}`);
    const fit = ids.filter((id) => inFitHalf(id, 0.5)).length;
    expect(fit).toBeGreaterThan(420);
    expect(fit).toBeLessThan(580);
    expect(ids.map((id) => inFitHalf(id))).toEqual(ids.map((id) => inFitHalf(id)));
    // short ids that differ only at the end must still spread over both sides
    const short = Array.from({ length: 50 }, (_, i) => `triage-${String(i + 1).padStart(3, '0')}`).filter((id) => inFitHalf(id)).length;
    expect(short).toBeGreaterThan(15);
    expect(short).toBeLessThan(35);
  });
});
