// map.mjs — CI failure culprit-line triage on Jev (TypeSafe System One).

const MAX_CANDIDATES = 60;

// Heuristic candidate pre-filter: lines that plausibly state a failure cause.
const CAUSE_RE =
  /##\[error\]|\berror\b|exception|fatal|assert\w*|\bexpected\b|timed?\s?out|exit code|\bfail(?:ed|ure|s)?\b|cannot find|not found|enoent|permission denied|econnrefused|segfault|out of memory|\boom\b|typeerror|referenceerror|is not a function|null is not|undefined\b|elifecycle|→|×|✗|✘|✖/i;

function scoreLine(line, i, total) {
  let s = 0;
  if (/##\[error\]/i.test(line)) s += 3;
  if (/[→×✗✘✖]/.test(line)) s += 3;
  if (CAUSE_RE.test(line)) s += 2;
  // Failures are usually reported near the end of the log; bias slightly.
  s += (i / Math.max(total, 1)) * 0.5;
  return s;
}

function candidates(input) {
  const lines = input.log_lines ?? [];
  const total = lines.length;
  return lines
    .map((line, i) => ({ i, line, s: scoreLine(line, i, total) }))
    .filter((c) => c.s >= 2) // must hit at least one keyword
    .sort((a, b) => b.s - a.s)
    .slice(0, MAX_CANDIDATES)
    .sort((a, b) => a.i - b.i);
}

export function buildState(input) {
  const lines = input.log_lines ?? [];
  const cands = candidates(input);
  return {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    job_name: input.job_name,
    attempt_number: input.attempt_number,
    max_attempts: input.max_attempts,
    // Numbered log so the model can reference exact line indices.
    log_lines: lines.map((l, i) => `${i}: ${l}`),
    // Shortlist produced by keyword heuristics; the culprit is very likely here.
    candidate_lines: cands.map((c) => ({ index: c.i, line: c.line.slice(0, 300) })),
  };
}

export function questions(input) {
  const qs = {
    identifiable: {
      type: "noul",
      instructions:
        "Look at this CI job log. Is there a single log line that directly states the underlying cause of the job failure? " +
        "The line must name the actual problem (an error message, assertion failure, timeout, missing dependency, crash, etc.).",
      criteria: {
        true: "One specific log line clearly states the root cause of the failure (e.g. 'Test timed out in 5000ms', 'Cannot find module ...', 'Expected 3 to be 4').",
        false: "No single line states the cause: the log is truncated, the failure is only implied, there are multiple unrelated failures, or the log ends without explanation.",
      },
    },
  };
  const cands = candidates(input);
  if (cands.length > 0) {
    const criteria = {};
    for (const c of cands) criteria[String(c.i)] = c.line.slice(0, 250);
    qs.culprit = {
      type: "choice",
      instructions:
        "The job failed. From these candidate log lines (keys are 0-based line indices), pick the one line that most directly states the CAUSE of the failure. " +
        "Prefer the specific root-cause message (the exact error, assertion, timeout, or exception). " +
        "Do NOT pick generic symptom or summary lines such as 'Process completed with exit code 1', 'ELIFECYCLE ... Test failed', " +
        "'Test Files 1 failed | 23 passed', or step/runner annotations, unless no more specific cause line exists. " +
        "If the log shows repeated runs (retries), pick the line from the final failed run.",
      criteria,
    };
  }
  return qs;
}

export function decide(answers, input) {
  const a = answers ?? {};
  const lines = input.log_lines ?? [];
  const abstain = { culprit_line: "abstain" };

  // We only auto-decide when the model is confident a single cause line exists.
  const identifiable = a.identifiable?.noul ?? 0;
  if (identifiable < 0.6) return abstain;

  const choice = a.culprit;
  if (!choice || choice.choice == null) return abstain;
  if ((choice.confidence ?? 0) < 0.6) return abstain;

  const idx = Number(choice.choice);
  if (!Number.isInteger(idx) || idx < 0 || idx >= lines.length) return abstain;

  return { culprit_line: idx };
}
