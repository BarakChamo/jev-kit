// map.mjs — point developers at the single CI log line that states the cause of a failure.
//
// Encoding: one `choice` whose options are *every* line of `log_lines`, keyed by its 0-based
// index, with a rubric naming the generic lines to skip. That measured pattern scored 100%
// where a noul-per-line scored 13-100% (an absolute "does this line show why the job
// failed?" is also true of wrappers like "##[error]Process completed with exit code 1.").
// No line is pre-filtered out: the right line has survived an agent's regex pre-filter in
// as few as 5/30 cases. All questions go out in one request — one POST per failure.
//
// A `choice` refuses at 256 options, so a log longer than CHUNK lines becomes one choice
// per slice of consecutive lines, and decide() combines the slices in code.
//
// GATE (rule 13): gate on the probability of the label acted on, not the `confidence`
// scalar (under-confident by up to 29 points). 0.8 removed all wrong picks and kept 79% of
// the right ones on 20+-option picks; it is a placeholder — fit it with jev-audit on ~30
// labelled cases. Unsure, and Jev's own abstain option, both become "abstain" (a person):
// unsure never becomes a line. When the top label is wrong the runner-up is usually the
// truth, so the caller should surface the top 2-3 lines where it can.

const MAX_OPTIONS = 255;              // the API's ceiling for a `choice`
const CHUNK = MAX_OPTIONS - 1;        // leave room for the `none_of_these_lines` option
const NONE = 'none_of_these_lines';
const GATE = 0.8;                     // placeholder — fit with jev-audit before trusting

const linesOf = (input) => (Array.isArray(input?.log_lines) ? input.log_lines : []);

// Slices [lo, hi) of the log, each small enough to be one question's option set.
const slices = (lines) => {
  const out = [];
  for (let lo = 0; lo < lines.length; lo += CHUNK) out.push([lo, Math.min(lo + CHUNK, lines.length)]);
  return out;
};

export function buildState(input) {
  return {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    job_name: input.job_name,
    attempt_number: input.attempt_number, // explains why whole groups of lines can repeat
    max_attempts: input.max_attempts,
    log_lines: input.log_lines,           // the whole log, unfiltered: long states are cheap
  };
}

export function questions(input) {
  const lines = linesOf(input);
  const sp = slices(lines);
  const qs = {};
  sp.forEach(([lo, hi], ci) => {
    const criteria = {};
    for (let i = lo; i < hi; i++) criteria[String(i)] = lines[i] === '' ? '(empty line)' : lines[i];
    criteria[NONE] =
      'no option above is the line that states the specific cause: the cause line is not among these options, or no single line in `log_lines` states a specific cause, or several unrelated errors each state one and a person should decide';
    const range =
      sp.length === 1
        ? 'The options are every line of `log_lines`, keyed by each line\'s 0-based index into `log_lines`.'
        : `The options are lines ${lo} to ${hi - 1} of \`log_lines\` (the log is longer than one question can list), keyed by each line's 0-based index into \`log_lines\`.`;
    qs[`chunk${ci}`] = {
      type: 'choice',
      instructions:
        'Which one line of `log_lines` states the specific cause of the failure the log shows? ' +
        range +
        ' Pick the line that names what went wrong, most specifically: the error message, the thrown exception, or the failed assertion. ' +
        'Do not pick a generic wrapper (for example "##[error]Process completed with exit code 1." or "ELIFECYCLE  Test failed. See above for more details."), ' +
        'a summary or tally (for example " Test Files  1 failed | 23 passed (24)" or " ❯ src/sync/poller.test.ts (6 tests | 1 failed) 5012ms"), ' +
        'a group marker or echoed command, an advice line telling the reader what to change, or a stack frame below the error line. ' +
        'If a failing test\'s name and its error message are on different lines, pick the error message line. ' +
        'If the same error line appears more than once (for example across repeated attempts of this job), pick its last occurrence. ' +
        `If the specific cause line is not among these options, or no line states a specific cause, or several unrelated errors each state one, pick "${NONE}".`,
      criteria,
    };
  });
  return qs;
}

export function decide(answers, input) {
  const lines = linesOf(input);
  const abstain = { culprit_line: 'abstain' };
  if (!lines.length) return abstain;
  const gated = [];
  slices(lines).forEach((_, ci) => {
    const a = answers?.[`chunk${ci}`];
    if (!a || typeof a.choice !== 'string') return;                      // no answer: not a pick
    const idx = Number(a.choice);
    if (!Number.isInteger(idx) || idx < 0 || idx >= lines.length) return; // NONE, not a line
    const p = a.probabilities?.[a.choice] ?? 0;
    if (p >= GATE) gated.push({ idx, p, text: lines[idx] });            // gate on the label we act on
  });
  // Nothing above the gate, or Jev took its own abstain option: a person decides.
  if (gated.length === 0) return abstain;
  // Two different lines held with confidence are several unrelated errors: a person decides.
  // (Within one slice the gate already catches that: the probability splits between them.)
  if (new Set(gated.map((g) => g.text)).size > 1) return abstain;
  // One error, possibly repeated across attempts: strongest read, latest occurrence first.
  gated.sort((x, y) => y.p - x.p || y.idx - x.idx);
  return { culprit_line: gated[0].idx };
}
