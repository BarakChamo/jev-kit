const MAX_OPTIONS = 255;
const ABSTAIN = "abstain";
const GATE = 0.8;

function logLines(input) {
  return Array.isArray(input?.log_lines)
    ? input.log_lines.map((line) => (typeof line === "string" ? line : String(line ?? "")))
    : [];
}

export function buildState(input) {
  const log_lines = logLines(input);
  return {
    line_count: log_lines.length,
    log_lines,
  };
}

export function questions(input) {
  const lines = logLines(input);
  const n = lines.length;

  if (n === 0 || n > MAX_OPTIONS) {
    return {
      culprit_line: {
        type: "choice",
        instructions:
          "The `log_lines` field is empty or has more than 255 lines, so this map cannot ask one choice over every line. Choose `abstain`.",
        criteria: {
          [ABSTAIN]: "Send this case to a person.",
        },
      },
    };
  }

  const criteria = {};
  lines.forEach((text, i) => {
    criteria[String(i)] = text || "(empty line)";
  });

  const hasAbstain = n < MAX_OPTIONS;
  if (hasAbstain) {
    criteria[ABSTAIN] =
      "No line states the specific cause, or the state genuinely supports more than one possible culprit line.";
  }

  const base =
    "Which line of `log_lines` states the specific cause of this CI failure? " +
    "Each option key is the zero-based index of a line in `log_lines`. " +
    "Choose the line that names the error, failed assertion, exception, timeout, missing dependency, compile error, or explicit command failure. " +
    "Do not choose a generic wrapper such as \"Process completed with exit code 1\", a summary count, a section header, a successful line, " +
    "or a line that only says a command failed without saying why. " +
    "If the same specific cause line appears more than once, choose its first occurrence.";

  return {
    culprit_line: {
      type: "choice",
      instructions: hasAbstain
        ? `${base} If no such line is present, or the choice is genuinely ambiguous, choose \`abstain\`.`
        : base,
      criteria,
    },
  };
}

export function decide(answers, input) {
  const lines = logLines(input);
  const n = lines.length;
  const answer = answers?.culprit_line;
  const choice = answer?.choice;
  const label = choice == null ? undefined : String(choice);

  if (label === ABSTAIN) {
    return { culprit_line: ABSTAIN };
  }

  if (n === 0 || n > MAX_OPTIONS || label === undefined || !answer?.probabilities) {
    return { culprit_line: ABSTAIN };
  }

  if (!/^(0|[1-9][0-9]*)$/.test(label)) {
    return { culprit_line: ABSTAIN };
  }

  const idx = Number(label);
  if (idx < 0 || idx >= n) {
    return { culprit_line: ABSTAIN };
  }

  const p = answer.probabilities[label];
  if (typeof p !== "number" || p < GATE) {
    return { culprit_line: ABSTAIN };
  }

  const abstainP = answer.probabilities[ABSTAIN];
  if (typeof abstainP === "number" && abstainP >= p) {
    return { culprit_line: ABSTAIN };
  }

  return { culprit_line: idx };
}
