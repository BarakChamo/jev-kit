const MAX_LINES = 254; // reserve one choice slot for "abstain"
const GATE = 0.8;

function getLines(input) {
  if (!input || !Array.isArray(input.log_lines)) return [];
  return input.log_lines.map((line) =>
    typeof line === "string" ? line : String(line ?? "")
  );
}

export function buildState(input) {
  const log_lines = getLines(input);

  return {
    log_lines,
    log_line_count: log_lines.length,
    convention:
      "The culprit line is the concrete error, exception, timeout, failed assertion, compiler diagnostic, or explicit failure message. Generic summaries, counts, durations, lifecycle messages, section headers, and exit-code wrappers are not the culprit."
  };
}

export function questions(input) {
  const lines = getLines(input);

  if (lines.length === 0 || lines.length > MAX_LINES) {
    return {};
  }

  const criteria = {};

  lines.forEach((line, i) => {
    criteria[String(i)] =
      line.trim() === "" ? `Line ${i}: (blank)` : `Line ${i}: ${line}`;
  });

  criteria.abstain =
    "No line states the specific cause, or the log genuinely supports more than one answer; a person should decide.";

  return {
    culprit: {
      type: "choice",
      instructions:
        "Using `convention`, which 0-based index in `log_lines` states the specific cause of the CI failure? " +
        "Choose the earliest concrete error, exception, failed assertion, timeout, compiler diagnostic, or explicit failure message. " +
        "Do not choose section headers, test/file summaries, counts, durations, lifecycle messages, stack frames below the message, or generic exit-code wrappers. " +
        "For test failures, choose the line with the error message, not the line that only names the failed test. " +
        "If none or ambiguous, choose abstain.",
      criteria
    }
  };
}

export function decide(answers, input) {
  const lines = getLines(input);

  if (lines.length === 0 || lines.length > MAX_LINES) {
    return "abstain";
  }

  const answer = answers?.culprit;
  const choice = answer?.choice;

  if (choice === undefined || choice === null) {
    return "abstain";
  }

  const key = String(choice).trim();

  if (key === "abstain") {
    return "abstain";
  }

  const p = Number(answer.probabilities?.[key] ?? answer.confidence ?? 0);

  if (!(p >= GATE)) {
    return "abstain";
  }

  const idx = Number(key);

  if (!Number.isInteger(idx) || idx < 0 || idx >= lines.length) {
    return "abstain";
  }

  return idx;
}
