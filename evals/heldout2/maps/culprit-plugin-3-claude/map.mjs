// Jev map: point at the single log line that states a CI failure's cause.
//
// Approach (jev-questions rule 10): picking one item out of many is a single
// `choice` question over every candidate, with a rubric naming the generic
// wrapper/summary lines to skip. That scored 100% in the study; a per-line
// `noul` scored 13-100% because wrapper lines truthfully "show" the failure
// without stating its cause.
//
// `choice` allows at most 255 options, so very long logs are split into
// chunks (each with a "none" escape option) and the chunk with the most
// confident non-"none" pick wins. Real-world CI logs almost always fit in
// one chunk.

const MAX_REAL_OPTIONS_PER_CHUNK = 254; // + 1 "none" option = 255
const CONFIDENCE_GATE = 0.5; // gate on the calibrated probability, not the confidence scalar (rule 13)
const MAX_LINE_CHARS = 500; // keep single pathological lines from bloating the prompt

function truncate(line) {
  const s = String(line);
  return s.length > MAX_LINE_CHARS ? s.slice(0, MAX_LINE_CHARS) + '…' : s;
}

function chunkIndices(count, size) {
  const chunks = [];
  for (let start = 0; start < count; start += size) {
    chunks.push({ start, end: Math.min(start + size, count) });
  }
  return chunks;
}

export function buildState(input) {
  return {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    job_name: input.job_name,
    attempt_number: input.attempt_number,
    max_attempts: input.max_attempts,
    log_lines: Array.isArray(input.log_lines) ? input.log_lines : [],
  };
}

export function questions(input) {
  const lines = Array.isArray(input.log_lines) ? input.log_lines : [];
  if (lines.length === 0) return {};

  const chunks = chunkIndices(lines.length, MAX_REAL_OPTIONS_PER_CHUNK);
  const qs = {};

  chunks.forEach((chunk, chunkIdx) => {
    const criteria = {};
    for (let i = chunk.start; i < chunk.end; i++) {
      criteria[String(i)] = truncate(lines[i]);
    }
    criteria['none'] = 'the line that states the concrete cause of this failure is not among the lines listed above';

    qs[`culprit_${chunkIdx}`] = {
      type: 'choice',
      instructions:
        "The state's `log_lines` is the full console output of one CI job run " +
        '(`job_name` on `branch` in `repo`, runner `runner`; this is attempt ' +
        '`attempt_number` of `max_attempts`, so the log may contain output from ' +
        'more than one attempt if the job was retried). ' +
        'Each option below is named by its index into `log_lines`; its description is that line\'s exact text. ' +
        "Choose the single line that states the concrete cause of the job's failure: the actual error message, " +
        'exception, failing assertion, or timeout/reason text. ' +
        'Do NOT choose a generic wrapper, summary, or status line that only announces that something failed ' +
        "without saying why — for example a bare exit-code line ('Process completed with exit code 1'), " +
        "a lifecycle line ('ELIFECYCLE  Test failed. See above for more details'), a totals line " +
        "('Tests  1 failed | 311 passed'), or an empty '##[error]' marker with no detail after it. " +
        'If the same failure appears more than once because the job was retried, choose the occurrence ' +
        'from the most recent attempt, i.e. nearest the end of `log_lines`. ' +
        "If none of the lines listed in this question's options state the cause, choose \"none\".",
      criteria,
    };
  });

  return qs;
}

export function decide(answers, input) {
  const lines = Array.isArray(input.log_lines) ? input.log_lines : [];
  if (lines.length === 0) return { culprit_line: 'abstain' };

  let best = null; // { index, probability }

  for (const [qid, answer] of Object.entries(answers || {})) {
    if (!qid.startsWith('culprit_') || !answer || answer.choice === undefined) continue;
    if (answer.choice === 'none') continue;

    const probability =
      answer.probabilities && typeof answer.probabilities[answer.choice] === 'number'
        ? answer.probabilities[answer.choice]
        : answer.confidence;

    if (typeof probability !== 'number') continue;

    if (!best || probability > best.probability) {
      best = { index: Number(answer.choice), probability };
    }
  }

  if (!best || !Number.isInteger(best.index) || best.probability < CONFIDENCE_GATE) {
    return { culprit_line: 'abstain' };
  }

  return { culprit_line: best.index };
}
