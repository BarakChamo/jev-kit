const ACT = 0.8;
const CHUNK_SIZE = 254;
const MAX_RANGES = 254;

const CONVENTION =
  "A culprit line states the concrete reason the CI job failed: an assertion or expectation failure, exception, timeout message, compiler error, missing dependency, permission denial, or fatal tool error. It is not a group marker, command echo, passing test, summary count, lifecycle note, or generic exit-code wrapper such as '##[error]Process completed with exit code 1.' or 'ELIFECYCLE Test failed'. When a failed-test line and a nearby reason line both appear, the reason line is the culprit. Choose the earliest line that states the cause.";

function linesFrom(input) {
  return input && Array.isArray(input.log_lines) ? input.log_lines : [];
}

function textOf(line) {
  if (typeof line === "string") return line;
  try {
    const s = JSON.stringify(line);
    return typeof s === "string" ? s : String(line);
  } catch {
    return String(line);
  }
}

function truncate(text, max = 140) {
  const s = textOf(text);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function rangesFor(count) {
  const ranges = [];
  for (let start = 0; start < count; start += CHUNK_SIZE) {
    ranges.push({ start, end: Math.min(count, start + CHUNK_SIZE) });
  }
  return ranges;
}

function lineCriteria(lines, start, end) {
  const criteria = {
    none: "No line in this range states the specific cause.",
  };

  for (let i = start; i < end; i += 1) {
    const s = truncate(lines[i]);
    criteria[String(i)] = s === "" ? "(empty line)" : s;
  }

  return criteria;
}

function lineInstructions(start, end) {
  const range =
    end - start === 1
      ? `index ${start}`
      : `indices ${start} through ${end - 1}`;

  return `Using \`culprit_convention\`, select the zero-based index among ${range} of \`log_lines\` that states the specific cause of the CI failure. Select none when no line in that range states the specific cause.`;
}

function probabilityOf(answer, choice) {
  if (!answer || !answer.probabilities || choice == null) return 0;
  return answer.probabilities[choice] ?? 0;
}

export function buildState(input) {
  return {
    log_lines: linesFrom(input),
    culprit_convention: CONVENTION,
  };
}

export function questions(input) {
  const lines = linesFrom(input).map(textOf);

  if (lines.length === 0) {
    return {
      culprit: {
        type: "choice",
        instructions: "Select none because `log_lines` is empty.",
        criteria: {
          none: "No log lines are present.",
        },
      },
    };
  }

  const ranges = rangesFor(lines.length);

  if (ranges.length > MAX_RANGES) {
    return {
      unsupported: {
        type: "choice",
        instructions:
          "Select none because `log_lines` is too long to ask about every candidate range within the choice limit.",
        criteria: {
          none: "A person should review this log.",
        },
      },
    };
  }

  if (ranges.length === 1) {
    return {
      culprit: {
        type: "choice",
        instructions: lineInstructions(0, lines.length),
        criteria: lineCriteria(lines, 0, lines.length),
      },
    };
  }

  const qs = {};

  ranges.forEach((r, i) => {
    qs[`culprit_${i}`] = {
      type: "choice",
      instructions: lineInstructions(r.start, r.end),
      criteria: lineCriteria(lines, r.start, r.end),
    };
  });

  const chunkCriteria = {
    none: "No range contains a line stating the specific cause.",
  };

  ranges.forEach((r, i) => {
    chunkCriteria[String(i)] =
      `range ${i}: log_lines indices ${r.start} through ${r.end - 1}`;
  });

  qs.chunk = {
    type: "choice",
    instructions:
      "Using `culprit_convention`, select the range of `log_lines` that contains the line stating the specific cause of the CI failure. Select none when no range contains such a line.",
    criteria: chunkCriteria,
  };

  return qs;
}

export function decide(answers, input) {
  const lines = linesFrom(input);

  if (lines.length === 0) {
    return { culprit_line: "abstain" };
  }

  const ranges = rangesFor(lines.length);

  if (ranges.length === 0 || ranges.length > MAX_RANGES) {
    return { culprit_line: "abstain" };
  }

  if (ranges.length === 1) {
    const ans = answers && (answers.culprit ?? answers.culprit_0);

    if (!ans || ans.choice == null || ans.choice === "none") {
      return { culprit_line: "abstain" };
    }

    const idx = Number(ans.choice);
    const p = probabilityOf(ans, ans.choice);

    if (Number.isInteger(idx) && idx >= 0 && idx < lines.length && p >= ACT) {
      return { culprit_line: idx };
    }

    return { culprit_line: "abstain" };
  }

  const candidates = [];

  ranges.forEach((range, ci) => {
    const ans = answers && answers[`culprit_${ci}`];

    if (!ans || ans.choice == null || ans.choice === "none") return;

    const idx = Number(ans.choice);
    const p = probabilityOf(ans, ans.choice);

    if (
      !Number.isInteger(idx) ||
      idx < range.start ||
      idx >= range.end ||
      p < ACT
    ) {
      return;
    }

    candidates.push({ idx, ci });
  });

  const chunkAns = answers && answers.chunk;
  let chunkChoice = null;

  if (chunkAns && chunkAns.choice != null) {
    const p = probabilityOf(chunkAns, chunkAns.choice);

    if (chunkAns.choice === "none") {
      if (p >= ACT) {
        return { culprit_line: "abstain" };
      }
    } else {
      const ci = Number(chunkAns.choice);

      if (
        Number.isInteger(ci) &&
        ci >= 0 &&
        ci < ranges.length &&
        p >= ACT
      ) {
        chunkChoice = ci;
      }
    }
  }

  if (candidates.length === 1) {
    const cand = candidates[0];

    if (chunkChoice !== null && chunkChoice !== cand.ci) {
      return { culprit_line: "abstain" };
    }

    return { culprit_line: cand.idx };
  }

  if (candidates.length > 1 && chunkChoice !== null) {
    const matches = candidates.filter((c) => c.ci === chunkChoice);

    if (matches.length === 1) {
      return { culprit_line: matches[0].idx };
    }
  }

  return { culprit_line: "abstain" };
}
