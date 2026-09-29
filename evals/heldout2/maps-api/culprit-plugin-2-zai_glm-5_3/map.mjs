// Jev question map: point developers at the single log line stating a CI failure's cause.
// Pattern: pick ONE of many -> a single `choice` over every line (rule 10), no pre-filtering
// (rule 16), gate on the chosen label's probability (rule 13), abstain option (rule 14).

const CHUNK = 250; // keep each choice under the 255-option limit
const ACT = 0.8;   // act only when the picked line is this likely; otherwise a person looks

const SKIP =
  "Not a generic wrapper such as '##[error]Process completed with exit code 1', " +
  "not a summary count such as 'Test Files  1 failed | 23 passed (24)', " +
  "not a hint or advice line that follows the error, not a stack frame below the error, " +
  "not a '##[group]'/'##[endgroup]' marker.";

export function buildState(input) {
  const chunks = [];
  for (let i = 0; i < input.log_lines.length; i += CHUNK) {
    chunks.push(input.log_lines.slice(i, i + CHUNK));
  }
  const state = {
    repo: input.repo,
    branch: input.branch,
    job_name: input.job_name,
    attempt: `${input.attempt_number} of ${input.max_attempts}`,
    log_line_count: input.log_lines.length,
  };
  chunks.forEach((c, i) => (state[`chunk_${i}`] = c)); // every line is sent; nothing is filtered out
  return state;
}

export function questions(input) {
  const qs = {};
  for (let i = 0; i < input.log_lines.length; i += CHUNK) {
    const ci = i / CHUNK;
    const lines = input.log_lines.slice(i, i + CHUNK);
    qs[`present_${ci}`] = {
      type: 'noul',
      instructions:
        `Does \`chunk_${ci}\` contain any line that states the specific cause of this CI job's ` +
        `failure: an error message, exception, or failed assertion? ${SKIP} ` +
        `Lines from steps that completed successfully do not count.`,
      criteria: {
        true: 'at least one line states the specific error, exception, or failed assertion',
        false: 'no line in this chunk states the specific cause',
      },
    };
    const criteria = {};
    lines.forEach((text, j) => (criteria[String(i + j)] = text)); // option id = global line index
    criteria.none_in_this_chunk = 'no line in this chunk states the specific cause of the failure';
    criteria.ambiguous = 'more than one line could equally be the single cause line; a person should decide';
    qs[`culprit_${ci}`] = {
      type: 'choice',
      instructions:
        `Which line of \`chunk_${ci}\` states the specific cause of this CI job's failure: ` +
        `the error message, exception, or failed assertion? ${SKIP} ` +
        `Lines from steps that completed successfully do not count.`,
      criteria,
    };
  }
  return qs;
}

export function decide(answers, input) {
  const abstain = { culprit_line: 'abstain' };
  const n = input.log_lines.length;
  if (n === 0) return abstain;
  const nChunks = Math.ceil(n / CHUNK);
  const p = (a, k) => a.probabilities?.[k] ?? 0;
  const usable = (a) =>
    a && a.choice !== 'none_in_this_chunk' && a.choice !== 'ambiguous' &&
    Number.isInteger(Number(a.choice)) && Number(a.choice) >= 0 && Number(a.choice) < n &&
    p(a, a.choice) >= ACT;

  if (nChunks === 1) {
    const pres = answers.present_0;
    const a = answers.culprit_0;
    if (!pres || pres.noul < 0.5) return abstain; // detector disagrees: send to a person
    return usable(a) ? { culprit_line: Number(a.choice) } : abstain;
  }

  // Long log: the chunk-detector nouls pick which chunk holds the cause (argmax in code, rule 8),
  // then the winning chunk's choice names the line.
  const order = Array.from({ length: nChunks }, (_, i) => ({ i, n: answers[`present_${i}`]?.noul ?? 0 }))
    .sort((x, y) => y.n - x.n);
  for (const { i, n: pn } of order) {
    if (pn < 0.5) break; // no chunk credibly contains the cause line
    const a = answers[`culprit_${i}`];
    if (usable(a)) return { culprit_line: Number(a.choice) };
  }
  return abstain;
}
