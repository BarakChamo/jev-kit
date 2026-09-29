// map.mjs — CI failure culprit-line triage on Jev (TypeSafe System One).

const MAX_CANDIDATES = 24;

const NOISE_RE = /^##\[(group|endgroup)\]/;
const CANDIDATE_RE =
  /##\[error\]|error|failed|failure|fatal|timeout|timed out|exception|cannot|can't|not found|enoent|econn|refused|denied|unauthorized|exit code|elifecycle|✕|×|→|assert|expected|received|throw|panic|segfault|killed|out of memory|oom/i;

// Deterministic heuristic pre-filter: pick a bounded set of line indices worth asking about.
function candidates(input) {
  const lines = input.log_lines || [];
  const idxs = [];
  for (let i = 0; i < lines.length; i++) {
    if (NOISE_RE.test(lines[i])) continue;
    if (CANDIDATE_RE.test(lines[i])) idxs.push(i);
  }
  if (lines.length) {
    const last = lines.length - 1;
    if (!idxs.includes(last)) idxs.push(last); // exit-code / final message line
  }
  if (idxs.length > MAX_CANDIDATES) {
    const head = idxs.slice(0, 6);
    const tail = idxs.slice(idxs.length - (MAX_CANDIDATES - 6));
    idxs.length = 0;
    idxs.push(...new Set([...head, ...tail]));
  }
  return idxs;
}

function context(input, i) {
  const L = input.log_lines;
  const prev = i > 0 ? L[i - 1] : "";
  const next = i < L.length - 1 ? L[i + 1] : "";
  return `previous line: ${JSON.stringify(prev)}\nthis line: ${JSON.stringify(L[i])}\nnext line: ${JSON.stringify(next)}`;
}

export function buildState(input) {
  const c = candidates(input);
  return {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    job_name: input.job_name,
    attempt_number: input.attempt_number,
    max_attempts: input.max_attempts,
    log_line_count: (input.log_lines || []).length,
    candidates: c.map((i) => ({ index: i, with_context: context(input, i) })),
  };
}

export function questions(input) {
  const c = candidates(input);
  const qs = {
    has_clear_cause: {
      type: "noul",
      instructions:
        "This is a failed CI job log. Does the log contain one specific line that directly states the cause of the job failure (the underlying error, assertion, timeout, missing dependency, etc.), as opposed to only generic summaries or a bare exit-code message?",
      criteria: {
        true: "There is a line that states the actual cause of the failure.",
        false: "The log only shows generic symptoms, summaries, or an exit-code message with no stated cause.",
      },
    },
    needs_human: {
      type: "noul",
      instructions:
        "Should this failure be triaged by a human engineer rather than an automated pointer? Answer true for ambiguous causes, infrastructure/runner/network issues, cancellations, out-of-memory kills, multiple unrelated failures, or anything where no single line reliably states the cause.",
      criteria: {
        true: "A human should look at this; no single line can be trusted as the cause.",
        false: "An automated pointer to a single culprit line is appropriate.",
      },
    },
  };
  c.forEach((i, n) => {
    qs["cand_" + n] = {
      type: "noul",
      instructions: `Candidate culprit is log line #${i} (0-based).\n${context(input, i)}\nIs THIS line the single line that states the cause of the job failure? It must state the cause itself (error message, assertion diff, timeout detail, missing file, etc.), not merely name a failing test, summarize counts, or report the exit code.`,
      criteria: {
        true: "This line itself states the direct cause of the job failure.",
        false: "This line is a generic symptom, a summary/count, retry noise, or does not state the cause.",
      },
    };
  });
  return qs;
}

export function decide(answers, input) {
  const a = answers || {};
  const isNoul = (k) => (a[k] && a[k].type === "noul" ? a[k].noul : null);

  const clear = isNoul("has_clear_cause");
  const human = isNoul("needs_human");
  if (clear === null || clear < 0.6) return { culprit_line: "abstain" };
  if (human !== null && human > 0.5) return { culprit_line: "abstain" };

  const c = candidates(input);
  let best = -1, bestP = 0, second = 0;
  for (let n = 0; n < c.length; n++) {
    const p = isNoul("cand_" + n) ?? 0;
    if (p > bestP) { second = bestP; bestP = p; best = c[n]; }
    else if (p > second) second = p;
  }
  if (best < 0 || bestP < 0.65 || bestP - second < 0.05) return { culprit_line: "abstain" };
  return { culprit_line: best };
}
