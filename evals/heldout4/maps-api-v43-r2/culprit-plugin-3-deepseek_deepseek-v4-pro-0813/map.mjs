const ACT_GATE = 0.8;
const MAX_SINGLE_LINE_COUNT = 255;
const CHUNK_SIZE = 253; // leaves room for "none" and "ambiguous" options

function chunkLines(lines, size) {
  const chunks = [];
  for (let i = 0; i < lines.length; i += size) {
    chunks.push(lines.slice(i, i + size));
  }
  return chunks;
}

function lineOptions(lines) {
  return Object.fromEntries(lines.map((line, i) => [String(i), line]));
}

function singleQuestion(lines) {
  const includeAmbiguous = lines.length < MAX_SINGLE_LINE_COUNT;
  const criteria = lineOptions(lines);

  if (includeAmbiguous) {
    criteria.ambiguous =
      'the state genuinely supports more than one line as the cause; a person should decide.';
  }

  const instruction =
    'Which line of `log_lines` states the specific cause of the failure? ' +
    'Choose the line containing the actual error message, exception, failed assertion, timeout reason, or explicit failure reason. ' +
    'Do not choose a generic wrapper such as "Process completed with exit code 1", "ELIFECYCLE Test failed.", ' +
    'group headers, summary counts/progress lines, test names, or stack frames below the meaningful error.' +
    (includeAmbiguous ? ' If the precise cause is ambiguous between multiple lines, choose "ambiguous".' : '');

  return {
    culprit: {
      type: 'choice',
      instructions: instruction,
      criteria,
    },
  };
}

function chunkQuestions(logLines) {
  const chunks = chunkLines(logLines, CHUNK_SIZE);
  const questions = {};

  chunks.forEach((chunk, i) => {
    const criteria = lineOptions(chunk);
    criteria.none = 'no line in this chunk states the specific cause of the failure.';
    criteria.ambiguous =
      'this chunk has more than one plausible line; a person should decide.';

    questions[`culprit_${i}`] = {
      type: 'choice',
      instructions:
        `Which line of \`log_lines_chunk_${i}\` states the specific cause of the failure? ` +
        'Choose the line containing the actual error message, exception, failed assertion, timeout reason, or explicit failure reason. ' +
        'Do not choose a generic wrapper such as "Process completed with exit code 1", "ELIFECYCLE Test failed.", ' +
        'group headers, summary counts/progress lines, test names, or stack frames below the meaningful error. ' +
        'If no line in this chunk states the cause, choose "none". ' +
        'If the precise cause is ambiguous between multiple lines in this chunk, choose "ambiguous".',
      criteria,
    };
  });

  return questions;
}

export function buildState(input) {
  const lines = input.log_lines ?? [];

  if (lines.length <= MAX_SINGLE_LINE_COUNT) {
    return { log_lines: lines };
  }

  const chunks = chunkLines(lines, CHUNK_SIZE);
  return Object.fromEntries(
    chunks.map((chunk, i) => [`log_lines_chunk_${i}`, chunk])
  );
}

export function questions(input) {
  const lines = input.log_lines ?? [];

  if (lines.length <= MAX_SINGLE_LINE_COUNT) {
    return singleQuestion(lines);
  }

  return chunkQuestions(lines);
}

export function decide(answers, input) {
  const lines = input.log_lines ?? [];

  const singleAnswer = answers?.culprit;
  if (singleAnswer) {
    if (singleAnswer.choice === 'ambiguous') {
      return { culprit_line: 'abstain' };
    }

    const probability = singleAnswer.probabilities?.[singleAnswer.choice] ?? 0;
    if (probability < ACT_GATE) {
      return { culprit_line: 'abstain' };
    }

    const index = Number(singleAnswer.choice);
    if (!Number.isInteger(index) || index < 0 || index >= lines.length) {
      return { culprit_line: 'abstain' };
    }

    return { culprit_line: index };
  }

  const chunks = chunkLines(lines, CHUNK_SIZE);
  const candidates = [];

  chunks.forEach((chunk, i) => {
    const answer = answers?.[`culprit_${i}`];
    if (!answer || answer.choice === 'none' || answer.choice === 'ambiguous') {
      return;
    }

    const probability = answer.probabilities?.[answer.choice] ?? 0;
    if (probability < ACT_GATE) {
      return;
    }

    const localIndex = Number(answer.choice);
    if (!Number.isInteger(localIndex) || localIndex < 0 || localIndex >= chunk.length) {
      return;
    }

    candidates.push({
      index: i * CHUNK_SIZE + localIndex,
      probability,
    });
  });

  if (candidates.length !== 1) {
    return { culprit_line: 'abstain' };
  }

  return { culprit_line: candidates[0].index };
}
