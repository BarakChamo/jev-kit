// Jev map: point developers at the single log line that states the cause of a CI failure.
//
// Measured design (jev-questions skill):
//  - one `choice` offering EVERY line, no code pre-filter (a regex narrowing kept
//    the true culprit in as few as 5/30 cases; the offer-every-line choice scored 100%)
//  - the rubric names the generic decoys to skip: exit-code wrappers, summary counts,
//    stack frames below the error, passing/setup-step noise
//  - a `none_here` option AND a probability gate: together they catch ~2x the
//    ambiguous cases either one catches alone
//  - gate on the picked label's probability, never the `confidence` scalar
//    (under-confident by up to 29 points). GATE is a placeholder: fit it with
//    jev-audit on ~30 labelled cases before trusting it.

const MAX_OPTIONS = 255; // the API refuses beyond 255 options rather than truncating
const GATE = 0.8;        // placeholder; 0.8 removed all 6 wrong picks and kept 79% of the right ones

export function buildState(input) {
  return {
    repo: input.repo,
    job_name: input.job_name,
    // Every line, unfiltered, in order. Never narrow these in code.
    log_lines: input.log_lines ?? [],
    // Hand-written domain conventions, stated once (not generated per case).
    log_conventions: [
      'Vitest: "✓ file (n tests)" and "✓ name" are passing; "❯ file (n tests | k failed)" marks a file containing failures;',
      '"× name" only names a failed test; the "→" line beneath it states the reason (timeout, expected/actual diff, exception) and is the line that states the cause.',
      '"Test Files" / "Tests" / "Duration" lines are summary counts.',
      '"ELIFECYCLE  Test failed. See above for more details." and "##[error]Process completed with exit code 1." are generic wrappers.',
      'In any other framework the equivalent holds: the error message, exception or failed assertion states the cause; wrappers, summaries and stack frames below the error do not.',
    ].join(' '),
  };
}

export function questions(input) {
  const lines = input.log_lines ?? [];
  const qs = {};
  // All questions go in ONE request (splitting into per-question requests cost
  // 11.7x for identical answers). One `choice` per slice of at most 254 lines
  // plus a none option, so every line is offered and the 255-option limit holds.
  const SLICE = MAX_OPTIONS - 1;
  for (let c = 0; c * SLICE < lines.length; c++) {
    const base = c * SLICE;
    const last = base + Math.min(SLICE, lines.length - base) - 1;
    qs[`culprit_${c}`] = {
      type: 'choice',
      instructions:
        'Which line of `log_lines` states the specific cause of the failure: the error message, exception or failed assertion? ' +
        `This question covers only \`log_lines\` indices ${base} to ${last}; every option below is one of those lines, labelled by its index. ` +
        'Follow `log_conventions`. Do not pick a generic wrapper (for example "##[error]Process completed with exit code 1." or ' +
        '"ELIFECYCLE  Test failed. See above for more details."), a summary count (for example " Test Files  1 failed | 23 passed (24)"), ' +
        'a stack frame below the error, a line from a passing or setup step, or a line that only names a failed test when a ' +
        'following line states the reason. If no option below states the cause, pick none_here.',
      criteria: {
        ...Object.fromEntries(
          lines.slice(base, base + SLICE).map((text, j) => [String(base + j), text])
        ),
        none_here: 'none of the lines above states the specific cause of the failure',
      },
    };
  }
  return qs;
}

export function decide(answers, input) {
  const lines = input.log_lines ?? [];
  let best = null; // { i, p }
  for (const a of Object.values(answers ?? {})) {
    if (!a || typeof a.choice !== 'string') continue;
    const i = Number(a.choice);
    if (a.choice === 'none_here' || !Number.isInteger(i) || i < 0 || i >= lines.length) continue;
    const p = a.probabilities?.[a.choice] ?? 0;
    if (!best || p > best.p) best = { i, p };
  }
  // Gate on the probability of the label we act on. Unsure or no-cause-stated
  // goes to a person (show them the top 2-3 candidate lines), never a guess.
  if (!best || best.p < GATE) return { culprit_line: 'abstain' };
  return { culprit_line: best.i };
}
