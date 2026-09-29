// Jev map: pick the single log line that states the cause of a CI job failure.

const CHUNK_SIZE = 254; // leaves room for the "none" option within the 255-option choice limit
const CONFIDENCE_GATE = 0.6;

function chunkRanges(n) {
  const ranges = [];
  for (let start = 0; start < n; start += CHUNK_SIZE) {
    ranges.push([start, Math.min(start + CHUNK_SIZE, n)]);
  }
  return ranges;
}

export function buildState(input) {
  return {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    job_name: input.job_name,
    attempt_number: input.attempt_number,
    max_attempts: input.max_attempts,
    log_lines: input.log_lines,
    convention:
      "CI logs use GitHub-Actions-style ##[group]/##[endgroup] markers around each step. " +
      "Generic wrapper, banner, and summary lines - such as '##[error]Process completed with " +
      "exit code N', 'ELIFECYCLE ... failed', 'Test failed. See above for more details.', or " +
      "aggregate counts like 'Test Files 1 failed | 23 passed' - restate that something failed " +
      "but never say what failed; they are never the culprit line. The culprit line is the " +
      "specific error, assertion, exception, or compiler message that names what actually went " +
      "wrong (for example 'Test timed out in 5000ms.', an AssertionError message, a stack " +
      "trace's top frame, or a linter/type error). If the log contains output from more than " +
      "one attempt (e.g. a retried job whose earlier attempt output is included), only a line " +
      "from the last attempt's output can be the culprit.",
  };
}

export function questions(input) {
  const lines = input.log_lines || [];
  const qs = {};

  for (const [start, end] of chunkRanges(lines.length)) {
    const criteria = {};
    for (let i = start; i < end; i++) {
      criteria[String(i)] = lines[i];
    }
    criteria.none =
      "No line in this range is the culprit: this range contains only generic/wrapper/summary " +
      "text, passing-test output, unrelated setup output, or duplicate output from an earlier " +
      "(non-final) attempt.";
    qs[`cause_${start}`] = {
      type: "choice",
      instructions:
        `Looking only at indices ${start}-${end - 1} of \`log_lines\`, which single line, if ` +
        "any, is the culprit line that states the specific, concrete cause of this CI job's " +
        "failure, per the convention in `convention`? Pick \"none\" if the culprit line is not " +
        "in this range.",
      criteria,
    };
  }

  qs.no_single_cause = {
    type: "noul",
    instructions:
      "Considering all of `log_lines` together, is it true that there is no single line that " +
      "states one specific, concrete cause of the failure - for example because several " +
      "unrelated failures are reported, or because only generic wrapper/summary text is present " +
      "with no actual error, assertion, exception, or compiler message anywhere in the log?",
    criteria: {
      true: "no single line states a specific, concrete cause",
      false: "exactly one line clearly states the specific, concrete cause",
    },
  };

  return qs;
}

export function decide(answers, input) {
  const lines = input.log_lines || [];
  if (lines.length === 0) return { culprit_line: "abstain" };

  const ambiguous = answers.no_single_cause?.noul ?? 0;
  if (ambiguous >= 0.5) return { culprit_line: "abstain" };

  let best = null; // { index, confidence }
  for (const key of Object.keys(answers)) {
    const m = /^cause_(\d+)$/.exec(key);
    if (!m) continue;
    const ans = answers[key];
    if (!ans || ans.choice === "none") continue;
    const index = Number(ans.choice);
    const confidence = ans.probabilities?.[ans.choice] ?? ans.confidence ?? 0;
    if (!best || confidence > best.confidence) best = { index, confidence };
  }

  if (!best || best.confidence < CONFIDENCE_GATE) return { culprit_line: "abstain" };
  return { culprit_line: best.index };
}
