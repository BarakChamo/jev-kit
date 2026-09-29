// Jev map: pick the single log line that states the cause of a CI failure.

const MAX_LINES = 255; // choice questions cap at 255 options
const CONFIDENCE_GATE = 0.8; // fit against jev-eval; start here per skill guidance
const CLEAR_CAUSE_GATE = 0.6;

export function buildState(input) {
  const log_lines = input.log_lines || [];
  return {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    job_name: input.job_name,
    attempt_number: input.attempt_number,
    max_attempts: input.max_attempts,
    // 0-based index matches the index into the original input.log_lines array.
    lines: log_lines.map((text, index) => ({ index, text })),
  };
}

export function questions(input) {
  const log_lines = input.log_lines || [];
  if (log_lines.length === 0 || log_lines.length > MAX_LINES) {
    // Nothing to ask: empty log, or too many lines for a single choice
    // (never pre-filter candidates with unmeasured code; abstain instead).
    return {};
  }

  const criteria = {};
  log_lines.forEach((text, index) => {
    criteria[String(index)] = text;
  });

  return {
    clear_cause: {
      type: "noul",
      instructions:
        "Do the log lines in `lines` contain at least one line that specifically " +
        "names the technical cause of this CI job's failure (e.g. a specific error " +
        "message, exception, failed assertion, or timeout reason)?",
      criteria: {
        true: "at least one line specifically identifies the technical cause of the failure",
        false:
          "no line identifies a specific cause; the log only shows generic failure " +
          "indicators (exit codes, lifecycle messages, summary counts) or is otherwise inconclusive",
      },
    },
    culprit: {
      type: "choice",
      instructions:
        "Each option key is the 0-based index of a line in `lines` in the state, and its " +
        "description is that line's text. `job_name` is the job that failed, and `attempt_number` " +
        "of `max_attempts` says which attempt this is; if the log shows more than one attempt, the " +
        "relevant failure is the one in the final attempt shown. Choose the index of the single line " +
        "that most specifically states the cause of the failure: the actual error message, exception, " +
        "failed assertion, or timeout reason. Do not choose a generic wrapper line such as " +
        "'##[error]Process completed with exit code N', a lifecycle line like " +
        "'ELIFECYCLE ... Test failed', or a summary count line like 'Tests  1 failed | 311 passed'.",
      criteria,
    },
  };
}

export function decide(answers, input) {
  const log_lines = input.log_lines || [];
  if (log_lines.length === 0 || log_lines.length > MAX_LINES) {
    return { culprit_line: "abstain" };
  }

  const clear = answers.clear_cause;
  const pick = answers.culprit;
  if (!clear || !pick) return { culprit_line: "abstain" };
  if (clear.noul < CLEAR_CAUSE_GATE) return { culprit_line: "abstain" };
  if (pick.confidence < CONFIDENCE_GATE) return { culprit_line: "abstain" };

  const idx = Number(pick.choice);
  if (!Number.isInteger(idx) || idx < 0 || idx >= log_lines.length) {
    return { culprit_line: "abstain" };
  }

  return { culprit_line: idx };
}
