// Points at the single log line that states the concrete cause of a CI job failure.

const MAX_CHOICE_OPTIONS = 255;

// A choice question caps out at 255 options. Root causes live near the end of the
// log by CI convention (retries/duplicated setup steps precede the real attempt),
// so when a log is longer than that we keep the tail rather than the head.
function candidateIndices(logLines) {
  const n = logLines.length;
  if (n <= MAX_CHOICE_OPTIONS) {
    return Array.from({ length: n }, (_, i) => i);
  }
  const start = n - MAX_CHOICE_OPTIONS;
  return Array.from({ length: MAX_CHOICE_OPTIONS }, (_, i) => start + i);
}

export function buildState(input) {
  return {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    job_name: input.job_name,
    attempt_number: input.attempt_number,
    max_attempts: input.max_attempts,
    total_lines: input.log_lines.length,
    log_lines: input.log_lines.map((text, index) => ({ index, text })),
    log_convention:
      "This is a CI job log. Lines such as '##[error]Process completed with exit code N', " +
      "'ELIFECYCLE ... Test failed. See above for details', a summary count of failed/passed " +
      "tests, or a bare non-zero exit status are generic wrapper lines: they report only that " +
      "something failed, never why. The concrete cause is a different, more specific line: an " +
      "assertion message, thrown exception, stack trace line, compiler/linker error, timeout " +
      "message, or similar. If the log contains repeated setup/test sections (retried attempts), " +
      "the cause belongs to the final attempt, not an earlier one.",
  };
}

export function questions(input) {
  const candidates = candidateIndices(input.log_lines);
  const criteria = {};
  for (const i of candidates) {
    criteria[String(i)] = input.log_lines[i];
  }

  return {
    culprit: {
      type: "choice",
      instructions:
        "`log_lines` in state lists this CI job's log, each entry with its 0-based index and " +
        "text; `log_convention` explains how to read it. Exactly one of the options below is the " +
        "index of the single line whose text states the concrete, specific cause of this job's " +
        "failure. Do not pick a generic wrapper line that only reports that the job failed or " +
        "exited non-zero — pick the specific line beneath it that explains why.",
      criteria,
    },
    has_clear_cause: {
      type: "noul",
      instructions:
        "Do `log_lines` in state contain exactly one line stating a specific, identifiable cause " +
        "of the failure (a distinct assertion, exception, compiler error, or timeout message), " +
        "rather than only generic pass/fail or exit-code lines, or several equally specific but " +
        "unrelated error messages?",
      criteria: {
        true: "exactly one line states a specific, identifiable cause",
        false: "no line states a specific cause, or multiple unrelated specific causes are present",
      },
    },
  };
}

const CHOICE_CONFIDENCE_GATE = 0.8;
const CLEAR_CAUSE_GATE = 0.5;

export function decide(answers, input) {
  if (!input.log_lines || input.log_lines.length === 0) {
    return { culprit_line: "abstain" };
  }

  const culprit = answers.culprit;
  const hasClearCause = answers.has_clear_cause;

  if (!culprit || !hasClearCause) {
    return { culprit_line: "abstain" };
  }

  if (hasClearCause.noul < CLEAR_CAUSE_GATE) {
    return { culprit_line: "abstain" };
  }

  if (culprit.confidence < CHOICE_CONFIDENCE_GATE) {
    return { culprit_line: "abstain" };
  }

  const index = Number(culprit.choice);
  if (!Number.isInteger(index) || index < 0 || index >= input.log_lines.length) {
    return { culprit_line: "abstain" };
  }

  return { culprit_line: index };
}
