const MAX_OPTIONS = 255;
const ABSTAIN = "abstain";
const MAX_CANDIDATES = MAX_OPTIONS - 1;
const MIN_CONFIDENCE = 0.55;
const RESERVED_TAIL = 40;

const HIGH_RULES = [
  { re: /test timed out|timed out in \d+|timeout in \d+/i, score: 100 },
  { re: /timed out|timeout/i, score: 60 },
  {
    re: /assertion(?:\s+error|\s+failed)?|expected .*? (?:to|but)|expect\(|\bexpected\b.*\breceived\b/i,
    score: 85,
  },
  {
    re: /cannot find module|module not found|enoent|no such file|command not found|permission denied|eacces|econnrefused|enotfound/i,
    score: 85,
  },
  {
    re: /syntax error|type error|reference error|uncaught|unhandled|rejection|panic|fatal error|segmentation fault|core dumped|traceback/i,
    score: 80,
  },
  { re: /compiler error|compilation terminated|build failed|error:/i, score: 70 },
  { re: /×|✗|\bFAIL(?:ED|URE)?\b/i, score: 55 },
  { re: /❯/, score: 20 },
  { re: /\berror\b|\bexception\b|\bfail(?:ed|ure)?\b|\bfatal\b/i, score: 25 },
  { re: /exit code [1-9]/i, score: 18 },
  { re: /process completed with exit code/i, score: 12 },
  { re: /elifecycle/i, score: 18 },
];

const NOISE_RULES = [
  { re: /^##\[group\]|^##\[endgroup\]|^::group::|^::endgroup::/i, score: -120 },
  { re: /progress: resolved|packages: \+|syncing repository|lockfile is up to date/i, score: -120 },
  { re: /^\s*RUN\s+v/i, score: -80 },
  { re: /^> /, score: -10 },
  { re: /test files|tests\s+\d+|duration\s+\d/i, score: -35 },
  { re: /see above for more details/i, score: -40 },
  { re: /\bpassed\b|\bsuccess\b|\bdone\b|\bcompleted\b/i, score: -18 },
];

function toText(value) {
  return typeof value === "string" ? value : String(value ?? "");
}

function asLines(input) {
  return Array.isArray(input?.log_lines) ? input.log_lines.map(toText) : [];
}

function clean(text) {
  return toText(text)
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text, max) {
  const s = toText(text);
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

function normKey(text) {
  return clean(text)
    .toLowerCase()
    .replace(/[0-9]+/g, "n")
    .replace(/\s+/g, " ")
    .slice(0, 180);
}

function scoreText(text) {
  if (!text) return -200;

  let score = 0;
  for (const rule of HIGH_RULES) {
    if (rule.re.test(text)) score += rule.score;
  }
  for (const rule of NOISE_RULES) {
    if (rule.re.test(text)) score += rule.score;
  }
  return score;
}

function makeItem(index, raw) {
  const text = clean(raw);
  return { index, raw, text, score: scoreText(text) };
}

function getCandidates(input) {
  const lines = asLines(input);
  if (lines.length === 0) return [];

  if (lines.length <= MAX_CANDIDATES) {
    const all = [];
    for (let i = 0; i < lines.length; i += 1) {
      const item = makeItem(i, lines[i]);
      if (item.text) all.push(item);
    }
    return all.slice(0, MAX_CANDIDATES);
  }

  const scored = [];
  for (let i = 0; i < lines.length; i += 1) {
    const item = makeItem(i, lines[i]);
    if (item.score > 0) scored.push(item);
  }

  const deduped = new Map();
  for (const item of scored) {
    const key = normKey(item.text);
    const old = deduped.get(key);
    if (
      !old ||
      item.score > old.score ||
      (item.score === old.score && item.index > old.index)
    ) {
      deduped.set(key, item);
    }
  }

  const ranked = [...deduped.values()].sort(
    (a, b) => b.score - a.score || b.index - a.index
  );

  const reserved = Math.min(RESERVED_TAIL, MAX_CANDIDATES);
  const topLimit = Math.max(0, MAX_CANDIDATES - reserved);
  const top = ranked.slice(0, topLimit);
  const chosen = new Map(top.map((item) => [item.index, item]));

  let tailCapacity = MAX_CANDIDATES - chosen.size;
  if (ranked.length > topLimit) {
    tailCapacity = Math.min(tailCapacity, reserved);
  }

  let addedTail = 0;
  for (let i = lines.length - 1; i >= 0 && addedTail < tailCapacity; i -= 1) {
    const item = makeItem(i, lines[i]);
    if (!item.text || chosen.has(i)) continue;
    if (item.score <= -80) continue;
    chosen.set(i, item);
    addedTail += 1;
  }

  if (chosen.size < MAX_CANDIDATES) {
    for (const item of ranked.slice(topLimit)) {
      if (chosen.size >= MAX_CANDIDATES) break;
      if (!chosen.has(item.index)) chosen.set(item.index, item);
    }
  }

  return [...chosen.values()]
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, MAX_CANDIDATES)
    .sort((a, b) => a.index - b.index);
}

export function buildState(input) {
  const meta = input ?? {};
  const lines = asLines(meta);
  const candidates = getCandidates(meta);

  return {
    source: "ci_failure_log",
    repo: meta.repo ?? null,
    branch: meta.branch ?? null,
    runner: meta.runner ?? null,
    job_name: meta.job_name ?? null,
    attempt_number: meta.attempt_number ?? null,
    max_attempts: meta.max_attempts ?? null,
    log_line_count: lines.length,
    option_key_is_log_line_index: true,
    candidates: candidates.map((c) => ({
      index: c.index,
      line: truncate(c.text, 700),
    })),
  };
}

export function questions(input) {
  const candidates = getCandidates(input ?? {});
  const criteria = {
    [ABSTAIN]:
      "No single log line clearly states the root cause, or the evidence is ambiguous.",
  };

  for (const c of candidates) {
    if (Object.keys(criteria).length >= MAX_OPTIONS) break;
    const key = String(c.index);
    if (key === ABSTAIN) continue;
    criteria[key] = truncate(c.text, 300);
  }

  return {
    culprit: {
      type: "choice",
      instructions:
        "Select the log line that most directly states the root cause of the CI failure. " +
        "Prefer specific errors, assertion failures, timeouts, missing dependencies, compiler/runtime exceptions, or command failures. " +
        "Avoid group markers, successful output, summary counts, and generic exit-code lines when a more specific cause is present. " +
        "Select abstain if uncertain.",
      criteria,
    },
  };
}

export function decide(answers, input) {
  const answer = answers?.culprit;
  const lines = asLines(input);
  const choice = answer?.choice;

  if (choice == null) return { culprit_line: ABSTAIN };

  const choiceText = String(choice).trim();
  if (!choiceText || choiceText === ABSTAIN) {
    return { culprit_line: ABSTAIN };
  }

  let confidence = Number(answer?.confidence);
  if (!Number.isFinite(confidence) && answer?.probabilities) {
    confidence = Number(answer.probabilities[choiceText]);
  }

  if (!Number.isFinite(confidence) || confidence < MIN_CONFIDENCE) {
    return { culprit_line: ABSTAIN };
  }

  if (!/^\d+$/.test(choiceText)) return { culprit_line: ABSTAIN };

  const idx = Number(choiceText);
  if (!Number.isInteger(idx) || idx < 0 || idx >= lines.length) {
    return { culprit_line: ABSTAIN };
  }

  const text = clean(lines[idx]);
  if (!text) return { culprit_line: ABSTAIN };

  if (/^##\[group\]|^##\[endgroup\]|^::group::|^::endgroup::/i.test(text)) {
    return { culprit_line: ABSTAIN };
  }

  return { culprit_line: idx };
}
