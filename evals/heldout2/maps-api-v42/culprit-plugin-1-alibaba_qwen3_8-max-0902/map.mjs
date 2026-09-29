const ABSTAIN = "abstain";
const GATE = 0.8;
const MAX_OPTIONS = 255;
const MAX_LINES = MAX_OPTIONS - 1;
const MAX_BLOCKS = MAX_OPTIONS - 1;
const MAX_SUPPORTED = MAX_LINES * MAX_BLOCKS;

const CONVENTION =
  "The culprit line is the single line in `log_lines` that states the concrete error that made the job fail: an assertion failure, exception, timeout message, missing command or file, compile error, or explicit fatal error. Generic wrappers such as 'Process completed with exit code 1', 'Test failed. See above', summary counts, group markers, successful steps, and repeated setup lines are not the culprit.";

function logLines(input) {
  let raw = input?.log_lines;
  if (typeof raw === "string") raw = raw.split("\n");
  if (!Array.isArray(raw)) return [];
  return raw.map((line) => (typeof line === "string" ? line : String(line ?? "")));
}

function label(line) {
  const text = String(line ?? "");
  if (!text.trim()) return "(empty line)";
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

function lineCriteria(lines, start, end) {
  const criteria = {};
  for (let i = start; i < end; i += 1) {
    criteria[String(i)] = label(lines[i]);
  }
  criteria[ABSTAIN] =
    "No single line in this set clearly states the specific cause, or more than one line states it; a person decides.";
  return criteria;
}

function blockRanges(n) {
  const blocks = [];
  for (let start = 0; start < n; start += MAX_LINES) {
    blocks.push([start, Math.min(n, start + MAX_LINES)]);
  }
  return blocks;
}

function probability(answer, labelValue) {
  if (!answer || typeof answer !== "object") return 0;

  const key = typeof labelValue === "number" ? String(labelValue) : labelValue;
  if (typeof key !== "string") return 0;

  const p = answer.probabilities?.[key];
  if (typeof p === "number" && Number.isFinite(p)) return p;

  const choice = typeof answer.choice === "number" ? String(answer.choice) : answer.choice;
  if (choice === key && typeof answer.confidence === "number" && Number.isFinite(answer.confidence)) {
    return answer.confidence;
  }

  return 0;
}

function toIndex(value, n) {
  const s = typeof value === "number" ? String(value) : value;
  if (typeof s !== "string" || !/^\d+$/.test(s)) return null;
  const i = Number(s);
  return Number.isSafeInteger(i) && i >= 0 && i < n ? i : null;
}

export function buildState(input) {
  return {
    log_lines: logLines(input),
    convention: CONVENTION
  };
}

export function questions(input) {
  const lines = logLines(input);
  const n = lines.length;

  if (n === 0) {
    return {
      culprit: {
        type: "choice",
        instructions:
          "Which line in `log_lines` states the specific cause of the CI failure?",
        criteria: {
          [ABSTAIN]: "There are no log lines; a person decides.",
          no_lines: "The `log_lines` array is empty."
        }
      }
    };
  }

  if (n <= MAX_LINES) {
    return {
      culprit: {
        type: "choice",
        instructions:
          "Which line in `log_lines` states the specific cause of the CI failure? Follow `convention`. Choose the 0-based array index of a line in `log_lines`. Do not choose a generic wrapper, summary count, group marker, successful line, or repeated setup line. Choose `abstain` when no single line clearly states the specific cause.",
        criteria: lineCriteria(lines, 0, n)
      }
    };
  }

  if (n > MAX_SUPPORTED) {
    return {
      culprit: {
        type: "choice",
        instructions:
          "Which line in `log_lines` states the specific cause of the CI failure?",
        criteria: {
          [ABSTAIN]: "The log is too long to map safely in one Jev choice; a person decides.",
          too_long: "The `log_lines` array has more lines than this map can ask about."
        }
      }
    };
  }

  const blocks = blockRanges(n);

  const blockCriteria = {
    [ABSTAIN]: "No block contains a line that states the specific cause; a person decides."
  };

  blocks.forEach(([start, end], i) => {
    blockCriteria[`block_${i}`] =
      `0-based line indices ${start} to ${end - 1}; starts with: ${label(lines[start])}.`;
  });

  const qs = {
    block: {
      type: "choice",
      instructions:
        "Which block of `log_lines` contains the single line that states the specific cause of the CI failure? Follow `convention`. Choose a block by its 0-based line range. Do not choose a block only because it contains generic wrappers, summaries, group markers, or successful lines. Choose `abstain` when no block contains the specific cause.",
      criteria: blockCriteria
    }
  };

  blocks.forEach(([start, end], i) => {
    qs[`line_block_${i}`] = {
      type: "choice",
      instructions:
        `Which line in \`log_lines\` indices ${start} to ${end - 1} states the specific cause of the CI failure? Follow \`convention\`. Choose the 0-based array index of a line in \`log_lines\`. Do not choose a generic wrapper, summary count, group marker, successful line, or repeated setup line. Choose \`abstain\` when no line in this range clearly states the specific cause.`,
      criteria: lineCriteria(lines, start, end)
    };
  });

  return qs;
}

export function decide(answers, input) {
  const lines = logLines(input);
  const n = lines.length;
  const abstain = { culprit_line: "abstain" };

  if (!answers || typeof answers !== "object" || n === 0) return abstain;

  if (n <= MAX_LINES) {
    const ans = answers.culprit;
    if (!ans || ans.choice === ABSTAIN) return abstain;

    const idx = toIndex(ans.choice, n);
    if (idx === null || probability(ans, ans.choice) < GATE) return abstain;

    return { culprit_line: idx };
  }

  if (n > MAX_SUPPORTED) return abstain;

  const blockAns = answers.block;
  if (!blockAns || blockAns.choice === ABSTAIN) return abstain;

  const match = /^block_(\d+)$/.exec(String(blockAns.choice));
  if (!match) return abstain;

  const blockIdx = Number(match[1]);
  if (probability(blockAns, blockAns.choice) < GATE) return abstain;

  const lineAns = answers[`line_block_${blockIdx}`];
  if (!lineAns || lineAns.choice === ABSTAIN) return abstain;

  const idx = toIndex(lineAns.choice, n);
  if (idx === null || probability(lineAns, lineAns.choice) < GATE) return abstain;

  const range = blockRanges(n)[blockIdx];
  if (!range || idx < range[0] || idx >= range[1]) return abstain;

  return { culprit_line: idx };
}
