const MAX_CHOICES = 255;
const CULPRIT_GATE = 0.8;

export function buildState(input = {}) {
  const logLines = Array.isArray(input?.log_lines) ? input.log_lines : [];

  return {
    repo: input?.repo ?? null,
    branch: input?.branch ?? null,
    runner: input?.runner ?? null,
    job_name: input?.job_name ?? null,
    attempt_number: input?.attempt_number ?? null,
    max_attempts: input?.max_attempts ?? null,
    log_lines: logLines,
    line_count: logLines.length,
  };
}

export function questions(input = {}) {
  const logLines = Array.isArray(input?.log_lines) ? input.log_lines : [];

  // A `choice` question has at most 255 options. Do not truncate or pre-filter.
  if (logLines.length === 0 || logLines.length > MAX_CHOICES) {
    return {};
  }

  const criteria = {};
  for (let i = 0; i < logLines.length; i += 1) {
    criteria[String(i)] = `log_lines[${i}]: ${logLines[i]}`;
  }

  if (logLines.length < MAX_CHOICES) {
    criteria.ambiguous =
      'No single line in `log_lines` states the specific cause of the CI failure; a person should decide.';
  }

  return {
    culprit: {
      type: 'choice',
      instructions:
        'Which single line of `log_lines` states the specific cause of the CI job failure? Choose the most specific line that tells a developer what failed and why. Prefer a concrete error, failed assertion, failed expectation, exception, or direct failure reason such as a timeout message. Do not choose `##[group]` / `##[endgroup]` markers, checkout or install progress, test-runner summary lines such as "Test Files 1 failed | 23 passed" or "Tests 1 failed | 311 passed", "ELIFECYCLE" lines, or "##[error]Process completed with exit code 1." when a more specific line exists.',
      criteria,
    },
  };
}

export function decide(answers = {}, input = {}) {
  const logLines = Array.isArray(input?.log_lines) ? input.log_lines : [];
  const answer = answers?.culprit;

  if (!answer || answer.type !== 'choice' || answer.choice === 'ambiguous') {
    return { culprit_line: 'abstain' };
  }

  const probability = answer.probabilities?.[answer.choice];
  if (typeof probability !== 'number' || probability < CULPRIT_GATE) {
    return { culprit_line: 'abstain' };
  }

  const index = Number(answer.choice);
  if (!Number.isInteger(index) || index < 0 || index >= logLines.length) {
    return { culprit_line: 'abstain' };
  }

  return { culprit_line: index };
}
