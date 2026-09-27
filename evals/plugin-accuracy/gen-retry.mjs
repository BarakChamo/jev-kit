// Labelled cases for the `retry` task: a ~40-line log tail plus job metadata. Gold `retry` is yes iff
// the cause is flaky or infrastructure (the definitional mapping the study derived at 92.5%). Half the
// cases carry a surface cue that points the wrong way: a "timeout" that is a real bug, a network
// error from a test with a wrong hostname, a flaky-looking test name on a deterministic assertion.
import { writeFileSync } from 'node:fs';

const pad = (i, pre) =>
  Array.from({ length: i }, (_, k) => pre[k % pre.length]);

const setup = [
  '##[group]Run actions/checkout@v4', 'Syncing repository: acme/webapp', '##[endgroup]',
  '##[group]Run pnpm install --frozen-lockfile', 'Lockfile is up to date, resolution step is skipped',
  'Packages: +1184', 'Progress: resolved 1184, reused 1184, downloaded 0, added 1184, done', '##[endgroup]',
  '##[group]Run pnpm test', '> webapp@2.14.0 test /home/runner/work/webapp', '> vitest run',
  ' RUN  v3.2.4 /home/runner/work/webapp', ' ✓ src/utils/format.test.ts (12 tests) 18ms',
  ' ✓ src/api/client.test.ts (31 tests) 204ms', ' ✓ src/components/Button.test.tsx (8 tests) 95ms',
];

const tails = {
  flaky_timing: [' ✓ src/store/cart.test.ts (22 tests) 140ms', ' ❯ src/sync/poller.test.ts (6 tests | 1 failed) 5012ms', '   × poller > emits an update after the interval 5003ms', '     → Test timed out in 5000ms.', 'If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".', ' Test Files  1 failed | 23 passed (24)', '      Tests  1 failed | 311 passed (312)', '   Duration  48.21s', ' ELIFECYCLE  Test failed. See above for more details.', '##[error]Process completed with exit code 1.'],
  flaky_order: [' ❯ src/db/session.test.ts (14 tests | 1 failed) 812ms', '   × session > reuses the pooled connection', "     → expected 'conn-7' to be 'conn-3' // Object.is equality", '   ❯ src/db/session.test.ts:88:31', 'Note: this test passed on the previous 41 runs of main; it shares a global pool with src/db/pool.test.ts, which ran concurrently in this shard.', ' Test Files  1 failed | 23 passed (24)', ' ELIFECYCLE  Test failed.', '##[error]Process completed with exit code 1.'],
  infra_network: ['##[group]Run pnpm install --frozen-lockfile', ' ERR_PNPM_FETCH_503  GET https://registry.npmjs.org/@types%2Fnode: Service Unavailable - 503', 'This error happened while installing a direct dependency of /home/runner/work/webapp', 'Retrying in 10s (attempt 3 of 3)', ' ERR_PNPM_FETCH_503  GET https://registry.npmjs.org/@types%2Fnode: Service Unavailable - 503', '##[error]Process completed with exit code 1.'],
  infra_runner: [' ✓ src/store/cart.test.ts (22 tests) 140ms', '##[error]The runner has received a shutdown signal. This can happen when the runner service is stopped, or a manually started runner is canceled.', '##[error]The operation was canceled.', 'Cleaning up orphan processes', 'Terminate orphan process: pid (4122) (node)'],
  infra_disk: [' ❯ src/build/bundle.test.ts (3 tests | 1 failed)', "   × bundle > writes the production bundle", "     → ENOSPC: no space left on device, write '/home/runner/work/webapp/dist/assets/index-9f2c.js'", 'Filesystem      Size  Used Avail Use% Mounted on', '/dev/root        84G   84G     0 100% /', '##[error]Process completed with exit code 1.'],
  code_assert: [' ❯ src/pricing/discount.test.ts (18 tests | 1 failed) 22ms', '   × discount > applies the loyalty tier before tax', '     → expected 91.8 to be 90 // Object.is equality', '   ❯ src/pricing/discount.test.ts:41:28', ' Test Files  1 failed | 23 passed (24)', ' ELIFECYCLE  Test failed.', '##[error]Process completed with exit code 1.'],
  code_type: ['##[group]Run pnpm typecheck', "src/api/orders.ts(112,19): error TS2339: Property 'shippingAddress' does not exist on type 'Order'.", "src/api/orders.ts(118,7): error TS2322: Type 'string | undefined' is not assignable to type 'string'.", 'Found 2 errors in the same file, starting at: src/api/orders.ts:112', '##[error]Process completed with exit code 2.'],
  code_timeout_bug: [' ❯ src/queue/worker.test.ts (9 tests | 1 failed) 10006ms', '   × worker > drains the queue and resolves', '     → Test timed out in 10000ms.', 'worker.ts: drain() awaiting job 17 of 17 ... awaiting job 17 of 17 ... awaiting job 17 of 17', 'Note: this test has failed on every run since commit 4e1a9c2 ("make drain() await the last ack"), 6 of 6 attempts.', ' ELIFECYCLE  Test failed.', '##[error]Process completed with exit code 1.'],
  code_network_bug: [' ❯ src/api/client.test.ts (31 tests | 2 failed) 380ms', '   × client > fetches the profile from the mock server', '     → request to http://localhost:4010/v2/profile failed, reason: connect ECONNREFUSED 127.0.0.1:4010', '   × client > retries on 502', '     → request to http://localhost:4010/v2/profile failed, reason: connect ECONNREFUSED 127.0.0.1:4010', 'Mock server config (tests/setup.ts): listening on port 4001', ' ELIFECYCLE  Test failed.', '##[error]Process completed with exit code 1.'],
  config_env: [' ❯ src/payments/stripe.test.ts (7 tests | 7 failed)', '   × stripe > creates a payment intent', '     → Error: STRIPE_SECRET_KEY is not set. Add it to the repository secrets.', '   (same error for 6 more tests)', "Note: the workflow file was changed in this PR and no longer passes 'secrets: inherit' to the reusable test job.", '##[error]Process completed with exit code 1.'],
  dep_breaking: ['##[group]Run pnpm install', ' WARN  deprecated lodash.get@4.4.2', 'Progress: resolved 1190, added 1190, done', '##[group]Run pnpm build', "Error: Package subpath './server' is not defined by \"exports\" in /home/runner/work/webapp/node_modules/react-dom/package.json", 'react-dom was resolved to 20.0.0 because the lockfile was regenerated in this PR (^19 -> *)', '##[error]Process completed with exit code 1.'],
};

