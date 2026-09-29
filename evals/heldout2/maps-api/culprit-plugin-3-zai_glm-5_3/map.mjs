// CI failure culprit-line map.
// Pattern: one `choice` over EVERY log line (no pre-filtering, rule 16), with a rubric
// naming the generic wrapper lines to skip (rule 10). Gate on the probability of the
// chosen label; unsure -> abstain, never a guess (rule 13). One extra "none" option so
// the model can say no line states a cause at all (rule 14).

const ACT = 0.8; // gate fitted value; below this, a person looks at the log

export function buildState(input) {
  // Keep every line: the cause line is often far from the tail, and pre-filtering
  // with a regex has measured recall as low as 5/30.
  return {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    job_name: input.job_name,
    attempt_number: input.attempt_number,
    max_attempts: input.max_attempts,
    log_lines: input.log_lines.map((text, i) => `${i}: ${text}`),
  };
}

export function questions(input) {
  const lineCriteria = Object.fromEntries(
    input.log_lines.map((text, i) => [String(i), text])
  );
  return {
    culprit: {
      type: "choice",
      instructions:
        "Which line of `log_lines` states the specific cause of the CI job's failure: the error message, exception, failed assertion, or timeout message? " +
        "Prefer the most specific line (the test name and the timeout reason over a summary). " +
        "Do NOT pick a generic wrapper (for example 'Process completed with exit code 1'), " +
        "a summary count (for example '1 failed | 23 passed'), a package-manager lifecycle line " +
        "(for example 'ELIFECYCLE Test failed'), a stack frame above the error, or a successful " +
        "step's output. Pick `none` if no line states a specific cause (for example the log is " +
        "truncated before the error, or the run has no failure).",
      criteria: {
        ...lineCriteria,
        none: "no line in `log_lines` states the specific cause of the failure",
      },
    },
  };
}

export function decide(answers, input) {
  const a = answers.culprit;
  if (!a || a.choice === undefined) return { culprit_line: "abstain" };
  const p = a.probabilities?.[a.choice] ?? 0;
  if (a.choice === "none" || p < ACT) return { culprit_line: "abstain" };
  const i = Number(a.choice);
  if (!Number.isInteger(i) || i < 0 || i >= input.log_lines.length) {
    return { culprit_line: "abstain" };
  }
  return { culprit_line: i };
}
