function getCandidateIndices(lines) {
  if (lines.length <= 254) {
    return lines.map((_, i) => i);
  }

  const candidateSet = new Set();
  const pattern = /(?:error|fail|timed?\s*out|exception|fatal|panic|assert|cannot|unable|not found|refused|denied|killed|exit code|ELIFECYCLE|command failed|syntaxerror|typeerror|referenceerror|npm err|yarn error|×|❯|→)/i;

  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 2); j++) {
        candidateSet.add(j);
      }
    }
  }

  for (let i = Math.max(0, lines.length - 80); i < lines.length; i++) {
    candidateSet.add(i);
  }

  let candidates = Array.from(candidateSet).sort((a, b) => a - b);
  if (candidates.length > 254) {
    candidates = candidates.slice(candidates.length - 254);
  }
  return candidates;
}

export function buildState(input) {
  const lines = input.log_lines || [];
  return {
    repo: input.repo,
    job_name: input.job_name,
    branch: input.branch,
    log_lines: lines.map((text, index) => `[${index}] ${text}`)
  };
}

export function questions(input) {
  const lines = input.log_lines || [];
  const candidateIndices = getCandidateIndices(lines);

  const choiceCriteria = {};
  for (const idx of candidateIndices) {
    choiceCriteria[String(idx)] = lines[idx]?.trim().slice(0, 160) || `(line ${idx} empty)`;
  }
  choiceCriteria["none"] = "No explicit root cause line found or cause is ambiguous";

  return {
    has_specific_culprit: {
      type: "noul",
      instructions: "Does the log contain a specific line that explicitly states the root cause of failure (e.g. assertion failure, timeout, unhandled exception, syntax/type error), as opposed to only generic runner status (like 'exit code 1', 'ELIFECYCLE') or high-level test counts?",
      criteria: {
        true: "A specific log line explicitly states the root cause or failure reason.",
        false: "Only generic exit codes, boilerplate, summaries, or ambiguous messages are present."
      }
    },
    culprit_line: {
      type: "choice",
      instructions: "Select the single log line index that states the specific root cause of the failure. Do NOT select generic status lines (such as 'process completed with exit code 1'), runner boilerplate, or summary counts if a more specific cause line exists. If no single specific cause line is present, select 'none'.",
      criteria: choiceCriteria
    }
  };
}

export function decide(answers, input) {
  if (!answers || !answers.culprit_line) {
    return { culprit_line: "abstain" };
  }

  const { choice, confidence } = answers.culprit_line;
  const noulScore = answers.has_specific_culprit?.noul;

  if (choice === "none" || (noulScore !== undefined && noulScore < 0.5)) {
    return { culprit_line: "abstain" };
  }

  if (confidence !== undefined && confidence < 0.5) {
    return { culprit_line: "abstain" };
  }

  const lineIndex = Number(choice);
  const lines = input.log_lines || [];
  if (Number.isInteger(lineIndex) && lineIndex >= 0 && lineIndex < lines.length) {
    return { culprit_line: lineIndex };
  }

  return { culprit_line: "abstain" };
}
