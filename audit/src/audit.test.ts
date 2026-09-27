import { describe, expect, it } from 'vitest';
import { calibration, confidentlyWrong, diff, fitGate, items, probabilityCalibration, topK, type Row } from './index.js';

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
