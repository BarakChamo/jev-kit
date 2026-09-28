// An independent reviewer (GLM 5.3) relabels every case from the rule text and the case, never the gold.
// Run before any map is written or graded.
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { generateStructured } from '../../../packages/gateway/src/glm.js';

const MODEL = 'zai/glm-5.3';
const SYSTEM = 'You are labelling evaluation data. Apply the rule exactly as written, working through each lookup step by step before answering. Answer only with the submit tool.';
const rule = 'Identify which dataset the request asks to export and where to, look up the dataset\'s classification and the destination\'s type in the catalogs, then apply policy_text. Answer "grant", "needs_approval" or "deny".';
const schema = z.object({ decision: z.enum(['grant', 'needs_approval', 'deny']), reasoning: z.string() });
async function pool<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>) { const out: R[] = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < xs.length) { const k = i++; out[k] = await fn(xs[k]!); } })); return out; }
const suite = JSON.parse(readFileSync(new URL('./data-export.json', import.meta.url), 'utf8'));
const rows = await pool(suite.cases, 6, async (c: any) => {
  const r = await generateStructured({ model: MODEL, system: SYSTEM, schema, prompt: `Rule:\n${rule}\n\nCase:\n${JSON.stringify(c.input, null, 2)}`, maxOutputTokens: 4000 });
  const o: any = r.object;
  return { id: c.id, gold: c.gold.decision, got: o?.decision, agree: o ? o.decision === c.gold.decision : undefined, reasoning: o?.reasoning?.slice(0, 400), failure: r.failure };
});
const ok = rows.filter((r) => r.agree !== undefined);
const report = { model: MODEL, agreement: ok.filter((r) => r.agree).length / (ok.length || 1), parsed: ok.length, disputed: ok.filter((r) => !r.agree), rows };
writeFileSync(new URL('./label-audit.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(`${MODEL}: agreement ${(report.agreement * 100).toFixed(1)}% on ${ok.length}/${rows.length}`, report.disputed.map((d) => `${d.id} gold=${d.gold} got=${d.got}`).join('; '));
