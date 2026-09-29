const GENERIC_ERROR_RE = /^##\[error\]|^ELIFECYCLE|^Test Files\s+|^Tests\s+|^Duration\s+|^If this is a long-running test/i;
const SPECIFIC_RE = /timed out|timeout|assertionerror|assertion failed|expected|received|syntaxerror|typeerror|referenceerror|rangeerror|enoent|eacces|cannot find|is not a function|undefined is not|fatal|exception|error:|failed:/i;
const STRONG_SYMBOL_RE = /[×✗❯→]/;

function getCandidateIndexes(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return [];

  const scored = [];
  const seen = new Set();

  const add = (i, score) => {
    if (i >= 0 && i < lines.length && !seen.has(i)) {
      seen.add(i);
      scored.push({ i, score });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] ?? '');
    let score = 0;

    if (GENERIC_ERROR_RE.test(line)) {
      score += 1;
    } else if (SPECIFIC_RE.test(line)) {
      score += 10;
    } else if (/error|fail|failed/i.test(line)) {
      score += 3;
    }

    if (STRONG_SYMBOL_RE.test(line)) score += 5;
    if (line.trim().length < 300) score += 1;

    // Recency boost: causes are usually near the end of a failed run.
    if (i > lines.length * 0.7) score += 3;
    if (i > lines.length * 0.9) score += 5;

    if (score > 0) add(i, score);
  }

  // Always keep a window at the end as a fallback.
  for (let i = Math.max(0, lines.length - 15); i < lines.length; i++) {
    if (!seen.has(i)) add(i, 0);
  }

  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, 250).map((x) => x.i);
}

function buildChoiceQuestion(lines, candidates) {
  const criteria = {};

  for (const i of candidates) {
    const text = String(lines[i] ?? '').trim();
    const desc = text.length > 500 ? `${text.slice(0, 500)}…` : text;
    criteria[String(i)] = `Line ${i}: ${desc || '(empty)'}`;
  }

  criteria['abstain'] =
    'No single log line clearly states the failure cause, or the cause is ambiguous/unavailable.';

  return {
    type: 'choice',
    instructions:
      'Select the one log line that most specifically states the cause of the CI failure. Prefer a concrete failure message (timeout, assertion diff, exception, error text) over a generic lifecycle/exit-code line. The option key is the 0-based line index.',
    criteria,
  };
}

export function buildState(input) {
  return {
    repo: input.repo ?? null,
    branch: input.branch ?? null,
    runner: input.runner ?? null,
    job_name: input.job_name ?? null,
    attempt_number: input.attempt_number ?? null,
    max_attempts: input.max_attempts ?? null,
    log_lines: Array.isArray(input.log_lines)
      ? input.log_lines.map((text, i) => ({ i, text: String(text ?? '') }))
      : [],
  };
}

export function questions(input) {
  const lines = Array.isArray(input.log_lines) ? input.log_lines : [];
  const candidates = getCandidateIndexes(lines);

  const enough = {
    type: 'noul',
    instructions:
      'Is there enough information in the CI log to identify a single culprit line for the failure?',
    criteria: {
      true: 'Yes, the log contains a clear and specific line that states the failure cause.',
      false:
        'No, the cause is not present, is ambiguous, or no single line states it.',
    },
  };

  if (candidates.length === 0) {
    return { enough };
  }

  return {
    enough,
    culprit: buildChoiceQuestion(lines, candidates),
  };
}

export function decide(answers, input) {
  if (!answers || typeof answers !== 'object') return 'abstain';

  const enough = answers.enough;
  const culprit = answers.culprit;

  if (!enough || enough.type !== 'noul' || typeof enough.noul !== 'number') {
    return 'abstain';
  }
  if (enough.noul < 0.55) return 'abstain';

  if (!culprit || culprit.type !== 'choice') return 'abstain';
  if (culprit.choice === 'abstain' || culprit.choice == null) return 'abstain';

  if (typeof culprit.confidence === 'number' && culprit.confidence < 0.6) {
    return 'abstain';
  }

  if (
    culprit.probabilities &&
    typeof culprit.probabilities[culprit.choice] === 'number' &&
    culprit.probabilities[culprit.choice] < 0.5
  ) {
    return 'abstain';
  }

  const idx = Number(culprit.choice);
  const len = Array.isArray(input.log_lines) ? input.log_lines.length : 0;

  if (!Number.isInteger(idx) || idx < 0 || idx >= len) return 'abstain';

  return idx;
}