const plan = [
  ['flaky_timing', 'yes', 1], ['flaky_timing', 'yes', 2], ['flaky_order', 'yes', 1], ['flaky_order', 'yes', 1],
  ['infra_network', 'yes', 1], ['infra_network', 'yes', 2], ['infra_runner', 'yes', 1], ['infra_runner', 'yes', 1],
  ['infra_disk', 'yes', 1], ['infra_disk', 'yes', 2],
  ['code_assert', 'no', 1], ['code_assert', 'no', 2], ['code_assert', 'no', 1], ['code_type', 'no', 1], ['code_type', 'no', 1],
  ['code_timeout_bug', 'no', 1], ['code_timeout_bug', 'no', 2], ['code_timeout_bug', 'no', 1],
  ['code_network_bug', 'no', 1], ['code_network_bug', 'no', 1], ['code_network_bug', 'no', 2],
  ['config_env', 'no', 1], ['config_env', 'no', 1], ['config_env', 'no', 2],
  ['dep_breaking', 'no', 1], ['dep_breaking', 'no', 1],
  ['flaky_timing', 'yes', 1], ['infra_network', 'yes', 1], ['flaky_order', 'yes', 2], ['infra_runner', 'yes', 1],
];

const repos = ['acme/webapp', 'acme/api', 'acme/billing', 'acme/mobile'];
const branches = ['main', 'feature/checkout-v2', 'fix/rounding', 'renovate/react-20'];
const runners = ['ubuntu-latest', 'ubuntu-22.04-large', 'self-hosted-linux-3'];
const cases = plan.map(([kind, retry, attempt], i) => {
  const lines = [...pad(40 - tails[kind].length, setup), ...tails[kind]];
  return {
    id: `retry-${String(i + 1).padStart(3, '0')}`,
    input: {
      repo: repos[i % repos.length],
      branch: branches[i % branches.length],
      runner: runners[i % runners.length],
      job_name: 'test',
      attempt_number: attempt,
      max_attempts: 3,
      log_tail: lines.join('\n'),
      log_lines: lines,
    },
    gold: { retry },
    facts: { cause: kind },
  };
});
writeFileSync(new URL('./retry.cases.json', import.meta.url), JSON.stringify(cases, null, 2) + '\n');
console.log(`${cases.length} cases: ${cases.filter((c) => c.gold.retry === 'yes').length} retry / ${cases.filter((c) => c.gold.retry === 'no').length} no`);
