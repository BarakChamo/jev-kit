export function buildState(input) {
  const logLines = Array.isArray(input?.log_lines) ? input.log_lines : [];
  const cleaned = logLines.map(cleanLine);
  const candidates = extractCandidates(cleaned);

  return {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    job_name: input.job_name,
    attempt_number: input.attempt_number,
    max_attempts: input.max_attempts,
    log_length: cleaned.length,
    tail_lines: cleaned.slice(-20).map(truncate),
    candidates: candidates.map(({ index }) => buildCandidate(index, cleaned))
  };
}

export function questions(input) {
  const state = buildState(input);

  const sufficient = {
    type: "noul",
    instructions:
      "Is there enough information in the provided CI log state to identify a single log line that states the cause of the CI job failure? This should be false if the cause is ambiguous, missing, contradictory, or if no single line clearly states the root cause.",
    criteria: {
      true: "The provided log excerpts contain a clear, unambiguous line that states the root cause of the failure.",
      false:
        "The cause is unclear, absent, contradictory, or there is no single line stating the cause."
    }
  };

  if (!state.candidates || state.candidates.length === 0) {
    return { sufficient };
  }

  const options = {};
  for (const candidate of state.candidates) {
    options[String(candidate.index)] = candidate.line;
  }
  options.abstain = "No line clearly states the cause of the CI failure.";

  return {
    sufficient,
    culprit: {
      type: "choice",
      instructions:
        "Choose the single line index that states the cause of the CI job failure. Use state.candidates (each has index, line, and surrounding context), state.tail_lines, and CI log structure. If no line clearly states the cause, choose abstain.",
      criteria: options
    }
  };
}

export function decide(answers, input) {
  if (!answers || typeof answers !== "object") return "abstain";

  const sufficient = answers.sufficient?.noul;
  if (typeof sufficient === "number" && sufficient < 0.5) return "abstain";

  const culprit = answers.culprit;
  if (!culprit || culprit.type !== "choice") return "abstain";

  const choice = culprit.choice;
  if (choice === undefined || choice === null || choice === "abstain") return "abstain";

  const confidence = Number(culprit.confidence);
  if (!Number.isFinite(confidence) || confidence < 0.5) return "abstain";

  const index = Number(choice);
  if (Number.isInteger(index) && index >= 0 && index < input.log_lines.length) {
    return index;
  }

  return "abstain";
}

function cleanLine(line) {
  return String(line)
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\r/g, "");
}

function truncate(line, max = 500) {
  if (line.length <= max) return line;
  return line.slice(0, max) + "...";
}

function buildCandidate(index, cleaned) {
  const start = Math.max(0, index - 3);
  const end = Math.min(cleaned.length, index + 4);
  return {
    index,
    line: truncate(cleaned[index]),
    context: cleaned.slice(start, end).map(truncate)
  };
}

function extractCandidates(cleaned) {
  const items = [];
  for (let i = 0; i < cleaned.length; i++) {
    const score = scoreLine(cleaned[i]);
    if (score >= 6) {
      items.push({ index: i, score });
    }
  }

  items.sort((a, b) => b.score - a.score || a.index - b.index);
  return items.slice(0, 254);
}

function scoreLine(line) {
  const lower = line.toLowerCase();
  const trimmedStart = line.replace(/^\s+/, "");
  let score = 0;

  const patterns = [
    [/\berrors?\b/i, 10],
    [/\bfail(?:ed|ures?)?\b/i, 10],
    [/\bassert(?:ions?)?\b/i, 8],
    [/\btimeouts?\b/i, 10],
    [/\btimed out\b/i, 12],
    [/\bexceptions?\b/i, 10],
    [/\bpanics?\b/i, 10],
    [/\bfatals?\b/i, 10],
    [/\bexit code\b/i, 8],
    [/\bprocess completed\b/i, 5],
    [/\bcannot\b/i, 6],
    [/\bcouldn't\b/i, 6],
    [/\bcould not\b/i, 6],
    [/\bunable\b/i, 6],
    [/\bnot found\b/i, 6],
    [/\bdenied\b/i, 6],
    [/\brejected\b/i, 6],
    [/\bconflicts?\b/i, 6],
    [/\btypeerror\b/i, 10],
    [/\breferenceerror\b/i, 10],
    [/\bsyntaxerror\b/i, 10],
    [/\brangeerror\b/i, 10],
    [/\bexpected\b/i, 6],
    [/\breceived\b/i, 6],
    [/\bactual\b/i, 6],
    [/\bdiff\b/i, 6],
    [/\ber_resolve\b/i, 8],
    [/\bnpm err!?\b/i, 10],
    [/\bpnp err!?\b/i, 10],
    [/\bpnpm err!?\b/i, 10],
    [/\byarn err!?\b/i, 10],
    [/\bwarnings?\b/i, 3]
  ];

  for (const [pattern, points] of patterns) {
    if (pattern.test(lower)) score += points;
  }

  if (/^\s*[×✗✘❯→]/u.test(line)) score += 12;
  if (/^\s*##\[error\]/i.test(line)) score += 8;
  if (/^\s*ELIFECYCLE/i.test(line)) score += 5;
  if (/^\s*(Test Files|Tests|Duration)\s/i.test(line)) score += 3;
  if (/^\s*at\s/i.test(line)) score += 4;
  if (/^\s*\d+\)\s/.test(line)) score += 3;
  if (/\.test\.|\.spec\.|src\/|node_modules/i.test(line)) score += 4;
  if (/\b\d+:\d+:\d+|\bline \d+\b/i.test(line)) score += 4;
  if (/\bexpected\b/i.test(lower) && /\breceived\b/i.test(lower)) score += 10;

  if (/^\s*##\[error\]process completed with exit code/i.test(line)) score -= 25;
  if (/^\s*ELIFECYCLE/i.test(line)) score -= 15;
  if (/^\s*(Test Files|Tests|Duration)\s/i.test(line)) score -= 8;

  if (
    /^(✓|ok|passed|success|up to date|syncing|resolved|reused|downloaded|added|progress:)/i.test(
      trimmedStart
    )
  ) {
    score -= 10;
  }

  return score;
}
