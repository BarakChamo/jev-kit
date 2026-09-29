// map.mjs — pinpoint the single log line that states the cause of a CI failure.
// Strategy: cheap local heuristics nominate candidate lines, one parallel Jev
// pass picks the culprit and judges whether the cause is visible at all, and
// decide() auto-answers only when both gates clear (otherwise a human looks).

const MAX_CANDIDATES = 48;   // choice questions allow <=255 options; keep it tight
const MAX_TEXT = 240;        // chars kept per candidate/context line
const TAIL_LINES = 12;       // trailing log lines shipped as context
const MIN_CONFIDENCE = 0.55; // min choice confidence to auto-decide
const MIN_VISIBLE = 0.5;     // min P(cause is visibly stated in the log)

// Weighted patterns for lines that can state or signal a failure cause.
const PATTERNS = [
  [10, /^##\[error\]/i],
  [9,  /AssertionError|assertion failed/i],
  [8,  /SyntaxError|TypeError|ReferenceError|RangeError|compil(e|ation) error|compilation failed/i],
  [8,  /Exception|Traceback|panic:|fatal( error)?/i],
  [8,  /timed out|time-?out/i],
  [7,  /npm ERR!|ERR_PNPM|ELIFECYCLE/i],
  [7,  /\bFAIL(ED)?\b|\bfailed\b|\bfailure\b/i],
  [6,  /[✗✖×❯]/],
  [6,  /\berrors?\b|Error:/i],
  [6,  /exit code [1-9]\d*/i],
  [6,  /\bnot ok\b/i],
  [5,  /Cannot find|Module not found|No such file|command not found|does not exist/i],
  [5,  /Segmentation fault|core dumped|out of memory|OOMKilled|\bKilled\b/i],
  [5,  /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|socket hang up/i],
  [5,  /No space left on device|Permission denied|EACCES/i],
];

// The indented line(s) right after these markers usually carry the message.
const MARKER = /[✗✖×❯]|\bFAIL\b|^##\[error\]|npm ERR!|\bnot ok\b/i;

// Deterministic candidate extraction; reused identically by all three exports.
function collectCandidates(input) {
  const lines = Array.isArray(input?.log_lines) ? input.log_lines : [];
  const n = lines.length;
  const scores = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    const raw = String(lines[i] ?? "");
    if (!raw.trim()) continue;
    let s = 0;
    for (const [w, re] of PATTERNS) if (re.test(raw)) s += w;
    if (s > scores[i]) scores[i] = s;
    if (MARKER.test(raw)) {
      for (const [j, floor] of [[i + 1, 6], [i + 2, 4]]) {
        if (j < n && String(lines[j] ?? "").trim() && scores[j] < floor) scores[j] = floor;
      }
    }
  }

  // Dedupe identical lines (retries repeat them); later occurrence wins ties.
  const byText = new Map();
  for (let i = 0; i < n; i++) {
    if (scores[i] <= 0) continue;
    const text = String(lines[i]).trim();
    const key = text.slice(0, 160);
    const prev = byText.get(key);
    if (!prev || scores[i] >= prev.score) {
      byText.set(key, { index: i, text: text.slice(0, MAX_TEXT), score: scores[i] });
    }
  }
  let cands = [...byText.values()];

  // Fallback: no error-ish lines at all -> offer the last substantive lines and
  // let the model/gates decide (they will usually abstain).
  if (cands.length === 0) {
    for (let i = n - 1; i >= 0 && cands.length < 6; i--) {
      const text = String(lines[i]).trim();
      if (text && !/^##\[(group|endgroup)\]/.test(text)) {
        cands.unshift({ index: i, text: text.slice(0, MAX_TEXT), score: 1 });
      }
    }
  }

  cands.sort((a, b) => b.score - a.score || b.index - a.index);
  cands = cands.slice(0, MAX_CANDIDATES).sort((a, b) => a.index - b.index);
  for (const c of cands) c.key = "L" + c.index;
  return cands;
}

export function buildState(input) {
  const lines = Array.isArray(input?.log_lines) ? input.log_lines : [];
  const tailStart = Math.max(0, lines.length - TAIL_LINES);
  return {
    task: "Find the single log line that states the cause of this CI job failure.",
    repo: input?.repo ?? null,
    branch: input?.branch ?? null,
    runner: input?.runner ?? null,
    job_name: input?.job_name ?? null,
    attempt: `${input?.attempt_number ?? "?"} of ${input?.max_attempts ?? "?"}`,
    total_log_lines: lines.length,
    candidates: collectCandidates(input).map((c) => ({ key: c.key, line_index: c.index, text: c.text })),
    log_tail: lines.slice(tailStart).map((t, k) => ({ line_index: tailStart + k, text: String(t).slice(0, MAX_TEXT) })),
  };
}

export function questions(input) {
  const qs = {
    cause_visible: {
      type: "noul",
      instructions:
        "Decide whether this failed CI job's log states the cause of the failure in one specific, identifiable line that a developer can act on.",
      criteria: {
        true: "A single log line clearly states why the job failed (error message, failed assertion, exception, compile/lint error, timeout) and that line is among the candidates.",
        false: "The cause is not visible in one line: the log is truncated or empty, the job was cancelled or killed by infrastructure, the failure is external/flaky with no stated cause, or it is spread across many lines.",
      },
    },
  };

  const cands = collectCandidates(input);
  if (cands.length > 0) {
    const criteria = {};
    for (const c of cands) criteria[c.key] = `log line ${c.index}: ${c.text}`;
    criteria.none = "No candidate line states the actual cause (only generic wrappers, truncated log, or infrastructure/cancellation failure).";
    qs.culprit = {
      type: "choice",
      instructions:
        "This CI job failed. Pick the ONE candidate log line that directly states the root cause of the failure — the specific message a developer should read first. " +
        "Prefer the indented reason line after a failure marker (e.g. prefer '→ Test timed out in 5000ms.' over the '× <test name>' marker above it). " +
        "Avoid generic wrappers and summaries such as 'Process completed with exit code 1', 'ELIFECYCLE', 'See above for more details', or '1 failed | N passed' whenever a more specific cause line exists. " +
        "Pick 'none' if no candidate states a concrete cause.",
      criteria,
    };
  }
  return qs;
}

export function decide(answers, input) {
  const abstain = { culprit_line: "abstain" };
  const lines = Array.isArray(input?.log_lines) ? input.log_lines : [];
  if (lines.length === 0) return abstain;

  const cands = collectCandidates(input);
  if (cands.length === 0) return abstain;

  const vis = answers?.cause_visible;
  if (typeof vis?.noul !== "number" || vis.noul < MIN_VISIBLE) return abstain;

  const pick = answers?.culprit;
  if (pick?.type !== "choice" || typeof pick.choice !== "string" || pick.choice === "none") return abstain;

  const conf = typeof pick.confidence === "number" ? pick.confidence : pick.probabilities?.[pick.choice];
  if (typeof conf !== "number" || conf < MIN_CONFIDENCE) return abstain;
  const pNone = pick.probabilities?.none;
  if (typeof pNone === "number" && (pick.probabilities?.[pick.choice] ?? conf) <= pNone) return abstain;

  const idx = new Map(cands.map((c) => [c.key, c.index])).get(pick.choice);
  if (typeof idx !== "number" || idx < 0 || idx >= lines.length) return abstain;
  return { culprit_line: idx };
}
