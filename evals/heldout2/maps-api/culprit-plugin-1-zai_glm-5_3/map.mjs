// Culprit-line pointer for CI failures.
// Pattern: one `choice` over ALL log lines (no pre-filter), with a rubric naming the
// generic wrappers to skip; an `ambiguous` option plus a probability gate for abstain.
// Logs longer than the API's 255-option limit are chunked — every line stays a candidate,
// we just take the argmax probability across chunks in code.

const CHUNK = 250; // 250 line options + 1 `ambiguous` option per choice question
const ACT_GATE = 0.8; // gate on p(label you act on); wrong pointers erode trust

export function buildState(input) {
  return {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    job_name: input.job_name,
    attempt_number: input.attempt_number,
    max_attempts: input.max_attempts,
    log_lines: input.log_lines,
    // Domain convention, written once (rule 3): what a cause line is and is not.
    convention:
      'In CI logs, the line that states the cause of a failure is the specific error message, exception, or failed assertion. ' +
      'Generic wrappers such as "##[error]Process completed with exit code 1" or "ELIFECYCLE Test failed. See above..." only report that the job failed, not why. ' +
      'Summary counts such as "Test Files 1 failed | 23 passed" count failures without naming one. Stack frames below the error repeat it rather than state it.',
  };
}

export function questions(input) {
  const lines = input.log_lines;
  const qs = {};
  for (let start = 0; start < lines.length; start += CHUNK) {
    const chunk = lines.slice(start, start + CHUNK);
    const criteria = Object.fromEntries(
      chunk.map((text, i) => [String(start + i), text.length > 200 ? text.slice(0, 200) + '…' : text])
    );
    criteria.ambiguous = 'no line states the specific cause of the failure; a person should decide';
    qs['culprit_' + start] = {
      type: 'choice',
      instructions:
        'Which line of `log_lines` states the specific cause of the failure: the error message, exception, or failed assertion? ' +
        'Per the convention in `convention`: not a generic wrapper such as "##[error]Process completed with exit code 1", ' +
        'not a summary count such as "Test Files 1 failed | 23 passed", not a stack frame below the error. ' +
        'If no line in `log_lines` states the specific cause, choose `ambiguous`.',
      criteria,
    };
  }
  if (!lines.length) {
    qs.culprit_0 = {
      type: 'choice',
      instructions: 'The log in `log_lines` is empty. Choose `ambiguous`.',
      criteria: { ambiguous: 'no line states the specific cause of the failure; a person should decide' },
    };
  }
  return qs;
}

export function decide(answers, input) {
  let best = null;
  for (const a of Object.values(answers || {})) {
    if (!a || a.type !== 'choice' || a.choice === undefined || a.choice === 'ambiguous') continue;
    const idx = Number(a.choice);
    if (!Number.isInteger(idx) || idx < 0 || idx >= input.log_lines.length) continue;
    const p = (a.probabilities && a.probabilities[a.choice]) ?? 0;
    // Gate on the probability of the label we act on; below the gate, escalate, never guess.
    if (p >= ACT_GATE && (!best || p > best.p)) best = { idx, p };
  }
  return best ? best.idx : 'abstain';
}
