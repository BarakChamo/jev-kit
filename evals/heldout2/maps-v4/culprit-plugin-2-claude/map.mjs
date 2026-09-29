// Jev map: pick the single log line that states the cause of a CI job failure.

const CHUNK_SIZE = 254; // leave room for the "none" option under the 255-option cap
const NONE_KEY = 'none';
const NONE_DESC =
  'No single line clearly states a specific cause of the failure — the log is ambiguous, ' +
  'the only failure evidence is a generic wrapper/summary line, or several lines are equally ' +
  'plausible candidates.';

const INSTRUCTIONS =
  'The state\'s "log" field is the numbered console log of one failed CI job attempt ' +
  '(job_name, runner, branch, repo, attempt_number/max_attempts also given for context). ' +
  'Pick the ONE line whose text most specifically states the underlying cause of the failure: ' +
  'an assertion failure, exception message, compiler/linter error, timeout message, or other ' +
  'explicit error text. Do NOT pick a generic wrapper or summary line that only reports that ' +
  'something failed without saying why — e.g. "##[error]Process completed with exit code N", a ' +
  'bare non-zero-exit notice, a test runner\'s aggregate "N failed" count line, or a generic ' +
  '"Test failed. See above for details" message. The log may contain a repeated or duplicated ' +
  `section (e.g. a retried step); consider the whole log and pick the line that names the ` +
  `specific cause. If no single line does this, choose "${NONE_KEY}".`;

// Placeholder — tune against labelled cases with jev-audit before relying on this.
const CONFIDENCE_GATE = 0.6;

function truncate(s, n) {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

export function buildState(input) {
  const lines = input.log_lines || [];
  return {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    job_name: input.job_name,
    attempt_number: input.attempt_number,
    max_attempts: input.max_attempts,
    log: lines.map((line, i) => `${i}: ${line}`).join('\n'),
  };
}

export function questions(input) {
  const lines = input.log_lines || [];
  const qs = {};
  if (lines.length === 0) return qs;

  const singleChunk = lines.length <= CHUNK_SIZE;
  for (let start = 0; start < lines.length; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE, lines.length);
    const id = singleChunk ? 'culprit' : `culprit_${start}`;
    const criteria = {};
    for (let i = start; i < end; i++) {
      criteria[String(i)] = truncate(lines[i], 500);
    }
    criteria[NONE_KEY] = NONE_DESC;
    qs[id] = { type: 'choice', instructions: INSTRUCTIONS, criteria };
  }
  return qs;
}

export function decide(answers, input) {
  const lines = input.log_lines || [];
  if (lines.length === 0) return { culprit_line: 'abstain' };

  let best = null; // { index, prob }
  for (const [id, answer] of Object.entries(answers || {})) {
    if (!id.startsWith('culprit')) continue;
    if (!answer || answer.choice === undefined || answer.choice === NONE_KEY) continue;
    const idx = Number(answer.choice);
    if (!Number.isInteger(idx) || idx < 0 || idx >= lines.length) continue;
    const prob =
      (answer.probabilities && answer.probabilities[answer.choice]) ?? answer.confidence ?? 0;
    if (!best || prob > best.prob) best = { index: idx, prob };
  }

  if (!best || best.prob < CONFIDENCE_GATE) return { culprit_line: 'abstain' };
  return { culprit_line: best.index };
}
