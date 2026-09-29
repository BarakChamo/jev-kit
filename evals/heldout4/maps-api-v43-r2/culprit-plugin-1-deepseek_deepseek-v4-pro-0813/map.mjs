const CULPRIT_GATE = 0.8;
const MAX_CHOICE_OPTIONS = 255;

export function buildState(input) {
  return {
    log_lines: input.log_lines,
  };
}

export function questions(input) {
  const lines = Array.isArray(input?.log_lines) ? input.log_lines : [];

  if (lines.length === 0 || lines.length > MAX_CHOICE_OPTIONS) {
    return {};
  }

  const criteria = {};
  for (let i = 0; i < lines.length; i += 1) {
    criteria[String(i)] = lines[i];
  }

  return {
    culprit_line: {
      type: "choice",
      instructions:
        "Which line of `log_lines` states the specific cause of the failure? Choose the most direct cause: the assertion/error message, exception text, timeout reason, or other specific failure detail. Do not choose a command header or group line, a progress line, a summary count line, a generic wrapper such as `##[error]Process completed with exit code 1.` or `ELIFECYCLE Test failed. See above for more details.`, or a stack frame below the error. If the failure is a test failure, choose the line with the error or assertion detail (for example `→ Test timed out in 5000ms.`), not the line that only names the failing test.",
      criteria,
    },
  };
}

export function decide(answers, input) {
  const lines = Array.isArray(input?.log_lines) ? input.log_lines : [];
  const answer = answers?.culprit_line;

  if (!answer || !answer.probabilities || typeof answer.choice !== "string") {
    return { culprit_line: "abstain" };
  }

  const choice = answer.choice;
  const probability = answer.probabilities[choice];

  if (!Number.isFinite(probability) || probability < CULPRIT_GATE) {
    return { culprit_line: "abstain" };
  }

  const index = Number(choice);

  if (!Number.isInteger(index) || index < 0 || index >= lines.length) {
    return { culprit_line: "abstain" };
  }

  return { culprit_line: index };
}
