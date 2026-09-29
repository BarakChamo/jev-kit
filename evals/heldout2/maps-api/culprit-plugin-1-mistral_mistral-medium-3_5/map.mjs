export function buildState(input) {
  return { log_lines: input.log_lines };
}

export function questions(input) {
  const criteria = Object.fromEntries(
    input.log_lines.map((line, i) => [String(i), line])
  );
  return {
    culprit: {
      type: 'choice',
      instructions: 'Which line of `log_lines` states the specific cause of the failure: the error message, exception, failed assertion, or timeout? Not a generic wrapper such as "Process completed with exit code 1", not a summary count, not a stack frame below the error, not a log header.',
      criteria,
    },
  };
}

export function decide(answers, input) {
  const a = answers.culprit;
  const p = a.probabilities[a.choice];
  return p >= 0.8 ? { culprit_line: Number(a.choice) } : { culprit_line: 'abstain' };
}
