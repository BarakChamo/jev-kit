// Picks the single log line that states the root cause of a CI failure.

const CULPRIT_RE =
  /error|exception|fail(?:ed|ure)?|\bfatal\b|panic:|traceback|[×✗✕]|timed?\s*out|assert(?:ion)?|exit code [1-9]|##\[error\]|segmentation fault|cannot find module|command not found|permission denied|ENOENT|ECONNREFUSED|ETIMEDOUT|EACCES|npm ERR!|no such file or directory|out of memory|oom|killed/i;

const MAX_OPTIONS = 255;

function truncate(s, n = 240) {
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function findCandidates(logLines) {
  const idx = [];
  for (let i = 0; i < logLines.length; i++) {
    if (CULPRIT_RE.test(logLines[i])) idx.push(i);
  }
  // Keep the tail (closest to the actual failure/end of run) if too many.
  return idx.length > MAX_OPTIONS ? idx.slice(idx.length - MAX_OPTIONS) : idx;
}

export function buildState(input) {
  return {
    repo: input.repo,
    branch: input.branch,
    job_name: input.job_name,
    runner: input.runner,
    attempt_number: input.attempt_number,
    max_attempts: input.max_attempts,
    log_lines: input.log_lines.map((line, i) => `${i}: ${line}`),
  };
}

export function questions(input) {
  const candidates = findCandidates(input.log_lines);
  if (candidates.length === 0) return {};

  const criteria = {};
  for (const i of candidates) criteria[String(i)] = truncate(input.log_lines[i]);

  return {
    culprit: {
      type: 'choice',
      instructions:
        'This is a CI job log (state.log_lines, 0-based indices). The job failed. ' +
        'Pick the single line index that most specifically states the concrete cause of the failure ' +
        '(e.g. the assertion/exception/timeout/panic message), NOT a generic wrapper or summary line ' +
        '(e.g. "exit code 1", "Test failed. See above", "##[error]Process completed..."). ' +
        'If the log contains repeated/retried step groups, focus on the failure tied to the final relevant attempt ' +
        '(attempt_number/max_attempts in state), not an earlier successful pass.',
      criteria,
    },
    identifiable: {
      type: 'noul',
      instructions:
        'Given the same CI log (state.log_lines), is there exactly one line that clearly and specifically ' +
        'states the root cause of the failure, such that a developer reading only that line would know why it failed?',
      criteria: {
        true: 'One line clearly and specifically states the concrete cause (a real error/assertion/exception message, not just a generic exit-code or "failed" summary).',
        false: 'No single line clearly pinpoints the cause: it is ambiguous, spread across multiple lines, or only generic wrapper/summary messages exist.',
      },
    },
  };
}

export function decide(answers, input) {
  const candidates = findCandidates(input.log_lines);
  if (candidates.length === 0) return { culprit_line: 'abstain' };

  const identifiable = answers?.identifiable;
  if (!identifiable || typeof identifiable.noul !== 'number' || identifiable.noul < 0.6) {
    return { culprit_line: 'abstain' };
  }

  const culprit = answers?.culprit;
  if (!culprit || typeof culprit.confidence !== 'number' || culprit.confidence < 0.55) {
    return { culprit_line: 'abstain' };
  }

  const idx = Number.parseInt(culprit.choice, 10);
  if (!Number.isInteger(idx) || !candidates.includes(idx)) {
    return { culprit_line: 'abstain' };
  }

  return { culprit_line: idx };
}
