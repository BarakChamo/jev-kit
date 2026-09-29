const GATE = 0.8;
const MAX_OPTIONS = 255;

export function buildState(input) {
  return { ...input };
}

export function questions(input) {
  const lines = input.log_lines || [];
  const maxLines = MAX_OPTIONS - 1;
  const startIdx = Math.max(0, lines.length - maxLines);

  const criteria = {
    none: 'no line states a specific cause of failure, or the failure cause is genuinely ambiguous',
  };

  for (let i = startIdx; i < lines.length; i++) {
    criteria[String(i)] = lines[i];
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
  const culprit = answers?.culprit;
  if (!culprit?.choice || culprit.choice === 'none') {
    return { culprit_line: 'abstain' };
  }

  const p = culprit.probabilities?.[culprit.choice] ?? culprit.confidence ?? 0;
  if (p < GATE) {
    return { culprit_line: 'abstain' };
  }

  const idx = Number(culprit.choice);
  if (!Number.isInteger(idx) || idx < 0 || idx >= (input?.log_lines?.length ?? 0)) {
    return { culprit_line: 'abstain' };
  }

  return { culprit_line: idx };
}
