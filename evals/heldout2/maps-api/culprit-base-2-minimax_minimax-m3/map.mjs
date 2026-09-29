// map.mjs
// Identify the single log line that states the cause of a CI job failure
// using Jev (TypeSafe System One). Candidates are pre-filtered locally so
// the choice question stays inside its 255-option budget; Jev is then
// asked to pick the right one and to flag ambiguous cases for a human.

const CAUSE_PATTERNS = [
  { re: /^[\s]*×\s/,       w: 5 },  // vitest failure mark
  { re: /^[\s]*✗\s/,       w: 5 },  // jest failure mark
  { re: /^[\s]*→\s/,       w: 5 },  // vitest/pytest error intro
  { re: /\bTypeError\b/,   w: 4 },
  { re: /\bSyntaxError\b/, w: 4 },
  { re: /\bReferenceError\b/, w: 4 },
  { re: /\bAssertionError\b/, w: 4 },
  { re: /error TS\d+/,     w: 5 },  // TypeScript
  { re: /\bError\b/,       w: 3 },
  { re: /\bFailed to\b/,   w: 3 },
  { re: /\bCould not\b/,   w: 3 },
  { re: /\bCannot find\b/, w: 3 },
  { re: /Module not found/,w: 4 },
  { re: /\bUNHANDLED\b/,   w: 4 },
  { re: /\bFAIL\b/,        w: 3 },
  { re: /\bpanic:|^FATAL\b/, w: 4 },
  { re: /^[\s]*at\s+\S+:\d+:\d+/, w: 2 }, // stack frame
];

const NEGATIVE_PATTERNS = [
  /^##\[group\]/,
  /^##\[endgroup\]/,
  /^Progress:/i,
  /^Lockfile is up to date/i,
  /^[\s]*Packages:/,
  /^[\s]*Syncing repository:/,
  /^ ELIFECYCLE/,
  /Process completed with exit code/i,
  /^##\[error\]Process completed/i,
  /^[\s]*Duration\b/i,
  /Test Files\s+\d+\s+failed/,
  /Tests\s+\d+\s+failed\s+\|/,
  /^[\s]*Don't want to be\b/i,
];

const MAX_CANDIDATES = 30;
const CONTEXT_BEFORE = 2;
const CONTEXT_AFTER  = 1;

function scoreLine(text, idx, total) {
  let s = 0;
  for (const p of CAUSE_PATTERNS)   if (p.re.test(text)) s += p.w;
  for (const re of NEGATIVE_PATTERNS) if (re.test(text))   s -= 2;
  s += idx / Math.max(1, total); // mild preference for later lines
  return s;
}

function findCandidates(input) {
  const lines = input.log_lines;
  const total = lines.length;
  return lines
    .map((t, i) => ({ i, t, s: scoreLine(t, i, total) }))
    .filter(x => x.s >= 2)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, MAX_CANDIDATES)
    .map(c => {
      const from = Math.max(0, c.i - CONTEXT_BEFORE);
      const to   = Math.min(total - 1, c.i + CONTEXT_AFTER);
      const ctx  = [];
      for (let k = from; k <= to; k++) {
        ctx.push((k === c.i ? "→ " : "  ") + k + ": " + lines[k]);
      }
      return { idx: c.i, text: c.t, score: +c.s.toFixed(2), context: ctx.join("\n") };
    });
}

export function buildState(input) {
  const candidates = findCandidates(input);
  return {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    job_name: input.job_name,
    attempt_number: input.attempt_number,
    max_attempts: input.max_attempts,
    line_count: input.log_lines.length,
    candidate_count: candidates.length,
    candidate_indices: candidates.map(c => c.idx),
    candidates: candidates.map(c => ({ idx: c.idx, text: c.text })),
  };
}

export function questions(input) {
  const candidates = findCandidates(input);
  const criteria = {
    abstain: "No candidate clearly states the cause; send this failure to a human.",
  };
  for (const c of candidates) {
    criteria[String(c.idx)] =
      `Line ${c.idx} (signal ${c.score}):\n${c.context}`;
  }
  return {
    culprit: {
      type: "choice",
      instructions: [
        "From the candidate log lines, choose the single line that states the",
        "cause of the CI job's failure. Prefer lines that name the failing",
        "test or contain the actual error message. Avoid workflow group",
        "begin/end markers, generic exit-code notifications, ELIFECYCLE",
        "wrappers, and suite summary lines. If no candidate clearly states",
        "the cause, choose 'abstain'.",
      ].join(" "),
      criteria,
    },
    decide_confidence: {
      type: "noul",
      instructions: [
        "Given the chosen culprit line, do you trust it enough to point a",
        "developer straight at it, or should a human review first? Return",
        "true only when a specific line clearly states the cause.",
      ].join(" "),
      criteria: {
        true:  "A specific line clearly states the cause; safe to auto-route.",
        false: "Cause is unclear or ambiguous; a human should review.",
      },
    },
    log_clarity: {
      type: "score",
      instructions:
        "How clearly does this log surface the root cause of the failure on a single line?",
      criteria: [
        "Log is dominated by progress / group noise; no single line states a cause.",
        "Several plausible error lines; root cause is ambiguous.",
        "One line clearly stands out as the cause with minor uncertainty.",
        "A single line unambiguously names the failing component and error.",
      ],
    },
  };
}

export function decide(answers, input) {
  const pick = answers?.culprit?.choice;
  if (!pick) return { culprit_line: "abstain" };
  if (pick === "abstain") return { culprit_line: "abstain" };
  const idx = parseInt(pick, 10);
  if (!Number.isInteger(idx) || idx < 0 || idx >= input.log_lines.length) {
    return { culprit_line: "abstain" };
  }
  const conf    = answers?.decide_confidence?.noul ?? 0;
  const clarity = answers?.log_clarity?.score ?? 0;
  if (conf < 0.55) return { culprit_line: "abstain" };
  if (clarity < 1) return { culprit_line: "abstain" };
  return { culprit_line: idx };
}
