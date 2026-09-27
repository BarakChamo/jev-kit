// Independent relabelling of the three plugin-accuracy suites by an LLM (default zai/glm-5.3-flash,
// reasoning on), given each suite's labelling rule and the case, never the gold. Same method as the
// study's own label audits (apps/harness/src/workflows/label-audit.ts).
//   NODE_USE_ENV_PROXY=1 node --env-file=../../../.env.local --import tsx label-audit.ts [--model zai/glm-5.3-flash]
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { generateStructured } from '../../../packages/gateway/src/glm.js';

const argv = process.argv.slice(2);
const model = argv.includes('--model') ? argv[argv.indexOf('--model') + 1]! : 'zai/glm-5.3-flash';
const load = (t: string) => JSON.parse(readFileSync(new URL(`./${t}.cases.json`, import.meta.url), 'utf8'));

const SYSTEM =
  'You are labelling evaluation data for a decision system. Apply the labelling rule exactly as written, ' +
  'reading the case carefully and doing any date arithmetic step by step. Answer only with the submit tool.';

// The rules as a careful person would read them. Written from the definitions fixed when the suites were
// generated (gen-*.mjs), never from the gold labels.
const RULES = {
  notice:
    'A customer contract and a cancellation email, with the date the email was received.\n' +
    'Label the outcome:\n' +
    '- "not_applicable": the contract does not renew automatically.\n' +
    '- "avoided": the contract renews automatically, AND the email clearly states the customer will not renew or wants to cancel, ' +
    'AND it was sent by a method the contract permits, AND it was received at least the required notice period before the end of the ' +
    'term in which it was received.\n' +
    '- "not_avoided": the contract renews automatically and any one of those three conditions fails.',
  retry:
    'A failed CI job: its metadata and the last lines of its log.\n' +
    'Label "yes" (retry) if and only if the failure was caused by something transient: a flaky test (nondeterministic: timing, ordering, ' +
    'shared state between tests) or infrastructure (the runner, the network, a package registry, disk space, a service outside the repository). ' +
    'Label "no" if the cause is in the code under test, a deterministic test failure, the build or CI configuration, secrets, or a dependency ' +
    'change made by the commit, because retrying would fail the same way.',
  culprit:
    'A failed CI job log, one line per numbered entry.\n' +
    'Which line should a developer be pointed at as the one that states the cause of the failure? ' +
    'Give the single best line, and also every line you would accept as correctly stating the cause (a wrapper line such as ' +
    '"Process completed with exit code 1", or a summary count, does not state the cause).',
};

const schemas = {
  notice: z.object({ outcome: z.enum(['avoided', 'not_avoided', 'not_applicable']), reason: z.string() }),
  retry: z.object({ retry: z.enum(['yes', 'no']), cause: z.string(), reason: z.string() }),
  culprit: z.object({ best_line: z.number().int(), acceptable_lines: z.array(z.number().int()), reason: z.string() }),
};

function view(task: string, c: any) {
  if (task === 'notice') return { contract_text: c.input.contract_text, email_text: c.input.email_text, received_date: c.input.received_date };
  if (task === 'retry') { const { log_lines, ...rest } = c.input; return rest; }
  return { job: `${c.input.repo} ${c.input.job_name}`, lines: c.input.log_lines.map((t: string, i: number) => `${i}: ${t}`) };
}

async function pool<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < xs.length) { const k = i++; out[k] = await fn(xs[k]!); } }));
  return out;
}

const report: any = { model, suites: {} };
for (const task of ['notice', 'retry', 'culprit'] as const) {
  const cases = load(task);
  const rows = await pool(cases, 6, async (c: any) => {
    const r = await generateStructured({
      model,
      system: SYSTEM,
      schema: schemas[task] as any,
      prompt: `Labelling rule:\n${RULES[task]}\n\nCase:\n${JSON.stringify(view(task, c), null, 2)}`,
    });
    const o: any = r.object;
    let agree: boolean | undefined;
    if (o) {
      if (task === 'notice') agree = o.outcome === c.gold.outcome;
      else if (task === 'retry') agree = o.retry === c.gold.retry;
      else agree = c.gold.culprit_lines.includes(o.best_line);
    }
    return { id: c.id, gold: c.gold, independent: o, agree, failure: r.failure, costUsd: r.meta.listCostUsd, facts: c.facts };
  });
  const ok = rows.filter((r) => r.agree !== undefined);
  report.suites[task] = {
    n: rows.length,
    parsed: ok.length,
    agreement: ok.filter((r) => r.agree).length / ok.length,
    disputed: ok.filter((r) => !r.agree).map((r) => r.id),
    costUsd: rows.reduce((a, r) => a + r.costUsd, 0),
    rows,
  };
  console.log(task, JSON.stringify({ n: rows.length, parsed: ok.length, agreement: report.suites[task].agreement, disputed: report.suites[task].disputed.length }));
}
writeFileSync(new URL('./label-audit.json', import.meta.url), JSON.stringify(report, null, 2));
