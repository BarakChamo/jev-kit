function getCandidateIndices(logLines) {
  if (!Array.isArray(logLines) || logLines.length === 0) return [];

  if (logLines.length <= 254) {
    const indices = [];
    for (let i = 0; i < logLines.length; i++) {
      if (typeof logLines[i] === "string" && logLines[i].trim()) {
        indices.push(i);
      }
    }
    return indices;
  }

  const candidateSet = new Set();
  const errorRegex = /(error|fail|timed?[\s_-]*out|exception|panic|assert|cannot|not found|fatal|syntaxerror|typeerror|denied|killed)/i;

  // Include recent log tail
  let tailCount = 0;
  for (let i = logLines.length - 1; i >= 0 && tailCount < 80; i--) {
    if (logLines[i] && logLines[i].trim()) {
      candidateSet.add(i);
      tailCount++;
    }
  }

  // Scan backwards for lines matching failure indicators and their neighbors
  for (let i = logLines.length - 1; i >= 0 && candidateSet.size < 254; i--) {
    const line = logLines[i];
    if (typeof line === "string" && errorRegex.test(line)) {
      candidateSet.add(i);
      if (i > 0 && logLines[i - 1]?.trim()) candidateSet.add(i - 1);
      if (i + 1 < logLines.length && logLines[i + 1]?.trim()) candidateSet.add(i + 1);
    }
  }

  const candidates = Array.from(candidateSet).sort((a, b) => a - b);
  return candidates.length > 254 ? candidates.slice(candidates.length - 254) : candidates;
}

export function buildState(input) {
  const lines = Array.isArray(input?.log_lines) ? input.log_lines : [];
  return {
    repo: input?.repo,
    job_name: input?.job_name,
    log_lines: lines.length <= 400 ? lines : lines.slice(-400)
  };
}

export function questions(input) {
  const lines = Array.isArray(input?.log_lines) ? input.log_lines : [];
  const candidates = getCandidateIndices(lines);

  const criteria = {
    none: "No line states the failure cause, or the root cause is ambiguous/unknown"
  };

  for (const idx of candidates) {
    const line = lines[idx];
    criteria[String(idx)] = line.length > 180 ? line.slice(0, 180) + "..." : line;
  }

  return {
    culprit: {
      type: "choice",
      instructions:
        "Select the 0-based log line index stating the specific root cause of the CI failure (e.g. timeout, assertion failure, compilation/syntax error, missing resource). Avoid generic runner wrappers or exit-code summary lines (such as 'Process completed with exit code 1' or 'Test failed. See above'). If no line directly states the cause, choose 'none'.",
      criteria
    }
  };
}

export function decide(answers, input) {
  const result = answers?.culprit;
  if (!result || result.choice === "none" || (result.confidence ?? 0) < 0.65) {
    return { culprit_line: "abstain" };
  }

  const index = Number(result.choice);
  const lines = input?.log_lines;
  if (!Number.isInteger(index) || !Array.isArray(lines) || index < 0 || index >= lines.length) {
    return { culprit_line: "abstain" };
  }

  return { culprit_line: index };
}
