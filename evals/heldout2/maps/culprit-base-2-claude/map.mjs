// Identify the single CI log line that states the root cause of a job failure.

const MAX_OPTIONS = 255;
const TAIL_CONTEXT = 60;
const TRUNCATE = 300;

const FAILURE_RE =
  /error|exception|traceback|panic|fatal|denied|refused|timed out|timeout|failed|failure|✗|×|cannot |unable to|not found|no such|assert|ENOENT|EACCES|ECONNREFUSED|segfault|core dumped|non-zero exit|exit code [1-9]/i;

function truncate(s) {
  if (typeof s !== "string") s = String(s);
  return s.length > TRUNCATE ? s.slice(0, TRUNCATE) + "…" : s;
}

// Find likely-relevant line indices: lines matching failure-ish patterns,
// plus the line immediately following each match (many tools put the
// specific reason on the next line, e.g. a "→ ..." explanation after "×").
function findCandidates(lines) {
  const hit = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (FAILURE_RE.test(lines[i])) {
      hit.add(i);
      if (i + 1 < lines.length) hit.add(i + 1);
    }
  }
  let candidates = [...hit].sort((a, b) => a - b);
  if (candidates.length > MAX_OPTIONS) {
    // Prefer the most recent matches (closest to end of log).
    candidates = candidates.slice(candidates.length - MAX_OPTIONS);
  }
  return candidates;
}

export function buildState(input) {
  const lines = input.log_lines || [];
  const candidates = findCandidates(lines);
  const tailStart = Math.max(0, lines.length - TAIL_CONTEXT);

  return {
    repo: input.repo,
    branch: input.branch,
    job_name: input.job_name,
    attempt_number: input.attempt_number,
    max_attempts: input.max_attempts,
    total_lines: lines.length,
    candidate_lines: candidates.map((i) => ({ index: i, text: truncate(lines[i]) })),
    tail_context: lines.slice(tailStart, lines.length).map((t, k) => ({
      index: tailStart + k,
      text: truncate(t),
    })),
  };
}

export function questions(input) {
  const lines = input.log_lines || [];
  const candidates = findCandidates(lines);
  if (candidates.length === 0) return {};

  const criteria = {};
  for (const i of candidates) {
    criteria[String(i)] = truncate(lines[i]);
  }

  return {
    culprit: {
      type: "choice",
      instructions:
        "This is a CI job's log. Pick the single line number whose text most directly and " +
        "specifically states the root cause of the failure (the actual error/reason), not a " +
        "generic wrapper like a nonzero exit code notice or a summary count of failures, and " +
        "not the name of the failing test/step itself if a more specific reason line exists. " +
        "If the log has multiple retried attempts, prefer the cause from the final attempt.",
      criteria,
    },
    clear_cause: {
      type: "noul",
      instructions:
        "Look at this CI job's failure log. Does it contain one specific log line that clearly " +
        "states the root cause of the failure?",
      criteria: {
        true: "Exactly one line clearly identifies a specific root cause (a concrete error message, exception, assertion, or reason).",
        false:
          "No single line clearly states the cause: the log is ambiguous, shows multiple unrelated failures, is truncated/incomplete, or only has generic/non-specific failure notices.",
      },
    },
  };
}

export function decide(answers, input) {
  const culprit = answers && answers.culprit;
  if (!culprit || typeof culprit.choice === "undefined") return { culprit_line: "abstain" };

  const clear = answers.clear_cause && typeof answers.clear_cause.noul === "number"
    ? answers.clear_cause.noul
    : 1;

  if (clear < 0.5) return { culprit_line: "abstain" };
  if (typeof culprit.confidence === "number" && culprit.confidence < 0.55) {
    return { culprit_line: "abstain" };
  }

  const idx = parseInt(culprit.choice, 10);
  const lines = input.log_lines || [];
  if (!Number.isInteger(idx) || idx < 0 || idx >= lines.length) {
    return { culprit_line: "abstain" };
  }

  return { culprit_line: idx };
}
