// Picks the single log line that states the root cause of a CI job failure.
// Encoding follows the "pick one of many" pattern: one `choice` question over
// every line (by index), with an explicit rubric for skipping generic
// wrapper/summary lines, plus a "none" escape hatch for genuinely unclear logs.

const MAX_LINES = 254; // leaves room for the "none" option under the 255-option cap
const CONFIDENCE_GATE = 0.8;

export function buildState(input) {
  const log_lines = Array.isArray(input.log_lines) ? input.log_lines : [];
  return {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    job_name: input.job_name,
    attempt_number: input.attempt_number,
    max_attempts: input.max_attempts,
    log_lines: log_lines.map((text, index) => ({ index, text })),
  };
}

export function questions(input) {
  const lines = Array.isArray(input.log_lines) ? input.log_lines : [];
  if (lines.length === 0 || lines.length > MAX_LINES) return {};

  const criteria = {};
  lines.forEach((text, i) => {
    criteria[String(i)] = text;
  });
  criteria.none =
    "No single log line states a specific, identifiable root cause; the failure reason is unclear, split across multiple lines, or absent from this log.";

  return {
    culprit: {
      type: "choice",
      instructions:
        "`log_lines` in the state holds the full log of one CI job run, in order, each entry an object with an `index` and its `text`. Pick the option whose index is the ONE line that most specifically states the root cause of the job's failure: the actual error message, thrown exception, failed assertion, or named test-failure reason. Do NOT pick a generic wrapper or summary line that only reports that something failed without saying why -- e.g. a bare 'Process completed with exit code 1', a generic '##[error]' banner with no specific message, an 'ELIFECYCLE'/'npm ERR!' summary line, or a 'X failed, Y passed' totals line -- when a more specific line elsewhere states the actual cause. If the log contains repeated attempts of the same steps, pick the line from the attempt that actually fails, not an unrelated line from an earlier successful repeat of the same steps. Choose 'none' only if no single line states an identifiable, specific cause.",
      criteria,
    },
  };
}

export function decide(answers, input) {
  const lines = Array.isArray(input.log_lines) ? input.log_lines : [];
  const a = answers && answers.culprit;
  if (!a || a.type !== "choice") return { culprit_line: "abstain" };

  const choice = a.choice;
  if (choice === "none") return { culprit_line: "abstain" };

  const idx = Number(choice);
  if (!Number.isInteger(idx) || idx < 0 || idx >= lines.length) {
    return { culprit_line: "abstain" };
  }

  const prob = a.probabilities && a.probabilities[choice];
  const confidence = typeof prob === "number" ? prob : a.confidence;
  if (typeof confidence !== "number" || confidence < CONFIDENCE_GATE) {
    return { culprit_line: "abstain" };
  }

  return { culprit_line: idx };
}
