const MAX_LINE_OPTIONS = 254;
const MIN_PROBABILITY = 0.8;
const ABSTAIN = "abstain";

export function buildState(input) {
  return {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    job_name: input.job_name,
    attempt_number: input.attempt_number,
    max_attempts: input.max_attempts,
    log_lines: Array.isArray(input.log_lines) ? input.log_lines : [],
    convention:
      "The cause line is the single log line that states the specific error, exception, failed assertion, timeout, missing dependency, or other immediate reason the job failed. Generic wrappers such as an exit code, 'command failed', summaries, stack frames, group markers, and passing-test output are not the cause line.",
  };
}

export function questions(input) {
  const lines = Array.isArray(input.log_lines) ? input.log_lines : [];

  if (lines.length === 0 || lines.length > MAX_LINE_OPTIONS) {
    return {
      unsupported_log_size: {
        type: "choice",
        instructions:
          "Is `log_lines` small enough to select one cause line without omitting any lines?",
        criteria: {
          no: "There are no log lines or there are more than 254 log lines.",
        },
      },
    };
  }

  return {
    culprit: {
      type: "choice",
      instructions:
        "Which single line in `log_lines` states the specific immediate cause of the CI job failure? Choose the error message, exception, failed assertion, timeout, or equivalent cause. Do not choose a generic wrapper such as an exit code, a summary count, a stack frame below an error, a group marker, or passing output. Choose `abstain` when no single line states the cause or the evidence is genuinely ambiguous.",
      criteria: {
        ...Object.fromEntries(
          lines.map((line, index) => [
            String(index),
            `Line ${index}: ${String(line)}`,
          ]),
        ),
        [ABSTAIN]:
          "No single log line states a specific cause, or more than one line is equally supported.",
      },
    },
  };
}

export function decide(answers, input) {
  const lines = Array.isArray(input.log_lines) ? input.log_lines : [];
  if (lines.length === 0 || lines.length > MAX_LINE_OPTIONS) {
    return { culprit_line: ABSTAIN };
  }

  const answer = answers?.culprit;
  const choice = answer?.choice;
  const probability = answer?.probabilities?.[choice] ?? 0;
  const index = Number(choice);

  if (
    choice === ABSTAIN ||
    probability < MIN_PROBABILITY ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= lines.length
  ) {
    return { culprit_line: ABSTAIN };
  }

  return { culprit_line: index };
}
