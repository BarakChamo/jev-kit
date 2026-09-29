// Jev map: point developers at the single log line that states the cause of a CI failure.
//
// Encoding: one `choice` over every line (for picking one of many; a `noul` per line measured
// 13-100% on this task, because a wrapper line truthfully "shows the job failed"). No
// pre-filtering: every line is an option. Logs longer than the 255-option limit are split into
// windows, each with its own "none of these lines" option, and the winner is the
// highest-probability line pick across windows. Decisions gate on the picked line's own
// probability, never on the confidence scalar, and never relax into a weaker outcome.

const GATE = 0.8;   // placeholder gate: over 20+ options, 0.8 removed every wrong pick and kept
                    // 79% of the right ones. Refit per question with jev-audit before trusting it.
const WINDOW = 250; // 250 lines + the none option = 251 options, under the 255-option limit.
const NONE = 'none_of_these_lines';

export function buildState(input) {
  return {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    job_name: input.job_name,
    attempt_number: input.attempt_number,
    max_attempts: input.max_attempts,
    log_lines: input.log_lines ?? [], // the source, sent in full
    log_conventions: `GitHub Actions CI log conventions: each step's output sits between a "##[group]Run …" marker and "##[endgroup]"; those markers and the command banners under them name what is being run, never why it failed. "✓" lines are passing tests. "❯ file (n tests | m failed)", "Test Files 1 failed | 23 passed", "ELIFECYCLE  Test failed" and "##[error]Process completed with exit code 1." are roll-ups: they say the run failed, not why. When a test fails, the "×" line names the failing test and the "→" line under it states the reason; the reason line is the one that states the cause. Generic advice ("If this is a long-running test, pass a timeout value…") is guidance, not a cause. When several distinct errors appear, the first is usually the root cause and the rest are its consequences.`,
  };
}

export function questions(input) {
  const lines = input.log_lines ?? [];
  const spans = [];
  for (let s = 0; s < lines.length; s += WINDOW) spans.push([s, Math.min(s + WINDOW, lines.length)]);
  const skip =
    'Skip what does not state a cause: "##[group]Run …" and "##[endgroup]" step markers, command banners and echoes ("> webapp@2.14.0 test", " RUN v3.2.4"), passing "✓" lines, checkout, install and progress noise, per-file tallies ("❯ src/… (6 tests | m failed)"), summary counts ("Test Files 1 failed | 23 passed"), roll-ups ("ELIFECYCLE  Test failed. See above for more details."), generic advice ("If this is a long-running test, pass a timeout value…"), the generic exit-code wrapper ("##[error]Process completed with exit code 1."), and stack frames below an error message. A "##[error]…" line that states a concrete cause (a runner shutdown signal, a cancelled job) does state one.';
  const qs = {};
  spans.forEach(([s, e], w) => {
    const single = spans.length === 1;
    const lead = single
      ? `Following \`log_conventions\`, which line of \`log_lines\` states the specific cause of the failure in this CI run: the error message, exception, failed assertion or stated reason?`
      : `This question covers only lines ${s} to ${e - 1} of \`log_lines\`, exactly the lines listed as the options below. Following \`log_conventions\`, which of these lines states the specific cause of the failure in this CI run: the error message, exception, failed assertion or stated reason?`;
    const tail = single
      ? `If no single line states a specific cause of the failure, choose "${NONE}".`
      : `If none of these lines states a specific cause of the failure, choose "${NONE}"; the cause may sit in another part of the log.`;
    qs[`culprit_${w}`] = {
      type: 'choice',
      instructions: `${lead} For a failed test, the reason line under the "×" line (for example "→ Test timed out in 5000ms.") states the cause; the "×" line only names the test, so pick it only when no reason line follows. If one failure is described by several lines, pick the most specific line; if several distinct errors appear, pick the first one. ${skip} ${tail}`,
      criteria: {
        ...Object.fromEntries(
          lines.slice(s, e).map((text, i) => [String(s + i), text || '(blank line)']),
        ),
        [NONE]: single
          ? 'no line in this run states a specific cause of the failure - only step commands, passing output, tallies, roll-ups or the exit-code wrapper appear'
          : `no line from ${s} to ${e - 1} of \`log_lines\` states the specific cause of the failure`,
      },
    };
  });
  return qs;
}

export function decide(answers, input) {
  const lines = input.log_lines ?? [];
  let best = null; // best line pick across all questions: { idx, p }
  for (const [id, a] of Object.entries(answers ?? {})) {
    if (!/^culprit_\d+$/.test(id) || !a || typeof a.choice !== 'string') continue;
    if (a.choice === NONE || !/^\d+$/.test(a.choice)) continue;
    const idx = Number(a.choice);
    if (!(idx >= 0 && idx < lines.length)) continue;
    const p = a.probabilities?.[a.choice] ?? 0;
    if (!best || p > best.p) best = { idx, p };
  }
  // Point at a line only when that line is itself likely enough; otherwise a person reads the log.
  return { culprit_line: best && best.p >= GATE ? best.idx : 'abstain' };
}
