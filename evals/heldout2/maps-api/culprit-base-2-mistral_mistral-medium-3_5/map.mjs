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
  return {
    q1: {
      type: "choice",
      instructions: "Identify the single log line that most clearly states the root cause of the CI failure. If no clear cause is present, choose 'abstain'.",
      criteria: {
        abstain: "No clear single line indicates the root cause of the failure.",
        ...Object.fromEntries(
          input.log_lines.map((line, idx) => [
            `line_${idx}`,
            `Line ${idx}: "${line.trim()}" is the root cause.`
          ])
        )
      }
    }
  };
}

export function decide(answers, input) {
  if (answers.q1?.choice === "abstain" || !answers.q1?.choice) {
    return { culprit_line: "abstain" };
  }
  const lineIndex = parseInt(answers.q1.choice.split("_")[1]);
  return { culprit_line: lineIndex };
}
