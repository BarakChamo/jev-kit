// Jev map: point at the single log line that states the cause of a CI failure.

const MAX_OPTIONS = 254; // leave one slot for the "unclear" option (API cap is 255)
const GATE = 0.6; // minimum probability on the chosen line before we act on it

const RUBRIC = `You are given "job", context about a CI job that failed, and "log", an array of
{index, text} objects — every line of that job's log, in order, with its original position in "index".

Pick the single line whose "index" states the concrete, specific cause of the failure: the actual
error message, exception, assertion failure detail, or explicit reason a tool gave for failing
(e.g. "Test timed out in 5000ms.", "AssertionError: expected 2 to equal 3", "Cannot find module 'x'",
"connect ECONNREFUSED 127.0.0.1:5432").

Do NOT pick a generic wrapper or summary line that only says something failed without saying why,
such as: "##[error]Process completed with exit code 1.", " ELIFECYCLE  Test failed...", a
"Test Files ... failed" / "Tests ... failed" count summary, a bare non-zero exit code line, or a
"##[group]"/"##[endgroup]" marker. If a test name line and a message line are adjacent, prefer the
line that states *why* it failed over the line that only names *which* test failed.
If no single line clearly states a specific cause — the log only shows generic failure/exit
indicators, is truncated before any detail, or several equally generic lines tie — answer "unclear".`;

function truncate(text, n = 220) {
  return text.length > n ? text.slice(0, n) + "…" : text;
}

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

export function buildState(input) {
  return {
    job: {
      repo: input.repo,
      branch: input.branch,
      runner: input.runner,
      job_name: input.job_name,
      attempt_number: input.attempt_number,
      max_attempts: input.max_attempts,
    },
    log: input.log_lines.map((text, index) => ({ index, text })),
  };
}

function chunksFor(input) {
  const log = input.log_lines.map((text, index) => ({ index, text }));
  return chunk(log, MAX_OPTIONS);
}

function criteriaFor(linesChunk) {
  const criteria = {
    unclear:
      "no single line clearly states a specific cause; only generic failure/exit indicators, truncation, or tied generic lines",
  };
  for (const { index, text } of linesChunk) {
    criteria[String(index)] = truncate(text);
  }
  return criteria;
}

export function questions(input) {
  const chunks = chunksFor(input);
  const qs = {};
  chunks.forEach((linesChunk, i) => {
    qs[`culprit_${i}`] = {
      type: "choice",
      instructions: RUBRIC,
      criteria: criteriaFor(linesChunk),
    };
  });
  return qs;
}

export function decide(answers, input) {
  const chunks = chunksFor(input);
  let best = null; // { line, prob }

  chunks.forEach((_linesChunk, i) => {
    const answer = answers[`culprit_${i}`];
    if (!answer || answer.choice === "unclear") return;
    const line = Number(answer.choice);
    const prob = answer.probabilities?.[answer.choice] ?? answer.confidence ?? 0;
    if (!best || prob > best.prob) best = { line, prob };
  });

  if (!best || best.prob < GATE) return { culprit_line: "abstain" };
  return { culprit_line: best.line };
}
