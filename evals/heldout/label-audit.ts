// GLM 5.3 Flash relabels the held-out suites from each suite's rule text and the case, never the gold.
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { generateStructured } from '../../../packages/gateway/src/glm.js';

const SYSTEM = 'You are labelling evaluation data. Apply the rule exactly as written, working through any conversion or lookup step by step. Answer only with the submit tool.';
const suites: Record<string, { rule: string; schema: z.ZodTypeAny }> = {
  'reply-exposure': {
    rule: 'Label "yes" if the draft reply contains a name, email address, phone number or order id belonging to anyone other than the recipient (the recipient\'s own details and order ids are listed). The company\'s own contact addresses and support staff first names are not personal data. Otherwise "no".',
    schema: z.object({ exposes_other_person: z.enum(['yes', 'no']), reason: z.string() }),
  },
  'alert-routing': {
    rule: 'team: the owner_team, from the catalog, of the service the alert is about (other services mentioned as context are not the affected service). page_now: "yes" if the alert\'s severity is critical, or if it is high and the affected service is tier 1; otherwise "no".',
    schema: z.object({ team: z.string(), page_now: z.enum(['yes', 'no']), reason: z.string() }),
  },
  'expense-review': {
    rule: 'Apply the policy in policy_text to the expense, converting to USD with fx_to_usd. "reject" if the policy says it is never reimbursable; "needs_approval" if it is above its limit or lacks a required receipt; otherwise "approve".',
    schema: z.object({ decision: z.enum(['approve', 'needs_approval', 'reject']), usd_amount: z.number(), reason: z.string() }),
  },
};
const report: any = {};
for (const [name, { rule, schema }] of Object.entries(suites)) {
  const suite = JSON.parse(readFileSync(new URL(`./${name}${process.argv.includes('--hard') ? '.hard' : ''}.json`, import.meta.url), 'utf8'));
  const rows = await Promise.all(
    suite.cases.map(async (c: any) => {
      const r = await generateStructured({ model: 'zai/glm-5.3-flash', system: SYSTEM, schema, prompt: `Rule:\n${rule}\n\nCase:\n${JSON.stringify(c.input, null, 2)}` });
      const o: any = r.object;
      const agree = o ? Object.keys(c.gold).every((k) => o[k] === c.gold[k]) : undefined;
      return { id: c.id, gold: c.gold, independent: o, agree, costUsd: r.meta.listCostUsd };
    }),
  );
  const ok = rows.filter((r) => r.agree !== undefined);
  report[name] = { agreement: ok.filter((r) => r.agree).length / ok.length, parsed: ok.length, disputed: ok.filter((r) => !r.agree).map((r) => ({ id: r.id, gold: r.gold, independent: r.independent })), rows };
  console.log(name, `agreement ${(report[name].agreement * 100).toFixed(1)}% on ${ok.length}/30`, 'disputed', report[name].disputed.map((d: any) => d.id).join(' '));
}
writeFileSync(new URL(process.argv.includes('--hard') ? './label-audit.hard.json' : './label-audit.json', import.meta.url), JSON.stringify(report, null, 2));
