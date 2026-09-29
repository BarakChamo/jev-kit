// map.mjs — CI failure culprit-line finder, built on Jev (TypeSafe System One).

const MAX_CANDIDATES = 60;

// Lines that plausibly state a failure cause, most diagnostic first.
const STRONG = [
  /##\[error\]/i,
  /[×✗]/,
  /→|->/,
  /ELIFECYCLE/,
  /timed? ?out/i,
  /assert/i,
  /exception/i,
  /\berror\b/i,
  /\bfail(ed|ure)?s?\b/i,
  /exit code/i,
  /fatal/i,
  /ENOENT|not found/i,
  /ECONN|ETIMEDOUT|network/i,
  /denied|unauthorized|forbidden/i,
  /out of memory|OOM|killed/i,
  /cannot |can't |unable to /i,
];

function lineRank(text) {
  for (let i = 0; i < STRONG.length; i++) if (STRONG[i].test(text)) return i;
  return -1;
}

// Pick candidate line indices: error-looking lines, deduped by text
// (retried/duplicated log blocks produce identical lines), ranked.
export function candidateLines(input) {
  const lines = input?.log_lines ?? [];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    const rank = lineRank(text);
    if (rank < 0 || !text.trim()) continue;
    const key = text.trim().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ index: i, text, rank });
  }
  out.sort((a, b) => a.rank - b.rank || b.index - a.index);
  return out.slice(0, MAX_CANDIDATES).sort((a, b) => a.index - b.index);
}

export function buildState(input) {
  return {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    job_name: input.job_name,
    attempt: `${input.attempt_number} of ${input.max_attempts}`,
    // Full log, indexed, so Jev sees exact line positions.
    log_lines: (input.log_lines ?? []).map((text, index) => ({ index, text })),
  };
}

export function questions(input) {
  const candidates = candidateLines(input);
  const criteria = {};
  for (const c of candidates) {
    criteria[String(c.index)] =
      `Line ${c.index}: ${c.text.length > 200 ? c.text.slice(0, 200) + "…" : c.text}`;
  }
  criteria.none =
    "No single line states the cause; the failure is ambiguous, absent, or spread across multiple lines.";

  return {
    has_single_cause: {
      type: "noul",
      instructions:
        "You are given a failed CI job's log, with each line labeled by its 0-based index. " +
        "Does the log contain exactly one clearly identifiable line that states the cause of the failure? " +
        "Answer true only if pointing a developer at that one line would let them immediately understand why the job failed. " +
        "Answer false if the cause is ambiguous, purely infrastructural noise, requires reading many lines, or is not in the log.",
      criteria: {
        true: "One specific log line states the failure cause.",
        false:
          "The cause is ambiguous, absent, spread across multiple lines, or not worth surfacing automatically.",
      },
    },
    culprit: {
      type: "choice",
      instructions:
        "Which single line of the log most directly states the cause of the failure? " +
        "Options are labeled by 0-based line index and quote the line. " +
        "Prefer the line naming the actual error (assertion message, timeout, compile error, missing file, etc.) " +
        "over summary lines (e.g. 'Tests  1 failed | 311 passed') or generic lines like exit-code notices. " +
        'If no single line states the cause, choose "none".',
      criteria,
    },
  };
}

export function decide(answers, input) {
  const abstain = { culprit_line: "abstain" };
  const cause = answers?.has_single_cause;
  const pick = answers?.culprit;
  if (!cause || !pick) return abstain;

  // Only decide when Jev is confident a single clear cause line exists.
  if (cause.type !== "noul" || !(cause.noul >= 0.6)) return abstain;
  if (pick.type !== "choice" || pick.choice === "none") return abstain;
  if (!(pick.confidence >= 0.5)) return abstain;

  const index = Number(pick.choice);
  const n = (input?.log_lines ?? []).length;
  if (!Number.isInteger(index) || index < 0 || index >= n) return abstain;

  return { culprit_line: index };
}
