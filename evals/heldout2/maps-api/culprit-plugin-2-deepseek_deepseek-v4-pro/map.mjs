export function buildState(input) {
  const log_lines = Array.isArray(input?.log_lines) ? input.log_lines : [];
  return { log_lines };
}

export function questions(input) {
  const lines = Array.isArray(input?.log_lines) ? input.log_lines : [];
  if (lines.length === 0 || lines.length > 255) return {};

  const criteria = {};
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i]);
    criteria[String(i)] = line.trim() ? line : "(empty line)";
  }

  const hasAbstain = lines.length <= 254;
  if (hasAbstain) {
    criteria.abstain =
      "No single line in `log_lines` states the specific cause of the job failure; a person should decide.";
  }

  const instructions = `Which line of \`log_lines\` most specifically states the cause of the job failure? The option values are the 0-based line numbers into \`log_lines\`; each option's description is the text of that line. The cause is the actual error, exception, failed assertion, timeout detail, or the line that explains why the job failed. A line that only names the failing test or job is not specific enough. Do not choose a generic wrapper such as \`##[error]Process completed with exit code 1.\`, a group header (\`##[group]...\`), a progress line, a test summary line (e.g. \`Test Files  1 failed | ...\`), or any line that only says the job or test failed without saying why.${hasAbstain ? ' If no single line states the cause, choose `abstain`.' : ''}`;

  return {
    culprit: {
      type: "choice",
      instructions,
      criteria,
    },
  };
}

export function decide(answers, input) {
  const lines = Array.isArray(input?.log_lines) ? input.log_lines : [];
  if (lines.length === 0 || lines.length > 255) return { culprit_line: "abstain" };

  const answer = answers?.culprit;
  if (!answer) return { culprit_line: "abstain" };

  const choice = answer.choice == null ? null : String(answer.choice);
  if (choice === "abstain") return { culprit_line: "abstain" };
  if (!/^\d+$/.test(choice ?? "")) return { culprit_line: "abstain" };

  const index = Number(choice);
  if (!Number.isInteger(index) || index < 0 || index >= lines.length) {
    return { culprit_line: "abstain" };
  }

  const p = answer.probabilities?.[choice] ?? 0;
  if (p < 0.8) return { culprit_line: "abstain" };

  return { culprit_line: index };
}
