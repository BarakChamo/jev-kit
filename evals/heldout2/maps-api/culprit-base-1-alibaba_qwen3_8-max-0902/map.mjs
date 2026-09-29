const QUESTION_ID = "culprit_line";
const MAX_CHOICES = 254;
const MIN_CONFIDENCE = 0.55;

const candidateCache = new WeakMap();

function linesOf(input) {
  return Array.isArray(input?.log_lines) ? input.log_lines : [];
}

function clean(line) {
  return String(line ?? "")
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(line, max = 220) {
  const s = clean(line);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function scoreLine(raw, idx, total) {
  const text = clean(raw);
  if (!text) return -Infinity;
  if (/^##\[(group|endgroup)\]/i.test(text) || /^::(group|endgroup)::/i.test(text)) {
    return -Infinity;
  }

  let score = 0;
  const add = (re, pts) => {
    if (re.test(text)) score += pts;
  };

  add(/test timed out|timed\s*out|timeout/i, 90);
  add(
    /assertion failed|assertionerror|expected .*?(received|to be|to equal|to match|to throw|to reject|to resolve)|expect\(/i,
    85
  );
  add(
    /\b(typeerror|referenceerror|syntaxerror|rangeerror|urierror|evalerror|aggregateerror|error):/i,
    80
  );
  add(
    /\b(exception|fatal|panic|segfault|segmentation fault|abort trap|core dumped|traceback)\b/i,
    70
  );
  add(/npm err!|pnpm err!|yarn error|elifecycle/i, 50);
  add(
    /build failure|compilation failure|compile error|cannot find module|module not found|command not found|permission denied|connection refused|no such file|enospc|enomem|address already in use/i,
    60
  );
  add(/[×✖✗❌]/, 38);
  add(/[→➜⇒]\s*(test timed out|error|failed|failure|exception|timeout)/i, 55);
  add(/fail(?:ed|ure)?\b/i, 26);
  add(/\b(error|err)\b/i, 18);
  add(/##\[error\]/i, 20);
  add(/exit code\s+\d+/i, 12);

  if (/^\s*at\s+/.test(text)) score -= 35;
  if (/^\s*(✓|✔|PASS|passed|ok)\b/i.test(text)) score -= 90;
  if (/^(syncing repository|lockfile is up to date|packages:|progress:|resolved|reused|downloaded|added|done)\b/i.test(text)) {
    score -= 60;
  }
  if (/^(run|>|RUN)\s/i.test(text)) score -= 8;
  if (/^##\[(warning|notice|debug)\]/i.test(text)) score -= 25;
  if (/if this is|pass a timeout|configure it globally|see above|more details/i.test(text)) {
    score -= 45;
  }
  if (/^\s*(test files|tests|duration)\b/i.test(text)) score -= 25;

  if (total > 1) score += (idx / (total - 1)) * 6;
  return score;
}

function computeCandidates(input) {
  const lines = linesOf(input);
  const total = lines.length;
  const scored = [];

  for (let i = 0; i < total; i += 1) {
    const score = scoreLine(lines[i], i, total);
    if (Number.isFinite(score)) {
      scored.push({ line: i, score, text: truncate(lines[i]) });
    }
  }

  if (!scored.length) return [];

  const byScore = [...scored].sort((a, b) => b.score - a.score || b.line - a.line);
  const usable = scored.filter((c) => c.score >= 0);

  if (!usable.length) return [];
  if (usable.length <= MAX_CHOICES) {
    return usable.sort((a, b) => a.line - b.line);
  }

  const byLine = new Map(scored.map((c) => [c.line, c]));
  const chosen = new Map();

  const add = (c, cap = MAX_CHOICES) => {
    if (c && c.score >= -5 && chosen.size < cap) {
      chosen.set(c.line, c);
    }
  };

  for (const c of byScore.slice(0, 70)) {
    add(c, 160);
    add(byLine.get(c.line - 1), 160);
    add(byLine.get(c.line + 1), 160);
  }

  for (const c of byScore) {
    if (chosen.size >= 180) break;
    add(c, 180);
  }

  const tailStart = Math.max(0, total - 80);
  for (const c of scored) {
    if (c.line >= tailStart) add(c, MAX_CHOICES);
  }

  if (!chosen.size) {
    for (const c of byScore.slice(0, 30)) add(c, MAX_CHOICES);
  }

  let arr = [...chosen.values()];
  if (arr.length > MAX_CHOICES) {
    arr = arr.sort((a, b) => b.score - a.score || b.line - a.line).slice(0, MAX_CHOICES);
  }

  return arr.sort((a, b) => a.line - b.line).map(({ line, text }) => ({ line, text }));
}

function getCandidates(input) {
  if (input && typeof input === "object") {
    const hit = candidateCache.get(input);
    if (hit) return hit;
  }

  const value = computeCandidates(input);
  if (input && typeof input === "object") {
    candidateCache.set(input, value);
  }
  return value;
}

export function buildState(input) {
  return {
    repo: input?.repo ?? null,
    branch: input?.branch ?? null,
    runner: input?.runner ?? null,
    job_name: input?.job_name ?? null,
    attempt_number: input?.attempt_number ?? null,
    max_attempts: input?.max_attempts ?? null,
    log_line_count: linesOf(input).length,
    candidates: getCandidates(input),
  };
}

export function questions(input) {
  const candidates = getCandidates(input).slice(0, MAX_CHOICES);
  const criteria = {
    abstain: "No candidate line clearly and directly states the immediate failure cause.",
  };

  for (const c of candidates) {
    criteria[String(c.line)] = c.text || `line ${c.line}`;
  }

  return {
    [QUESTION_ID]: {
      type: "choice",
      instructions:
        "Choose the single 0-based log line index that states the immediate cause of the CI failure. Prefer explicit errors, exceptions, assertion failures, timeouts, or the first tool-specific error. Avoid summaries, commands, stack frames, passing tests, and generic exit-code lines when a more specific cause is present. Choose abstain if no candidate line clearly states the cause.",
      criteria,
    },
  };
}

export function decide(answers, input) {
  const abstain = { culprit_line: "abstain" };
  const ans = answers?.[QUESTION_ID];

  if (!ans || ans.choice == null) return abstain;

  const choice = String(ans.choice).trim();
  if (!choice || /^abstain$/i.test(choice)) return abstain;

  const idx = Number(choice);
  const lines = linesOf(input);

  if (!Number.isInteger(idx) || idx < 0 || idx >= lines.length) return abstain;

  const text = clean(lines[idx]);
  if (!text) return abstain;
  if (/^##\[(group|endgroup)\]/i.test(text) || /^::(group|endgroup)::/i.test(text)) {
    return abstain;
  }
  if (/^\s*(✓|✔|PASS|passed|ok)\b/i.test(text)) return abstain;

  const candidates = getCandidates(input);
  if (!candidates.length) return abstain;

  const inCandidates = candidates.some((c) => c.line === idx);

  let conf;
  if (typeof ans.confidence === "number" && Number.isFinite(ans.confidence)) {
    conf = ans.confidence;
  } else if (
    ans.probabilities &&
    typeof ans.probabilities[choice] === "number" &&
    Number.isFinite(ans.probabilities[choice])
  ) {
    conf = ans.probabilities[choice];
  } else {
    conf = inCandidates ? 1 : 0;
  }

  const threshold = inCandidates ? MIN_CONFIDENCE : 0.85;
  if (conf < threshold) return abstain;

  return { culprit_line: idx };
}
