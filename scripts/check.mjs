// Offline checks a contributor (and CI) can run with no API key:
//   - the audit bundles match audit/src;
//   - every example suite and map passes `jev-run --check` (maps are built and exercised);
//   - the renewal-notice suite regenerates byte for byte from its generator;
//   - the recorded runs in examples/ and evals/ still audit, and give the numbers the README quotes.
//   node scripts/check.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ex = join(root, 'plugin/skills/jev-eval/examples');
const run = join(root, 'plugin/skills/jev-eval/scripts/jev-run.mjs');
const audit = join(root, 'plugin/skills/jev-eval/scripts/jev-audit.mjs');
const node = (args, opts = {}) => execFileSync('node', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
let failed = 0;
const step = (name, fn) => {
  try { fn(); console.log(`ok   ${name}`); } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stderr ?? ''}${err.stdout ?? ''}${err.message}`); }
};
const expect = (text, re) => { if (!re.test(text)) throw new Error(`expected ${re} in:\n${text}`); };

step('audit bundles are current', () => node(['scripts/build-audit.mjs', '--check']));
step('support-triage suite passes --check', () => node([run, join(ex, 'support-triage.json'), '--check']));
step('renewal-notice map passes --check', () => node([run, join(ex, 'renewal-notice.json'), '--map', join(ex, 'renewal-notice.map.mjs'), '--check']));
step('renewal-notice suite regenerates byte for byte', () => {
  const before = readFileSync(join(ex, 'renewal-notice.json'), 'utf8');
  node([join(ex, 'renewal-notice.gen.mjs')]);
  if (readFileSync(join(ex, 'renewal-notice.json'), 'utf8') !== before) throw new Error('renewal-notice.json differs from its generator');
});
step('recorded renewal-notice run audits at 42/42', () => expect(node([audit, join(ex, 'renewal-notice.recorded.jsonl')]), /\| outcome \| 42 \| 42 \| 0 \| 0 \|/));
step('support-triage gate matches the README', () => expect(node([audit, 'evals/support-triage/results/jev.jsonl', '--target', '0.95']), /\| probability \| 0\.770 \| 83\.3% \| 96\.8% \|/));
step('map audit names the weak link the README shows', () => expect(node([audit, 'evals/heldout2/access-request-plugin-2.map.jsonl']), /access-003 \| decision \| deny \| needs_approval \| deny \| 0\.59/));
step('diff refuses runs graded on different labels', () => {
  try { node([audit, 'diff', 'evals/support-triage/results/glm-oneshot.jsonl', 'evals/support-triage/results/jev.jsonl']); } catch (err) { expect(err.stderr, /different gold labels/); return; }
  throw new Error('diff accepted mismatched gold');
});
step('jev-run stops with no key', () => {
  try { node([run, join(ex, 'renewal-notice.json'), '--map', join(ex, 'renewal-notice.map.mjs'), '--out', '/dev/null'], { env: { PATH: process.env.PATH } }); } catch (err) { expect(err.stderr, /no API key/); return; }
  throw new Error('jev-run ran without a key');
});

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('all offline checks passed');
