const CONFIDENCE_GATE = 0.8;
const AMBIGUOUS_GATE = 0.5;
const MAX_OPTIONS = 255;

export function buildState(input) {
  return {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    job_name: input.job_name,
    attempt_number: input.attempt_number,
    max_attempts: input.max_attempts,
    log_lines: input.log_lines,
  };
}

export function questions(input) {
  const lines = Array.isArray(input.log_lines) ? input.log_lines : [];
  if (lines.length === 0 || lines.length > MAX_OPTIONS) return {};

  const criteria = {};
  lines.forEach((line, i) => {
    criteria[String(i)] = line;
  });

  return {
    culprit_line: {
      type: "choice",
      instructions:
        "The state's `log_lines` array is the full log of one CI job attempt " +
        "(`job_name` on `repo`/`branch`, runner `runner`, attempt `attempt_number` of `max_attempts`). " +
        "Each option below is one line of `log_lines`, keyed by its 0-based index, with that line's exact text as the description. " +
        "Pick the single line that most specifically states the underlying reason the job failed: " +
        "the actual error message, exception, assertion failure, or timeout that explains WHY it failed. " +
        "Do NOT pick a generic wrapper or summary line that only announces that something failed without saying why, such as " +
        "'##[error]Process completed with exit code N', an 'ELIFECYCLE ... Test failed. See above for details.' line, a bare " +
        "'Test Files ... failed' / 'Tests ... failed' totals line, or a line that just names which test/step failed (e.g. one starting with '×') " +
        "when a later line states the actual reason in more detail.",
      criteria,
    },
    no_specific_cause: {
      type: "noul",
      instructions:
        "Look at every line in the state's `log_lines` array. Is it true that none of these lines states a specific, concrete reason " +
        "for the failure — i.e. the log only contains generic failure/exit-code announcements and summary counts, with no error message, " +
        "exception, assertion, or other specific explanation anywhere in it?",
      criteria: {
        true: "no line in log_lines gives a specific concrete cause; a person would need to dig elsewhere to find the reason",
        false: "at least one line in log_lines states a specific, concrete cause",
      },
    },
  };
}

export function decide(answers, input) {
  const lines = Array.isArray(input.log_lines) ? input.log_lines : [];
  if (lines.length === 0 || lines.length > MAX_OPTIONS) return { culprit_line: "abstain" };

  const ambiguous = answers.no_specific_cause;
  if (ambiguous && typeof ambiguous.noul === "number" && ambiguous.noul >= AMBIGUOUS_GATE) {
    return { culprit_line: "abstain" };
  }

  const pick = answers.culprit_line;
  if (!pick || typeof pick.choice !== "string") return { culprit_line: "abstain" };

  const prob =
    pick.probabilities && typeof pick.probabilities[pick.choice] === "number"
      ? pick.probabilities[pick.choice]
      : pick.confidence;
  if (typeof prob !== "number" || prob < CONFIDENCE_GATE) return { culprit_line: "abstain" };

  const idx = Number(pick.choice);
  if (!Number.isInteger(idx) || idx < 0 || idx >= lines.length) return { culprit_line: "abstain" };

  return { culprit_line: idx };
}
