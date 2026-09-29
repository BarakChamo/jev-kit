const ABSTAIN = "abstain";
const GATE = 0.8;
const MAX_OPTIONS = 255; // includes the abstain option

function linesFrom(input) {
  const lines = input?.log_lines;
  if (!Array.isArray(lines)) return [];
  return lines.map((line) => (typeof line === "string" ? line : String(line)));
}

function abstainDecision() {
  return { culprit_line: ABSTAIN };
}

export function buildState(input) {
  return { log_lines: linesFrom(input) };
}

export function questions(input) {
  const lines = linesFrom(input);

  // One choice over every line, plus abstain.
  // If all lines cannot fit in one choice, escalate instead of truncating.
  if (lines.length === 0 || lines.length + 1 > MAX_OPTIONS) {
    return {};
  }

  const criteria = {};
  for (let i = 0; i < lines.length; i += 1) {
    criteria[String(i)] = lines[i].trim() === "" ? "(blank line)" : lines[i];
  }
  criteria[ABSTAIN] =
    "No single line in `log_lines` states the specific cause, or the log is ambiguous.";

  return {
    culprit: {
      type: "choice",
      instructions:
        "Which one line of `log_lines` states the specific cause of this CI job failure? " +
        "Option keys are 0-based indices into `log_lines`. " +
        "Choose the line that contains the error message, exception, failed assertion, timeout reason, compiler/linter error, or tool diagnostic that explains why the job failed. " +
        "Do not choose generic wrappers or summaries such as 'Process completed with exit code 1', 'Test failed', failed-test counts, step/group headings, stack frames below the error, or lines that only say a command failed. " +
        "If the same specific cause appears more than once, choose its first occurrence. " +
        "If no single line states the specific cause, choose abstain.",
      criteria,
    },
  };
}

export function decide(answers, input) {
  const answer = answers?.culprit;
  if (!answer || typeof answer.choice !== "string" || answer.choice === ABSTAIN) {
    return abstainDecision();
  }

  const choice = answer.choice;
  const p = Number(answer.probabilities?.[choice]);
  if (!Number.isFinite(p) || p < GATE || !/^\d+$/.test(choice)) {
    return abstainDecision();
  }

  const idx = Number(choice);
  const lines = linesFrom(input);
  if (!Number.isInteger(idx) || idx < 0 || idx >= lines.length) {
    return abstainDecision();
  }

  return { culprit_line: idx };
}
