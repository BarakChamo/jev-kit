// CI-failure culprit picker: point developers at the one log line that states the cause.
//
// Encoding (jev-questions rules): one `choice` over EVERY line, no regex pre-filter
// (rule 10/16 — pre-filtering kept the culprit in as few as 5/30 cases; a `noul` per
// line lets wrapper lines like "exit code 1" win). Meaning lives entirely in the
// instructions/criteria (rule 4), the question names its field `log_lines` (rule 2).
// An abstain option (rule 14) plus a probability gate on the label we act on (rule 13):
// unsure never becomes a decision. GATE is a placeholder — fit it with jev-audit on
// ~30 labelled failures before trusting it.

const GATE = 0.8;  // picks from many options: right answers median p 0.94, a tenth under 0.67
const CHUNK = 250; // API caps a choice at 255 options; leaves room for the "none" option

export function buildState(input) {
  // Rule 1/16: every line, unfiltered; long states are cheap and one request answers all questions.
  return {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    job_name: input.job_name,
    attempt_number: input.attempt_number,
    max_attempts: input.max_attempts,
    log_lines: input.log_lines,
  };
}

const RUBRIC =
  'the specific cause of the failure: the error message, exception, or failed assertion itself. ' +
  'Not a generic wrapper such as "Process completed with exit code 1" or "Test failed. See above for more details", ' +
  'not a summary or count of failures, not a duration or timing line, not remediation advice, ' +
  'not a stack frame below the error. If the log shows more than one run, choose from the run that failed.';

export function questions(input) {
  const lines = input.log_lines ?? [];
  if (lines.length <= CHUNK) {
    const criteria = {};
    for (let i = 0; i < lines.length; i++) criteria[String(i)] = lines[i];
    criteria.none =
      'no single line states the specific cause: either no line does, or more than one does and a person should decide';
    return {
      culprit: {
        type: 'choice',
        instructions: `Which line of \`log_lines\` states ${RUBRIC} Options are keyed by the line's 0-based index.`,
        criteria,
      },
    };
  }
  // Over 255 lines: one question per index range, still covering every line (no pre-filter).
  const qs = {};
  for (let start = 0; start < lines.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, lines.length);
    const criteria = {};
    for (let i = start; i < end; i++) criteria[String(i)] = lines[i];
    criteria.none = 'no line in this index range states the specific cause of the failure';
    qs[`chunk_${start}`] = {
      type: 'choice',
      instructions: `Which line of \`log_lines\`, among indices ${start} to ${end - 1}, states ${RUBRIC} Options are keyed by the line's 0-based index.`,
      criteria,
    };
  }
  return qs;
}

export function decide(answers, input) {
  const lines = input.log_lines ?? [];
  const isLine = (k) => /^\d+$/.test(String(k)) && Number(k) < lines.length;
  const candidates = [];
  for (const answer of Object.values(answers ?? {})) {
    if (answer?.type !== 'choice') continue;
    if (!isLine(answer.choice)) continue; // "none" / ambiguous: not a culprit
    const p = answer.probabilities?.[answer.choice] ?? 0;
    if (p >= GATE) candidates.push(Number(answer.choice)); // gate on the label we act on
  }
  // Exactly one gated line -> decide. Zero (nothing found, or unsure) or several
  // (e.g. a retried run failed again) -> a person should look.
  return { culprit_line: candidates.length === 1 ? candidates[0] : 'abstain' };
}
