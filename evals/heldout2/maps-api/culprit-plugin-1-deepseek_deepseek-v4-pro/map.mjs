const MAX_CHOICE_OPTIONS = 255;
const CHUNK_SIZE = MAX_CHOICE_OPTIONS - 1; // reserve one option for `abstain`
const MAX_CHUNKS = MAX_CHOICE_OPTIONS - 1; // reserve one option for `abstain` in chunk selection
const LINE_THRESHOLD = 0.8;
const CHUNK_THRESHOLD = 0.7;

function asLines(input) {
  return Array.isArray(input?.log_lines) ? input.log_lines : [];
}

function chunkLines(lines, size) {
  const chunks = [];
  for (let i = 0; i < lines.length; i += size) {
    chunks.push(lines.slice(i, i + size));
  }
  return chunks;
}

function lineOptions(lines, offset = 0) {
  return Object.fromEntries(
    lines.map((text, i) => {
      const lineNo = offset + i;
      return [String(lineNo), `[line ${lineNo}] ${text}`];
    }),
  );
}

function lineInstructions(start, end) {
  return `Which line among lines ${start} through ${end} (inclusive) of \`log_lines\` states the specific reason the job failed? Choose the line that contains the error message, exception message, failed assertion, timeout reason, or build error. Do not choose a line that only names the failing test or step, a generic wrapper such as "Process completed with exit code 1", a summary line such as "Test Files 1 failed | 23 passed", a progress line, or a line that only describes the consequence. A stack-trace line is not the reason unless it names the exact error or assertion. If no single line states the reason, choose \`abstain\`.`;
}

export function buildState(input) {
  return { log_lines: asLines(input) };
}

export function questions(input) {
  const log_lines = asLines(input);

  if (log_lines.length === 0) {
    return {
      empty_log: {
        type: 'noul',
        instructions: 'Does `log_lines` contain at least one log line?',
        criteria: { true: 'it contains at least one line', false: 'it is empty' },
      },
    };
  }

  if (log_lines.length <= CHUNK_SIZE) {
    return {
      culprit: {
        type: 'choice',
        instructions: lineInstructions(0, log_lines.length - 1),
        criteria: {
          ...lineOptions(log_lines, 0),
          abstain: 'no single line states the reason, or the reason is genuinely ambiguous; a person should decide',
        },
      },
    };
  }

  const chunks = chunkLines(log_lines, CHUNK_SIZE);

  if (chunks.length > MAX_CHUNKS) {
    return {
      too_many_lines: {
        type: 'noul',
        instructions: 'Are there more than 64,516 lines in `log_lines`?',
        criteria: {
          true: 'yes, there are too many lines to choose from in one pass',
          false: 'no, there are not too many lines',
        },
      },
    };
  }

  const q = {
    culprit_chunk: {
      type: 'choice',
      instructions:
        'Which chunk of `log_lines` contains the line that states the specific reason the job failed? Chunks are contiguous ranges of line indices in `log_lines`. Do not choose a chunk that contains only generic wrappers, summary lines, progress lines, or consequence lines. If no chunk contains a single reason line, choose `abstain`.',
      criteria: {
        ...Object.fromEntries(
          chunks.map((_, ci) => {
            const start = ci * CHUNK_SIZE;
            const end = Math.min((ci + 1) * CHUNK_SIZE, log_lines.length) - 1;
            return [`chunk_${ci}`, `[chunk ${ci}] lines ${start} through ${end} of \`log_lines\``];
          }),
        ),
        abstain: 'no single line in any chunk states the reason, or the reason is genuinely ambiguous; a person should decide',
      },
    },
  };

  chunks.forEach((chunk, ci) => {
    const start = ci * CHUNK_SIZE;
    const end = start + chunk.length - 1;
    q[`culprit_${ci}`] = {
      type: 'choice',
      instructions: lineInstructions(start, end),
      criteria: {
        ...lineOptions(chunk, start),
        abstain: 'no single line in this range states the reason, or the reason is genuinely ambiguous; a person should decide',
      },
    };
  });

  return q;
}

function parseChunkIndex(value) {
  if (typeof value !== 'string' || !value.startsWith('chunk_')) return null;
  const rest = value.slice('chunk_'.length);
  if (!/^\d+$/.test(rest)) return null;
  const n = Number(rest);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function decide(answers, input) {
  const log_lines = asLines(input);
  if (log_lines.length === 0) return 'abstain';
  if (!answers || typeof answers !== 'object') return 'abstain';

  if (log_lines.length <= CHUNK_SIZE) {
    const a = answers.culprit;
    if (!a || typeof a.choice !== 'string' || a.choice === 'abstain') return 'abstain';

    const p = a.probabilities?.[a.choice] ?? 0;
    const idx = Number(a.choice);
    if (!Number.isInteger(idx) || idx < 0 || idx >= log_lines.length) return 'abstain';

    return p >= LINE_THRESHOLD ? idx : 'abstain';
  }

  const chunkAnswer = answers.culprit_chunk;
  if (!chunkAnswer || typeof chunkAnswer.choice !== 'string' || chunkAnswer.choice === 'abstain') {
    return 'abstain';
  }

  const chunkP = chunkAnswer.probabilities?.[chunkAnswer.choice] ?? 0;
  const ci = parseChunkIndex(chunkAnswer.choice);
  if (ci === null || ci < 0 || ci >= Math.ceil(log_lines.length / CHUNK_SIZE)) return 'abstain';

  const lineAnswer = answers[`culprit_${ci}`];
  if (!lineAnswer || typeof lineAnswer.choice !== 'string' || lineAnswer.choice === 'abstain') {
    return 'abstain';
  }

  const lineP = lineAnswer.probabilities?.[lineAnswer.choice] ?? 0;
  const idx = Number(lineAnswer.choice);
  if (!Number.isInteger(idx) || idx < 0 || idx >= log_lines.length) return 'abstain';

  if (chunkP < CHUNK_THRESHOLD || lineP < LINE_THRESHOLD) return 'abstain';

  return idx;
}
