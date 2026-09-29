export function buildState(input) {
  return {
    log_lines: input.log_lines,
    convention: "CI logs run top to bottom. Lines starting with ##[group] or ##[endgroup], install output, and lines starting with \u2713 are setup or passing steps, never the cause. Trailing lines such as Process completed with exit code 1, ##[error] lines, ELIFECYCLE Test failed, summary counts like Test Files or Tests, and Duration lines are generic wrappers and summaries, never the cause. The cause is the specific error line: the failed assertion, exception message, timeout message such as Test timed out in 5000ms, or the failing-test line starting with \u00D7."
  };
}

export function questions(input) {
  const lines = Array.isArray(input.log_lines) ? input.log_lines : [];
  if (lines.length === 0 || lines.length > 255) return {};
  const criteria = {};
  for (let i = 0; i < lines.length; i++) {
    const text = String(lines[i]);
    criteria[String(i)] = text.trim() === "" ? "(blank line)" : text;
  }
  if (lines.length === 255) {
    return {
      culprit: {
        type: "choice",
        instructions: "Which line of `log_lines` states the specific cause of the failure: the error message, exception, failed assertion, timeout message, or failing-test line? Do not choose a generic wrapper such as Process completed with exit code 1, a ##[error] line, ELIFECYCLE Test failed, a summary count such as Test Files or Tests, a Duration line, a setup or install line, or a passing line starting with \u2713.",
        criteria
      }
    };
  }
  criteria["no_single_line"] = "no single line in `log_lines` states the specific cause of the failure";
  return {
    culprit: {
      type: "choice",
      instructions: "Which line of `log_lines` states the specific cause of the failure: the error message, exception, failed assertion, timeout message, or failing-test line? Do not choose a generic wrapper such as Process completed with exit code 1, a ##[error] line, ELIFECYCLE Test failed, a summary count such as Test Files or Tests, a Duration line, a setup or install line, or a passing line starting with \u2713. If no single line in `log_lines` states the specific cause, choose `no_single_line`.",
      criteria
    }
  };
}

export function decide(answers, input) {
  const lines = Array.isArray(input.log_lines) ? input.log_lines : [];
  if (lines.length === 0 || lines.length > 255) return { culprit_line: "abstain" };
  const a = answers ? answers.culprit : undefined;
  if (!a || typeof a.choice !== "string") return { culprit_line: "abstain" };
  if (a.choice === "no_single_line") return { culprit_line: "abstain" };
  const p = a.probabilities ? a.probabilities[a.choice] : undefined;
  if (typeof p !== "number" || p < 0.8) return { culprit_line: "abstain" };
  if (!/^\d+$/.test(a.choice)) return { culprit_line: "abstain" };
  const idx = Number(a.choice);
  if (!Number.isInteger(idx) || idx < 0 || idx >= lines.length) return { culprit_line: "abstain" };
  return { culprit_line: idx };
}
