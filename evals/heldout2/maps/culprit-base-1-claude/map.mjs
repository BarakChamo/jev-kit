// Jev mapping for: "point developers at the single log line that states the cause of a CI failure"

const CULPRIT_PATTERNS = [
  /##\[error\]/,
  /\berror\b/i,
  /\bfail(ed|ure)?\b/i,
  /\bexception\b/i,
  /\btraceback\b/i,
  /timed?\s*out/i,
  /\bassert(ion)?\b/i,
  /\bpanic\b/i,
  /\bfatal\b/i,
  /permission denied/i,
  /connection refused/i,
  /not found/i,
  /ENOENT|EACCES|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/,
  /[✕×✗]/,
  /segmentation fault/i,
  /out of memory|oom/i,
];

const MAX_CHOICE_OPTIONS = 255;
const FALLBACK_TAIL_LINES = 20;
const ABSTAIN_AMBIGUOUS_THRESHOLD = 0.5;
const ABSTAIN_CONFIDENCE_THRESHOLD = 0.4;

function findCandidateIndices(logLines) {
  const candidates = [];
  for (let i = 0; i < logLines.length; i++) {
    if (CULPRIT_PATTERNS.some((re) => re.test(logLines[i]))) {
      candidates.push(i);
    }
  }
  if (candidates.length === 0) {
    const start = Math.max(0, logLines.length - FALLBACK_TAIL_LINES);
    for (let i = start; i < logLines.length; i++) candidates.push(i);
  }
  if (candidates.length > MAX_CHOICE_OPTIONS) {
    return candidates.slice(-MAX_CHOICE_OPTIONS);
  }
  return candidates;
}

export function buildState(input) {
  return {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    job_name: input.job_name,
    attempt_number: input.attempt_number,
    max_attempts: input.max_attempts,
    log_lines: input.log_lines.map((text, i) => `[${i}] ${text}`),
  };
}

export function questions(input) {
  const candidates = findCandidateIndices(input.log_lines);
  if (candidates.length === 0) return {};

  const options = {};
  for (const i of candidates) {
    options[String(i)] = input.log_lines[i].slice(0, 300);
  }

  return {
    culprit: {
      type: "choice",
      instructions:
        `The state contains the full log (each line prefixed "[index] ") for job "${input.job_name}" ` +
        `in ${input.repo}@${input.branch} (attempt ${input.attempt_number}/${input.max_attempts}), which failed. ` +
        `The options below are candidate lines by their index. Pick the SINGLE line whose text most directly ` +
        `and specifically states the root cause of the failure (an assertion message, exception, timeout, ` +
        `compiler/linker error, or specific tool error) rather than generic boilerplate like ` +
        `"Process completed with exit code 1" or a pass/fail summary count, unless no more specific cause line exists.`,
      criteria: options,
    },
    ambiguous: {
      type: "noul",
      instructions:
        `Using the same log, decide whether this failure's root cause is genuinely ambiguous or unsafe to ` +
        `reduce to one line: e.g. multiple independent, unrelated failures with different causes, an ` +
        `infra/flake issue with no clear diagnostic message, or a log that is truncated before the real cause appears.`,
      criteria: {
        true: "The cause is unclear, spans multiple unrelated issues, or no single line clearly states it — a human should review.",
        false: "There is one clear line that states the specific root cause of this failure.",
      },
    },
  };
}

export function decide(answers, input) {
  if (!answers || !answers.culprit) return { culprit_line: "abstain" };

  const ambiguous = answers.ambiguous;
  if (ambiguous && typeof ambiguous.noul === "number" && ambiguous.noul >= ABSTAIN_AMBIGUOUS_THRESHOLD) {
    return { culprit_line: "abstain" };
  }

  const choice = answers.culprit;
  if (choice.choice == null) return { culprit_line: "abstain" };

  const confidence = typeof choice.confidence === "number" ? choice.confidence : 0;
  if (confidence < ABSTAIN_CONFIDENCE_THRESHOLD) return { culprit_line: "abstain" };

  const idx = Number(choice.choice);
  if (!Number.isInteger(idx) || idx < 0 || idx >= input.log_lines.length) {
    return { culprit_line: "abstain" };
  }

  return { culprit_line: idx };
}
