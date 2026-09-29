// Points developers at the single log line that states the cause of a CI failure.
// Design: one `choice` over EVERY log line (never pre-filtered — the right line must
// reach the model), with a rubric naming the generic lines to skip, a `none` abstain
// option, and a gate on the probability of the chosen label. Low confidence and
// "no cause line" both go to a person, never to a guess.

const MAX_OPTIONS = 255; // API refuses a choice with 256+ options
const NO_CAUSE = "none";
const ACT_AT = 0.8; // act only when the chosen label's probability is high; else a person looks

export function buildState(input) {
  return {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    job_name: input.job_name,
    attempt_number: input.attempt_number,
    max_attempts: input.max_attempts,
    // Domain convention, written once: how a CI log states the cause of a failure.
    how_to_read_ci_logs:
      "In a CI log, the line that states the cause of a failure is the specific error itself: " +
      "an error message, exception, or failed assertion (for example 'Test timed out in 5000ms.' " +
      "or 'AssertionError: expected 3 to equal 4'). It is NOT a line that merely names the failing " +
      "test or step (such as '× suite > test name'), NOT a generic wrapper (such as " +
      "'##[error]Process completed with exit code 1.' or 'ELIFECYCLE  Test failed.'), NOT a " +
      "summary count (such as 'Test Files  1 failed | 23 passed (24)' or 'Tests  1 failed'), and " +
      "NOT a stack frame printed below the error. The cause line usually appears near the end of " +
      "the log, just before those wrapper and summary lines.",
    log_lines: input.log_lines,
  };
}

export function questions(input) {
  const lines = Array.isArray(input.log_lines) ? input.log_lines : [];
  // If the log does not fit in one choice, we cannot send every line. Abstain
  // (empty map -> decide abstains) rather than pre-filter and risk hiding the cause.
  if (lines.length === 0 || lines.length > MAX_OPTIONS - 1) return {};
  return {
    culprit: {
      type: "choice",
      instructions:
        "Which single line of `log_lines` states the specific cause of the failure of the job named " +
        "in `job_name`: the error message, exception, or failed assertion itself? Apply the convention " +
        "in `how_to_read_ci_logs`. Do not pick a line that only names the failing test, a generic " +
        "wrapper such as '##[error]Process completed with exit code 1.' or 'ELIFECYCLE ...', a summary " +
        "count such as 'Test Files  1 failed | 23 passed (24)', or a stack frame below the error. " +
        "If no line states a specific cause, choose `none`.",
      criteria: {
        ...Object.fromEntries(lines.map((text, i) => [String(i), String(text)])),
        [NO_CAUSE]:
          "No line in `log_lines` states a specific cause of the failure; a person should read the log.",
      },
    },
  };
}

export function decide(answers, input) {
  const a = answers && answers.culprit;
  const lines = Array.isArray(input.log_lines) ? input.log_lines : [];
  if (!a || typeof a.choice !== "string") return { culprit_line: "abstain" };
  if (a.choice === NO_CAUSE) return { culprit_line: "abstain" };
  const i = Number(a.choice);
  if (!Number.isInteger(i) || i < 0 || i >= lines.length) return { culprit_line: "abstain" };
  const p = (a.probabilities && a.probabilities[a.choice]) ?? 0;
  if (p < ACT_AT) return { culprit_line: "abstain" }; // unsure -> a person, never a guess
  return { culprit_line: i };
}
