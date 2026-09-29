const MAX_LINES_PER_CHOICE = 254;
const DECISION_GATE = 0.8;

function getLines(input) {
  return Array.isArray(input?.log_lines) ? input.log_lines : [];
}

function asText(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function culpritQuestion(lines, field, startIndex) {
  const criteria = {};

  for (let i = 0; i < lines.length; i += 1) {
    const index = startIndex + i;
    criteria[String(index)] = `[line ${index}] ${asText(lines[i])}`;
  }

  criteria.ambiguous =
    'No single line in this set states the specific cause; a person should decide.';

  return {
    type: 'choice',
    instructions: `Which single line in \`${field}\` states the specific cause of the CI failure? The cause line contains the actual error, exception, failed assertion, timeout, missing file, or the reason the job failed. Do not choose a generic wrapper such as "##[error]Process completed with exit code 1.", a group marker such as "##[group]..." or "##[endgroup]", a summary/progress line, or a stack frame that merely follows the error. If no single line in \`${field}\` states the cause, choose "ambiguous".`,
    criteria,
  };
}

function isDefinitelyNotCause(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return (
    text === '' ||
    /^##\[(group|endgroup)\]/.test(text) ||
    /^##\[error\]Process completed with exit code \d+\.$/.test(text)
  );
}

export function buildState(input) {
  const lines = getLines(input);

  if (lines.length <= MAX_LINES_PER_CHOICE) {
    return { log_lines: lines };
  }

  const state = {};
  for (let start = 0, chunk = 0; start < lines.length; start += MAX_LINES_PER_CHOICE, chunk += 1) {
    state[`chunk_${chunk}`] = lines.slice(start, start + MAX_LINES_PER_CHOICE);
  }
  return state;
}

export function questions(input) {
  const lines = getLines(input);

  if (lines.length === 0) {
    return {
      culprit: {
        type: 'choice',
        instructions: 'There are no `log_lines` to choose from.',
        criteria: { ambiguous: 'No log lines are present.' },
      },
    };
  }

  if (lines.length <= MAX_LINES_PER_CHOICE) {
    return { culprit: culpritQuestion(lines, 'log_lines', 0) };
  }

  const qs = {};
  for (let start = 0, chunk = 0; start < lines.length; start += MAX_LINES_PER_CHOICE, chunk += 1) {
    const chunkLines = lines.slice(start, start + MAX_LINES_PER_CHOICE);
    qs[`culprit_${chunk}`] = culpritQuestion(chunkLines, `chunk_${chunk}`, start);
  }
  return qs;
}

export function decide(answers, input) {
  const lines = getLines(input);
  if (lines.length === 0) return { culprit_line: 'abstain' };

  const answerList = [];

  if (lines.length <= MAX_LINES_PER_CHOICE) {
    answerList.push(answers?.culprit);
  } else {
    const chunks = Math.ceil(lines.length / MAX_LINES_PER_CHOICE);
    for (let chunk = 0; chunk < chunks; chunk += 1) {
      answerList.push(answers?.[`culprit_${chunk}`]);
    }
  }

  let best = null;

  for (const answer of answerList) {
    if (!answer || answer.choice === undefined || answer.choice === 'ambiguous') continue;

    const probability =
      answer.probabilities?.[answer.choice] ?? answer.confidence ?? 0;

    if (best === null || probability > best.probability) {
      best = { probability, choice: answer.choice };
    }
  }

  if (!best) return { culprit_line: 'abstain' };

  const index = Number(best.choice);
  if (!Number.isInteger(index) || index < 0 || index >= lines.length) {
    return { culprit_line: 'abstain' };
  }

  if (isDefinitelyNotCause(lines[index])) {
    return { culprit_line: 'abstain' };
  }

  if (best.probability < DECISION_GATE) {
    return { culprit_line: 'abstain' };
  }

  return { culprit_line: index };
}
