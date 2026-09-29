// map.mjs — point developers at the single CI log line that states the cause of the failure.
//
// Shape (jev-questions skill):
//  • ONE `choice` over EVERY log line — option key = the line index, option text = the line —
//    with a rubric naming the generic lines to skip. This is the skill's measured pattern for
//    exactly this task (100% on its reference suite). A `noul` per line is the wrong encoding:
//    a wrapper like "Process completed with exit code 1" truthfully "shows the job failed", so
//    absolute per-line judgements misfire; one choice normalises across all lines.
//  • No code pre-filtering of the log (rule 16): regex-narrowing kept the right line in as few
//    as 5/30 study cases. Long states are cheap — send everything.
//  • Abstain belt (rules 13/14/15): an explicit `none` option inside the choice, a gate on the
//    probability of the picked label (never the under-confident `confidence` scalar), and a
//    detector `noul` that vetoes logs that hold no culprit line at all. Doubt never relaxes a
//    decision: every unsure path returns "abstain" (in a product, also surface the top-3
//    probabilities to a person).
//  • `choice` accepts at most 255 options and one is reserved for `none`, so logs longer than
//    254 lines abstain rather than get pre-filtered; a two-stage chunked scheme would have to
//    be measured with jev-eval before it could replace that abstain.
//
// Before trusting it: grade on ~30 labelled cases (jev-eval) and fit GATE_PICK / GATE_CAUSE with
// jev-audit. 0.8 is the measured start for one choice over 20+ lines (it removed every wrong
// pick and kept 79% of the right ones); 0.5 is a placeholder for the noul veto.

// Rule 3: hand-written domain conventions, written once — not generated per case.
const CONVENTIONS = [
  'How to read this CI log:',
  '- "##[group]" / "##[endgroup]" delimit one step; the line after a "##[group]" is a step header (a command being echoed), not its output.',
  '- "##[error]" prefixes a runner-level message about a step or the job: it reports THAT the step failed, not WHY.',
  '- Test-runner output: a tick/check marks a passing test; "x", "×", "✗" or "FAIL" marks a failed test; "❯" or "›" names a file that contains failures; "→" or indented text directly under a failed test is the error detail — the reason that test failed.',
  '- Lines like "Test Files  1 failed | 23 passed", "Tests  1 failed | 311 passed", "Duration 48.21s", "ELIFECYCLE  Test failed. See above for more details." and "Process completed with exit code 1" report THAT the run failed, not WHY.',
].join('\n');

const GATE_PICK = 0.8; // gate on the picked label's own probability (rule 13; fit with jev-audit)
const GATE_CAUSE = 0.5; // detector floor (rule 15; placeholder, fit with jev-audit)
const CHOICE_CAP = 254; // 255-option choice cap, minus the `none` abstain option

export function buildState(input) {
  return {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    job_name: input.job_name,
    attempt_number: input.attempt_number, // a rerun may repeat the same steps inside one log
    max_attempts: input.max_attempts,
    log_lines: input.log_lines, // the complete, unfiltered log — the source itself, not an extraction (rule 1)
    log_conventions: CONVENTIONS,
  };
}

export function questions(input) {
  const lines = input.log_lines ?? [];
  const qs = {
    // Detector (rule 15): is there anything in this log to point at at all?
    has_specific_cause: {
      type: 'noul',
      instructions:
        'Does any line in `log_lines` state a specific cause of the failure of the `job_name` job: an error message, exception, or failed assertion? ' +
        'Lines that only report THAT something failed — "Process completed with exit code 1", "ELIFECYCLE  Test failed", "Test Files  1 failed | 23 passed", a duration — do not count.',
      criteria: {
        true: 'at least one line states a specific error message, exception or failed assertion',
        false: 'no line states a specific cause: only wrappers, summary counts, durations or passing output appear',
      },
    },
  };
  if (lines.length >= 1 && lines.length <= CHOICE_CAP) {
    // Rules 10 + 16: every line is an option, in order; nothing is filtered out in code.
    const criteria = Object.fromEntries(lines.map((text, i) => [String(i), text]));
    criteria.none =
      'no single line states the specific cause of the failure: only wrappers, summaries or passing output appear, or several lines are equally plausible';
    qs.culprit = {
      type: 'choice',
      instructions:
        'Which line of `log_lines` states the specific cause of the failure of the `job_name` job: the error message, exception, or failed assertion? ' +
        'Each option key is the 0-based index of that line in `log_lines`. ' +
        'Pick the most specific line: where one line only names the failing test or file and a nearby line states the reason (an error, timeout or assertion message), pick the line that states the reason. ' +
        'Skip generic wrappers such as "##[error]Process completed with exit code 1" or "ELIFECYCLE  Test failed. See above for more details."; summary counts such as "Test Files  1 failed | 23 passed"; durations; "##[group]"/"##[endgroup]" markers and step headers; passing tests; advice text such as a hint to pass a timeout value; and stack frames below the error. ' +
        'If the log shows several failing runs of the same steps (retries), pick the error in the last one; if several distinct errors appear in one run, pick the earliest.',
      criteria,
    };
  }
  return qs;
}

export function decide(answers, input) {
  const lines = input.log_lines ?? [];
  const cause = answers.has_specific_cause;
  const culprit = answers.culprit;

  // Detector veto: nothing in this log states a specific cause.
  if (!cause || (cause.noul ?? 0) < GATE_CAUSE) return { culprit_line: 'abstain' };

  // No usable pick: empty log, or longer than the choice cap (see header note).
  if (!culprit) return { culprit_line: 'abstain' };

  // The question's own abstain option (rule 14).
  if (culprit.choice === 'none') return { culprit_line: 'abstain' };

  const idx = Number(culprit.choice);
  if (!Number.isInteger(idx) || idx < 0 || idx >= lines.length) return { culprit_line: 'abstain' };

  // Gate on the probability of the label we act on; unsure never becomes a decision.
  const p = culprit.probabilities?.[culprit.choice] ?? 0;
  if (p < GATE_PICK) return { culprit_line: 'abstain' };

  return { culprit_line: idx };
}
