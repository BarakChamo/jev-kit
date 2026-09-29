// Jev map: pick the single log line that states the cause of a CI job failure.

const MAX_CHOICE_OPTIONS = 255;
const CONFIDENCE_GATE = 0.8;

export function buildState(input) {
  const log_lines = input.log_lines || [];
  return {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    job_name: input.job_name,
    attempt_number: input.attempt_number,
    max_attempts: input.max_attempts,
    line_count: log_lines.length,
    lines: log_lines.map((text, index) => `${index}: ${text}`),
  };
}

export function questions(input) {
  const log_lines = input.log_lines || [];
  // Reserve one option slot for "abstain"; if the log itself won't fit,
  // there is no single question we can ask, so leave this case to a person.
  if (log_lines.length === 0 || log_lines.length > MAX_CHOICE_OPTIONS - 1) {
    return {};
  }

  const criteria = {};
  log_lines.forEach((text, index) => {
    criteria[String(index)] = text;
  });
  criteria.abstain =
    "no single line states a specific cause: the reason is missing, spread across several lines with no one primary line, or the log shows no failure at all";

  return {
    culprit: {
      type: "choice",
      instructions:
        "The `lines` field lists every line of a CI job's log, each prefixed with its 0-based index (the option names below match those indices). This job failed. Which single line most directly states the specific cause of the failure — the exact error message, exception, assertion, or failing condition? Do not pick a generic wrapper or summary line that only reports that the job failed or exited non-zero (for example a line like 'Process completed with exit code 1', 'Test failed. See above for more details', or a pass/fail line count) when some other line states what actually went wrong. If no single line states a specific cause, choose 'abstain'.",
      criteria,
    },
  };
}

export function decide(answers, input) {
  const log_lines = input.log_lines || [];
  const ans = answers && answers.culprit;

  if (!ans || ans.type !== "choice") return { culprit_line: "abstain" };
  if (ans.choice === "abstain") return { culprit_line: "abstain" };
  if ((ans.confidence ?? 0) < CONFIDENCE_GATE) return { culprit_line: "abstain" };

  const index = Number.parseInt(ans.choice, 10);
  if (!Number.isInteger(index) || index < 0 || index >= log_lines.length) {
    return { culprit_line: "abstain" };
  }

  return { culprit_line: index };
}
