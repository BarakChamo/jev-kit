const GATE = 0.8;
const MAX_LINES = 254;

const RULE =
  'Choose the line that states the concrete reason the job failed, such as an error message, exception, failed assertion, compiler error, timeout, or failed command output. ' +
  'Do not choose a generic wrapper such as "Process completed with exit code 1", a summary count, a section header, a passing line, or a line that only names a failed test without the reason. ' +
  'If several lines state the same specific cause, choose the earliest such line.';

function getLines(input) {
  if (!input || !Array.isArray(input.log_lines)) return [];
  return input.log_lines.map((line) => {
    if (typeof line === "string") return line;
    if (line == null) return "";
    return String(line);
  });
}

function abstain() {
  return { culprit_line: "abstain" };
}

export function buildState(input) {
  const lines = getLines(input);
  return {
    log_lines: lines,
    log_line_count: lines.length,
    failure_cause_convention: RULE,
  };
}

export function questions(input) {
  const lines = getLines(input);

  if (lines.length === 0) {
    return {
      culprit: {
        type: "choice",
        instructions: "There are no lines in `log_lines`. Choose abstain.",
        criteria: {
          abstain: "no log lines are present",
        },
      },
    };
  }

  if (lines.length > MAX_LINES) {
    return {
      culprit: {
        type: "choice",
        instructions:
          "`log_lines` has too many lines to fit every line into a single choice with an abstain option. Choose abstain.",
        criteria: {
          abstain: "send the case to a person",
        },
      },
    };
  }

  const criteria = {};
  lines.forEach((line, i) => {
    criteria[String(i)] = line || "(empty line)";
  });
  criteria.abstain =
    "no single line states the specific cause, or the case is genuinely ambiguous";

  return {
    culprit: {
      type: "choice",
      instructions:
        "Which one line in `log_lines` states the specific cause of the CI failure? " +
        RULE +
        " If no single line states the cause or the case is genuinely ambiguous, choose abstain.",
      criteria,
    },
  };
}

export function decide(answers, input) {
  const lines = getLines(input);

  if (!answers || lines.length === 0 || lines.length > MAX_LINES) {
    return abstain();
  }

  const ans = answers.culprit;
  if (!ans || ans.choice == null) return abstain();

  const label = String(ans.choice);
  if (label === "abstain") return abstain();

  const index = Number(label);
  if (!Number.isInteger(index) || index < 0 || index >= lines.length) {
    return abstain();
  }

  const p = ans.probabilities ? ans.probabilities[label] : undefined;
  if (typeof p !== "number" || p < GATE) return abstain();

  return { culprit_line: index };
}
