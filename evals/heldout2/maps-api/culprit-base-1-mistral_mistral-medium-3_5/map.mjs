export function buildState(input) {
  return {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    job_name: input.job_name,
    attempt_number: input.attempt_number,
    max_attempts: input.max_attempts,
    log_lines: input.log_lines,
    error_lines: input.log_lines.map((line, i) => ({ index: i, line })).filter(({ line }) => line.includes('##[error]') || line.includes('Error') || line.includes('failed') || line.includes('×') || line.includes('✗'))
  };
}

export function questions(input) {
  return {
    q1: {
      type: "choice",
      instructions: "Identify the single most likely line that caused the CI failure. Return the 0-based index of the line in log_lines.",
      criteria: Object.fromEntries(
        input.log_lines.map((_, i) => [String(i), `Line ${i}: ${input.log_lines[i]}`])
      )
    }
  };
}

export function decide(answers, input) {
  if (!answers.q1 || answers.q1.choice === undefined) return { culprit_line: "abstain" };
  const choice = parseInt(answers.q1.choice);
  if (isNaN(choice) || choice < 0 || choice >= input.log_lines.length) return { culprit_line: "abstain" };
  return { culprit_line: choice };
}
