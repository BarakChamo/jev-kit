// Decide which single log line states the cause of a CI failure, via Jev.

const SKIP_LINE_RE = /^(##\[(?:group|endgroup|error)\]|Syncing repository:|Lockfile is up to date|Progress: resolved|Packages: ?[+-]|Duration\b|> |^\s*[✓✔]\s|^\s*RUN\b)/;
const ERROR_HINT_RE = /(fail|error|FAIL|×|✗|throw|TypeError|AssertionError|ELIFECYCLE|Test failed|Timed out|exit code \d|^Error\b|panic\b|^\s*at\s|\d+:\d+\]|\[ERROR\]|stack:\s)/i;

function candidateIndices(lines) {
  const out = [];
  let prev = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (SKIP_LINE_RE.test(l)) continue;
    if (l === prev) continue;
    out.push(i);
    prev = l;
  }
  if (out.length <= 254) return out;
  const errs = out.filter((i) => ERROR_HINT_RE.test(lines[i]));
  const tail = out.slice(-150);
  const merged = Array.from(new Set([...errs, ...tail])).sort((a, b) => a - b);
  if (merged.length <= 254) return merged;
  const last100 = out.slice(-100);
  const room = Math.max(1, 254 - last100.length);
  return Array.from(new Set([...last100, ...errs.slice(-room)])).sort((a, b) => a - b);
}

export function buildState(input) {
  return {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    job_name: input.job_name,
    attempt: `${input.attempt_number}/${input.max_attempts}`,
    log_count: input.log_lines.length,
    log_lines: input.log_lines,
  };
}

const trunc = (s, n) => (s.length > n ? s.slice(0, n) + "…" : s);

export function questions(input) {
  const lines = input.log_lines;
  const cands = candidateIndices(lines);
  const criteria = {};
  for (const i of cands) criteria[String(i)] = `[L${i}] ${trunc(lines[i], 280)}`;
  return {
    culprit: {
      type: "choice",
      instructions:
        "Pick the single log line that states the ROOT CAUSE of the CI failure — the specific error, exception, assertion, timeout, or failure condition that triggered the job to fail. Reject step markers (##[group], ##[endgroup], ##[error]), repository sync output, package install progress, '> command' echoes, runtime banners (RUN v…), passing-test lines (✓), summary counts (e.g. 'N failed | M passed'), 'see above' references, and the final exit-code / ELIFECYCLE summary. Among remaining candidates pick the most specific one: an exact assertion message, an exception/panic reason, a timeout explanation, or the failing expectation.",
      criteria,
    },
    is_targetable: {
      type: "noul",
      instructions:
        "Does this log contain a single line that clearly states the root cause of the failure — a concrete, specific, actionable failure reason visible verbatim in one line?",
      criteria: {
        true: "Yes — one line states a specific, actionable cause a developer can act on.",
        false: "No — the cause must be pieced together from multiple lines, or no specific failure reason is visible.",
      },
    },
  };
}

export function decide(answers, input) {
  const t = answers && answers.is_targetable;
  if (!t || !Number.isFinite(t.noul) || t.noul < 0.6) return { culprit_line: "abstain" };
  const c = answers && answers.culprit;
  if (!c) return { culprit_line: "abstain" };
  if (typeof c.choice !== "number" && typeof c.choice !== "string") return { culprit_line: "abstain" };
  if (typeof c.confidence === "number" && c.confidence < 0.3) return { culprit_line: "abstain" };
  const idx = typeof c.choice === "string" ? parseInt(c.choice, 10) : c.choice;
  if (!Number.isInteger(idx) || idx < 0 || idx >= input.log_lines.length) return { culprit_line: "abstain" };
  if (SKIP_LINE_RE.test(input.log_lines[idx])) return { culprit_line: "abstain" };
  return { culprit_line: idx };
}
