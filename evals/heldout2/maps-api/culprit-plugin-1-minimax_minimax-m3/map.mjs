// map.mjs — point at the single log line that states the cause of a CI failure.
// One parallel pass. One `choice` over every line, no pre-filter.
// Gate on the chosen line's probability; abstain otherwise.

const CHOICE_CAP = 255;  // system-one limit on options per `choice`
const ACT        = 0.80;  // commit to the picked line at or above this probability
const REVIEW     = 0.50;  // below this, send the case to a person

export function buildState(input) {
  return {
    log_lines:  input.log_lines,
    line_count: input.log_lines.length,
    job_name:   input.job_name,
    runner:     input.runner,
    branch:     input.branch,
    repo:       input.repo,
    attempt:    `${input.attempt_number} of ${input.max_attempts}`,
  };
}

export function questions(input) {
  const lines = input.log_lines;
  if (lines.length === 0) return {};

  if (lines.length <= CHOICE_CAP) {
    return {
      culprit: {
        type: 'choice',
        instructions:
          `Which single line of \`log_lines\` (one of ${lines.length} lines from job ` +
          `\`job_name\` on \`runner\`, attempt \`attempt\` in \`repo\` on \`branch\`) ` +
          `states the specific cause of the failure — the error message, exception, ` +
          `failed assertion, or test timeout itself? ` +
          `Do not pick a generic wrapper such as "Process completed with exit code 1", ` +
          `"ELIFECYCLE  Test failed.", or "Build failed"; ` +
          `do not pick a summary count such as "Test Files  1 failed | 23 passed"; ` +
          `do not pick a \`##[group]\` or \`##[endgroup]\` marker; ` +
          `do not pick a stack frame that appears below the actual error; ` +
          `do not pick a line that merely names the failing test or file. ` +
          `The cause is the line that states *why* the failure occurred — the assertion ` +
          `that failed, the timeout that fired, the exception that was thrown, or the ` +
          `resource that was missing.`,
        criteria: Object.fromEntries(lines.map((text, i) => [String(i), text])),
      },
    };
  }

  // Long log: the API caps a `choice` at 255 options. The exact line is best left
  // to a person; we only ask for the region so the log can be narrowed.
  return {
    culprit_zone: {
      type: 'choice',
      instructions:
        `\`log_lines\` has ${lines.length} lines; failures are reported near the end ` +
        `of the log. In which region of \`log_lines\` is the line that states the ` +
        `specific cause of the failure?`,
      criteria: {
        last_5_percent: 'the last 5% of the log',
        last_quarter:   'the last 25%',
        middle_half:    'the middle 50%',
        first_quarter:  'the first 25%',
      },
    },
  };
}

export function decide(answers, input) {
  const lines = input.log_lines;
  if (lines.length === 0) return { culprit_line: 'abstain' };

  if (lines.length <= CHOICE_CAP) {
    const a = answers.culprit;
    if (!a || a.probabilities == null) return { culprit_line: 'abstain' };
    const choice = a.choice;
    const p = a.probabilities[choice] ?? 0;
    if (p < REVIEW) return { culprit_line: 'abstain' };
    const idx = Number(choice);
    if (!Number.isInteger(idx) || idx < 0 || idx >= lines.length) {
      return { culprit_line: 'abstain' };
    }
    return p >= ACT ? { culprit_line: idx } : { culprit_line: 'abstain' };
  }

  // Long log: only the region was identified; the exact line is for a person.
  return { culprit_line: 'abstain' };
}
