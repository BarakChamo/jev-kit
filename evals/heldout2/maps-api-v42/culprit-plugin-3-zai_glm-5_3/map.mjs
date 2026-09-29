// map.mjs — point developers at the one log line that states why a CI job failed.
//
// Design, per the jev-questions skill:
//   rule 1 + 16: the whole log goes to Jev. No regex pre-filter — pre-filtering kept
//     the right line in as few as 5 of 30 cases in the study. Long states are cheap.
//   rule 10: picking one of many is ONE `choice` over every line, keyed by index, with
//     a rubric naming the generic lines to skip (measured 100%, where a noul per line
//     scored 13-100% because wrapper lines truthfully "show a failure").
//   rule 14: `none_here` is an abstain option for logs that hold only wrappers; the
//     probability gate below catches the rest of the ambiguous tail.
//   rule 13: gate on the probability of the line we act on, not `confidence` (which
//     ran under-confident by up to 29 points). GATE is a placeholder: over 379 picks
//     from 20+ lines, 0.8 removed all wrong picks and kept 79% of the right ones —
//     fit it on ~30 labelled failures with jev-audit before trusting it.
//   Logs longer than 250 lines split into chunked choices (the API refuses >255
//   options); the chunks' line probabilities are compared in code.

const CHUNK = 250; // 250 lines + none_here = 251 options, under the 255 limit
const GATE = 0.8;

const logLines = (input) => (Array.isArray(input.log_lines) ? input.log_lines : []);

export function buildState(input) {
  return {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    job_name: input.job_name,
    attempt_number: input.attempt_number,
    max_attempts: input.max_attempts,
    log_lines: logLines(input), // the full log is the evidence; metadata is context
  };
}

export function questions(input) {
  const lines = logLines(input);
  const qs = {};
  for (let from = 0; from < lines.length; from += CHUNK) {
    const to = Math.min(from + CHUNK, lines.length) - 1;
    const criteria = {};
    for (let i = from; i <= to; i++) criteria[String(i)] = lines[i];
    criteria.none_here = 'no line in this range states the cause of the failure';
    qs[`culprit_${Math.floor(from / CHUNK)}`] = {
      type: 'choice',
      instructions:
        'The CI job whose log is in `log_lines` failed. Which line of `log_lines` states the specific cause of the failure? ' +
        `The options are keyed by each line's index in \`log_lines\` and show its text; this question covers indexes ${from} to ${to}. ` +
        'Pick the single best line: the one that says what went wrong and why — an error message, an exception, an expected-vs-actual assertion failure, or a timeout reason such as "Test timed out in 5000ms.". ' +
        'If no line in this range gives a reason, pick the most specific failure line instead, such as the line naming the failing test or the command that errored. ' +
        'Never pick a generic wrapper ("##[error]Process completed with exit code 1", "ELIFECYCLE Test failed", "npm ERR!"), a summary count ("Test Files  1 failed | 23 passed"), a step header or successful step output, a stack frame below the error message, or a hint about how to fix the problem. ' +
        'If nothing in this range states the cause, pick none_here.',
      criteria,
    };
  }
  return qs;
}

export function decide(answers, input) {
  const lines = logLines(input);
  let best = -1;
  let bestP = 0;
  for (const [id, a] of Object.entries(answers ?? {})) {
    if (!id.startsWith('culprit_') || !a || a.choice === undefined || a.choice === 'none_here') continue;
    const i = Number(a.choice);
    if (!Number.isInteger(i) || i < 0 || i >= lines.length) continue;
    const p = a.probabilities?.[a.choice] ?? 0;
    if (p > bestP) { best = i; bestP = p; }
  }
  // Below the gate a person reads the log instead; doubt never relaxes into a pick.
  return { culprit_line: best >= 0 && bestP >= GATE ? best : 'abstain' };
}
