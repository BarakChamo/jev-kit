const GATE = 0.8;

export function buildState(input) {
  return {
    log_lines: input.log_lines,
  };
}

export function questions(input) {
  const lines = input.log_lines ?? [];
  const start = Math.max(0, lines.length - 255);
  const candidates = lines.slice(start);

  const criteria = {};
  for (let i = 0; i < candidates.length; i++) {
    criteria[String(start + i)] = candidates[i] || '(empty line)';
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
  if (!answer) {
    return { culprit_line: 'abstain' };
  }

  const choice = answer.choice;
  const p = answer.probabilities?.[choice] ?? answer.confidence ?? 0;

  if (p < GATE) {
    return { culprit_line: 'abstain' };
  }

  const lineIndex = Number(choice);
  if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= (input.log_lines?.length ?? 0)) {
    return { culprit_line: 'abstain' };
  }

  return { culprit_line: lineIndex };
}
