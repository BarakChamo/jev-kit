const linesOf = (input) =>
  Array.isArray(input?.log_lines) ? input.log_lines.map((line) => String(line)) : [];

const scoreLine = (line) => {
  const s = line.toLowerCase();

  if (/^(?:\s*at\s+|\s*caused by:)/i.test(line)) return 88;
  if (/\b(?:typeerror|referenceerror|syntaxerror|rangeerror|assertionerror|exception|panic)\b/i.test(line)) return 100;
  if (/\b(?:test timed out|timed out|timeout|deadline exceeded)\b/i.test(line)) return 98;
  if (/\b(?:assertion failed|expected:|received:|expected .+ (?:to|but)|actual:)\b/i.test(line)) return 94;
  if (/\b(?:no space left|out of memory|oomkilled|segmentation fault|segfault|core dumped|killed)\b/i.test(line)) return 96;
  if (/\b(?:permission denied|access denied|authentication failed|unauthorized|forbidden|connection refused|network is unreachable)\b/i.test(line)) return 93;
  if (/\b(?:cannot find|module not found|command not found|not found|unable to|failed to)\b/i.test(line)) return 90;
  if (/\b(?:compile error|build error|lint error|validation error|dependency conflict)\b/i.test(line)) return 89;
  if (/\b(?:error|exception|fatal)\b/i.test(line)) return 82;
  if (/^\s*[×✖]\s/.test(line) || /\b\d+\s+failed\b/i.test(line)) return 72;
  if (/\b(?:failed|failure|unsuccessful)\b/i.test(line)) return 55;
  if (/\b(?:exit code|elifecycle|process completed)\b/i.test(line)) return 10;
  if (/\b(?:warn|warning)\b/i.test(line)) return 5;
  return 0;
};

const isNonCauseSummary = (line) =>
  /\b(?:0 failed|0 failures|all tests passed|successfully completed|exit code 0)\b/i.test(line);

const candidateLines = (input) => {
  const lines = linesOf(input);
  const candidates = [];

  for (let index = 0; index < lines.length; index++) {
    const text = lines[index];
    const score = isNonCauseSummary(text) ? 0 : scoreLine(text);
    if (score > 0) candidates.push({ index, text, score });
  }

  if (!candidates.length) {
    return lines
      .slice(Math.max(0, lines.length - 80))
      .map((text, offset) => ({
        index: Math.max(0, lines.length - 80) + offset,
        text,
        score: 0,
      }));
  }

  return candidates
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, 255)
    .sort((a, b) => a.index - b.index);
};

export function buildState(input) {
  const lines = linesOf(input);
  const candidates = candidateLines(input);

  return {
    job: {
      repo: input?.repo,
      branch: input?.branch,
      runner: input?.runner,
      job_name: input?.job_name,
      attempt_number: input?.attempt_number,
      max_attempts: input?.max_attempts,
    },
    log_lines: lines.map((text, index) => ({ index, text })),
    candidate_lines: candidates.map(({ index, text }) => ({ index, text })),
  };
}

export function questions(input) {
  const candidates = candidateLines(input);

  const result = {
    has_culprit: {
      type: "noul",
      instructions:
        "Decide whether the log contains one candidate line that directly states the specific cause of this job failure. A direct error, exception, assertion, timeout, compiler diagnostic, or infrastructure cause qualifies. Do not treat a generic failure summary, retry notice, or exit-code wrapper as the cause.",
      criteria: {
        true: "A single candidate line directly identifies the concrete failure cause.",
        false: "The cause is absent, ambiguous, only implied, or all candidate lines are generic summaries.",
      },
    },
  };

  if (candidates.length) {
    result.culprit = {
      type: "choice",
      instructions:
        "Select the one line that most directly states the concrete cause of the failed job. Prefer the underlying error over test summaries, command wrappers, ELIFECYCLE messages, and exit-code lines. If no line is truly causal, select the closest candidate; the separate answerability question controls abstention.",
      criteria: Object.fromEntries(
        candidates.map(({ index, text }) => [
          String(index),
          `Log line ${index}: ${text}`,
        ]),
      ),
    };
  }

  return result;
}

export function decide(answers, input) {
  const candidates = candidateLines(input);
  const answerable = answers?.has_culprit;
  const selected = answers?.culprit;

  if (!candidates.length || !answerable || !selected) {
    return { culprit_line: "abstain" };
  }

  if (typeof answerable.noul !== "number" || answerable.noul < 0.7) {
    return { culprit_line: "abstain" };
  }

  if (typeof selected.confidence !== "number" || selected.confidence < 0.6) {
    return { culprit_line: "abstain" };
  }

  const index = Number(selected.choice);
  if (
    !Number.isInteger(index) ||
    !candidates.some((candidate) => candidate.index === index)
  ) {
    return { culprit_line: "abstain" };
  }

  const probability = selected.probabilities?.[String(selected.choice)];
  if (typeof probability === "number" && probability < 0.4) {
    return { culprit_line: "abstain" };
  }

  return { culprit_line: index };
}
