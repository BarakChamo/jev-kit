export function buildState(input) {
  return { lines: input.log_lines };
}

export function questions(input) {
  const lines = Array.isArray(input?.log_lines) ? input.log_lines : [];
  const instructions = "Which line of `lines` states the specific cause of the failure: the error message, exception, failed assertion, or timeout detail. Generic wrappers such as Process completed with exit code 1, summary counts, setup lines, progress lines, and passing-test lines state no specific cause.";
  if (lines.length === 0 || lines.length > 255) {
    return {
      culprit: {
        type: "choice",
        instructions,
        criteria: { no_single_line: "No single line in `lines` states a specific cause." }
      }
    };
  }
  const criteria = {};
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i];
    criteria[String(i)] = typeof t === "string" && t.length > 0 ? t : "(empty line in `lines`)";
  }
  if (lines.length < 255) {
    criteria.no_single_line = "No single line in `lines` states a specific cause.";
  }
  return { culprit: { type: "choice", instructions, criteria } };
}

export function decide(answers, input) {
  const lines = Array.isArray(input?.log_lines) ? input.log_lines : [];
  const a = answers?.culprit;
  if (!a || a.choice === "no_single_line") return { culprit_line: "abstain" };
  const p = a.probabilities?.[a.choice] ?? 0;
  if (p < 0.8) return { culprit_line: "abstain" };
  const idx = Number(a.choice);
  if (!Number.isInteger(idx) || idx < 0 || idx >= lines.length) return { culprit_line: "abstain" };
  return { culprit_line: idx };
}
