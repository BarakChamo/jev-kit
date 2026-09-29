export function buildState(input) {
  return {
    ...input,
  };
}

export function questions(input) {
  const lines = input.log_lines || [];
  const maxChoices = 254; // Jev supports up to 255 choice options; reserve 1 for 'ambiguous'
  const start = Math.max(0, lines.length - maxChoices);

  const criteria = {
    ambiguous: 'no single line states the cause, or the cause cannot be determined from these lines',
  };

  for (let i = start; i < lines.length; i++) {
    criteria[String(i)] = lines[i] || '(empty line)';
  }

  return {
    culprit: {
      type: 'choice',
      instructions:
        'Which line of `log_lines` states the specific cause of the failure: the error message, exception or failed assertion? Not a generic wrapper such as "Process completed with exit code 1", not a summary count, not a stack frame below the error.',
      criteria,
    },
  };
}

export function decide(answers, input) {
  const answer = answers?.culprit;
  if (!answer || !answer.choice || answer.choice === 'ambiguous') {
    return { culprit_line: 'abstain' };
  }

  const prob = answer.probabilities?.[answer.choice] ?? 0;
  if (prob < 0.8) {
    return { culprit_line: 'abstain' };
  }

  const index = Number(answer.choice);
  if (!Number.isInteger(index) || index < 0 || index >= (input.log_lines?.length ?? 0)) {
    return { culprit_line: 'abstain' };
  }

  return { culprit_line: index };
}
