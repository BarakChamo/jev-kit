const GATE = 0.8;
const MAX_LINES = 254; // reserve one choice slot for abstain (Jev allows 255 options)
const ABSTAIN = "abstain";

function asLines(input) {
  return Array.isArray(input?.log_lines)
    ? input.log_lines.map((line) => String(line))
    : [];
}

export function buildState(input) {
  return {
    log_lines: asLines(input),
  };
}

export function questions(input) {
  const lines = asLines(input);
  const criteria = {};

  if (lines.length <= MAX_LINES) {
    lines.forEach((text, i) => {
      criteria[String(i)] = `Line ${i}: ${text}`;
    });
  }

  criteria[ABSTAIN] =
    "No line states the specific cause, or the log is genuinely ambiguous; a person should decide.";

  const instructions =
    lines.length > MAX_LINES
      ? "The `log_lines` array has too many lines to offer every line as one choice. Choose abstain."
      : [
          "Which one line of `log_lines` states the specific cause of this CI failure?",
          "A cause line states a concrete error, exception, failed assertion, timeout, compiler or lint error, missing dependency, permission error, or command error.",
          "Generic wrappers, summaries, section headers, successful steps, retries, stack frames below the error, and exit-code messages are not the cause.",
          "The option key is the 0-based index into `log_lines`; each option text shows the line index and line text.",
          "Choose abstain when no line states the specific cause or the log is ambiguous.",
        ].join(" ");

  return {
    culprit: {
      type: "choice",
      instructions,
      criteria,
    },
  };
}

export function decide(answers, input) {
  const lines = asLines(input);

  if (lines.length === 0 || lines.length > MAX_LINES) {
    return ABSTAIN;
  }

  const answer = answers?.culprit;
  if (!answer || answer.choice == null) {
    return ABSTAIN;
  }

  const choice = String(answer.choice);
  if (choice === ABSTAIN) {
    return ABSTAIN;
  }

  const p = answer.probabilities?.[choice];
  if (typeof p !== "number" || p < GATE) {
    return ABSTAIN;
  }

  const index = Number(choice);
  if (!Number.isInteger(index) || index < 0 || index >= lines.length) {
    return ABSTAIN;
  }

  return index;
}
