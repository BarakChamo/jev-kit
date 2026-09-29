const GATE = 0.7;
const MAX_CHOICES = 255;
const CHUNK_SIZE = MAX_CHOICES - 1;

const CAUSE =
  "the actual error, exception, failed assertion, timeout, compiler/lint error, missing dependency, or fatal command error";
const PREFER =
  "Prefer the underlying reason over a header that only names the failed test/command. If the same cause appears more than once, choose the latest occurrence.";
const SKIP =
  "Do not choose group markers, successful output, progress, summary counts, 'See above' lines, 'ELIFECYCLE' lines, or generic wrappers such as '##[error]Process completed with exit code 1.'.";

function linesFrom(input) {
  return Array.isArray(input?.log_lines)
    ? input.log_lines.map((line) => String(line))
    : [];
}

function chunkCount(n) {
  return Math.ceil(n / CHUNK_SIZE);
}

function chunkRange(c, n) {
  const start = c * CHUNK_SIZE;
  const end = Math.min(n - 1, start + CHUNK_SIZE - 1);
  return { start, end };
}

function lineQuestion(lines, start, end) {
  const criteria = {
    none: "No line in this range states the specific cause of the failure.",
  };

  for (let i = start; i <= end; i += 1) {
    criteria[String(i)] = lines[i];
  }

  return {
    type: "choice",
    instructions:
      "Which line of `log_lines` between indices " + start + " and " + end +
      " inclusive states the specific cause of the failure? Choose the line with " +
      CAUSE + ". " + PREFER + " " + SKIP +
      " If no line in this range states a specific cause, choose none.",
    criteria,
  };
}

function prob(answer, label) {
  return answer?.probabilities?.[label] ?? 0;
}

function chooseLine(answer, lines) {
  if (!answer || answer.choice === "none" || answer.choice === "abstain") {
    return null;
  }

  const p = prob(answer, answer.choice);
  const idx = Number(answer.choice);

  if (!Number.isInteger(idx) || idx < 0 || idx >= lines.length || p < GATE) {
    return null;
  }

  return { idx, p };
}

export function buildState(input) {
  return { log_lines: linesFrom(input) };
}

export function questions(input) {
  const lines = linesFrom(input);

  if (lines.length + 1 <= MAX_CHOICES) {
    const criteria = {
      abstain: "No line states the specific cause of the failure.",
    };

    lines.forEach((line, i) => {
      criteria[String(i)] = line;
    });

    return {
      culprit: {
        type: "choice",
        instructions:
          "Which line of `log_lines` states the specific cause of the failure? Choose the line with " +
          CAUSE + ". " + PREFER + " " + SKIP +
          " If no line states a specific cause, choose abstain.",
        criteria,
      },
    };
  }

  const n = lines.length;
  const chunks = chunkCount(n);
  const q = {};

  if (chunks + 1 <= MAX_CHOICES) {
    const criteria = {
      abstain: "No range contains a line that states the specific cause of the failure.",
    };

    for (let c = 0; c < chunks; c += 1) {
      const { start, end } = chunkRange(c, n);
      criteria["chunk_" + c] = "log_lines indices " + start + " through " + end;
    }

    q.chunk = {
      type: "choice",
      instructions:
        "Which range of `log_lines` contains the line that states the specific cause of the failure? A cause line has " +
        CAUSE + ". If no range contains such a line, choose abstain.",
      criteria,
    };
  }

  for (let c = 0; c < chunks; c += 1) {
    const { start, end } = chunkRange(c, n);
    q["line_" + c] = lineQuestion(lines, start, end);
  }

  return q;
}

export function decide(answers, input) {
  const lines = linesFrom(input);

  if (!answers || lines.length === 0) {
    return { culprit_line: "abstain" };
  }

  const single = answers.culprit;
  if (single) {
    const candidate = chooseLine(single, lines);
    return candidate
      ? { culprit_line: candidate.idx }
      : { culprit_line: "abstain" };
  }

  const chunkAnswer = answers.chunk;
  if (chunkAnswer) {
    if (
      chunkAnswer.choice === "abstain" ||
      prob(chunkAnswer, chunkAnswer.choice) < GATE
    ) {
      return { culprit_line: "abstain" };
    }

    const match = /^chunk_(\d+)$/.exec(String(chunkAnswer.choice));
    if (!match) {
      return { culprit_line: "abstain" };
    }

    const candidate = chooseLine(answers["line_" + match[1]], lines);
    return candidate
      ? { culprit_line: candidate.idx }
      : { culprit_line: "abstain" };
  }

  let best = null;

  for (const [key, answer] of Object.entries(answers)) {
    if (!key.startsWith("line_")) continue;

    const candidate = chooseLine(answer, lines);
    if (candidate && (!best || candidate.p > best.p)) {
      best = candidate;
    }
  }

  return best
    ? { culprit_line: best.idx }
    : { culprit_line: "abstain" };
}
