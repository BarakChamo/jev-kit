// Two independent reviewers (GLM 5.3 and Qwen 3.8 Max) relabel every case from the rule text and the
// case, never the gold. Run before any map is written or graded.
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { generateStructured } from '../lib/glm.js';

const MODELS = ['zai/glm-5.3', 'alibaba/qwen3.8-max-0902'];
const SYSTEM = 'You are labelling evaluation data. Apply the rule exactly as written, working through any date, time or lookup step by step before answering. Answer only with the submit tool.';
const suites: Record<string, { rule: string; schema: z.ZodTypeAny; key: string }> = {
  'sla-breach': { key: 'breached', rule: 'Apply policy_text to the ticket_log. "yes" if the first reply from a support agent came later than the target for the priority the ticket had when opened (or, if there is no agent reply yet, if `now` is already past the target); otherwise "no".', schema: z.object({ breached: z.enum(['yes', 'no']), reasoning: z.string() }) },
  'refund-eligibility': { key: 'eligible', rule: 'Identify which item in the order the customer asks to return, then apply policy_text to it using the request date. "yes" if it is eligible for return, otherwise "no".', schema: z.object({ eligible: z.enum(['yes', 'no']), reasoning: z.string() }) },
  'access-request': { key: 'decision', rule: 'Look up the requested system in the catalog, work out the access level asked for, and apply policy_text to this requester. Answer "grant", "needs_approval" or "deny".', schema: z.object({ decision: z.enum(['grant', 'needs_approval', 'deny']), reasoning: z.string() }) },
  'clause-locator': { key: 'section', rule: 'Answer with the number of the section of contract_text that actually sets the term asked about in `question` (not a section that only refers to it).', schema: z.object({ section: z.string(), reasoning: z.string() }) },
};
async function pool<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>) { const out: R[] = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < xs.length) { const k = i++; out[k] = await fn(xs[k]!); } })); return out; }
const report: any = {};
for (const [name, { rule, schema, key }] of Object.entries(suites)) {
  const suite = JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), 'utf8'));
  report[name] = {};
  for (const model of MODELS) {
    const rows = await pool(suite.cases, 6, async (c: any) => {
      const r = await generateStructured({ model, system: SYSTEM, schema, prompt: `Rule:\n${rule}\n\nCase:\n${JSON.stringify(c.input, null, 2)}`, maxOutputTokens: 4000 });
      const o: any = r.object;
      const got = o ? String(o[key]).replace(/^section\s*/i, '').trim() : undefined;
      return { id: c.id, gold: c.gold[key], got, agree: got === undefined ? undefined : got === c.gold[key], reasoning: o?.reasoning?.slice(0, 400), failure: r.failure };
    });
    const ok = rows.filter((r) => r.agree !== undefined);
    report[name][model] = { agreement: ok.filter((r) => r.agree).length / (ok.length || 1), parsed: ok.length, disputed: ok.filter((r) => !r.agree).map((r) => ({ id: r.id, gold: r.gold, got: r.got, reasoning: r.reasoning })), rows };
    console.log(name.padEnd(20), model.padEnd(26), `agreement ${(report[name][model].agreement * 100).toFixed(1)}% on ${ok.length}/${rows.length}`, report[name][model].disputed.map((d: any) => d.id).join(' '));
  }
}
writeFileSync(new URL('./label-audit.json', import.meta.url), JSON.stringify(report, null, 2));
