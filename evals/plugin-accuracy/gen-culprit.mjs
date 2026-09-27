// Labelled cases for the `culprit` task: which line of the log tail states the cause of the failure.
// Gold is a set of acceptable line indices (the error line and, where it states the same cause, the
// line that names the failing assertion), fixed by hand per failure kind. Built from the retry logs so
// both suites share inputs.
import { readFileSync, writeFileSync } from 'node:fs';

const retry = JSON.parse(readFileSync(new URL('./retry.cases.json', import.meta.url), 'utf8'));
// substrings that identify the acceptable culprit lines for each kind
const culprit = {
  flaky_timing: ['Test timed out in 5000ms'],
  flaky_order: ["expected 'conn-7' to be 'conn-3'"],
  infra_network: ['ERR_PNPM_FETCH_503'],
  infra_runner: ['runner has received a shutdown signal'],
  infra_disk: ['ENOSPC: no space left on device'],
  code_assert: ['expected 91.8 to be 90'],
  code_type: ["Property 'shippingAddress' does not exist"],
  code_timeout_bug: ['Test timed out in 10000ms', 'awaiting job 17 of 17'],
  code_network_bug: ['connect ECONNREFUSED 127.0.0.1:4010'],
  config_env: ['STRIPE_SECRET_KEY is not set'],
  dep_breaking: ["Package subpath './server' is not defined"],
};
const seen = new Set();
const cases = [];
for (const c of retry) {
  const kind = c.facts.cause;
  const key = `${kind}`;
  // one case per distinct log, plus the metadata variants, capped at 3 per kind
  if ([...seen].filter((k) => k === key).length >= 3) continue;
  const lines = c.input.log_lines;
  const gold = lines.map((l, i) => (culprit[kind].some((s) => l.includes(s)) ? i : -1)).filter((i) => i >= 0);
  if (!gold.length) throw new Error(`no culprit line for ${kind}`);
  cases.push({ id: c.id.replace('retry', 'culprit'), input: c.input, gold: { culprit_lines: gold }, facts: { cause: kind } });
}
writeFileSync(new URL('./culprit.cases.json', import.meta.url), JSON.stringify(cases, null, 2) + '\n');
console.log(`${cases.length} cases`);
