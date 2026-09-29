const MAX_LINES = 254; // 254 lines + the "ambiguous" option = 255, the API cap

export function buildState(input) {
  const all = Array.isArray(input?.log_lines) ? input.log_lines : [];
  const truncated = all.length > MAX_LINES;
  const log_lines = truncated ? all.slice(-MAX_LINES) : all;
  return {
    repo: input?.repo,
    branch: input?.branch,
    runner: input?.runner,
    job_name: input?.job_name,
    attempt_number: input?.attempt_number,
    max_attempts: input?.max_attempts,
    log_lines,
    log_convention:
      "Each entry of `log_lines` is one stdout/stderr line from the CI runner, in order. " +
      "The cause of a failure is the error, exception, or failed-assertion line — in a " +
      "stack trace, the first informative line, not the frames below. NOT the cause: " +
      "`##[group]`/`##[endgroup]`/`ELIFECYCLE` wrappers, the trailing " +
      "`Process completed with exit code 1`, summary counts `Test Files`/`Tests`/`Duration`, " +
      "install counters `Packages:`/`Progress:`, and the `>` lines that just restate the " +
      "test command." +
      (truncated
        ? ` Only the last ${MAX_LINES} lines are kept; index 0 is the first of them.`
        : ` Index 0 is the first line, index ${all.length - 1} is the last.`)
  };
}

export function questions(input) {
  const log_lines = (Array.isArray(input?.log_lines) ? input.log_lines : []).slice(-MAX_LINES);
  return {
    culprit_line: {
      type: "choice",
      instructions:
        "From `log_lines`, pick the single line that states the cause of this CI failure " +
        "(job `job_name` on runner `runner`, attempt `attempt_number` of `max_attempts`, " +
        "branch `branch` in repo `repo`). Apply the convention in `log_convention`: pick " +
        "the error / exception / failed-assertion line — in a stack trace the first " +
        "informative line, not the frames below it — and skip everything listed there as " +
        "NOT the cause. Also skip the advisory hint printed directly under the error. " +
        "When no single line cleanly states the cause, choose `ambiguous`.",
      criteria: {
        ...Object.fromEntries(log_lines.map((t, i) => [String(i), String(t)])),
        ambiguous: "no single line cleanly states the cause; a person should look at the log"
      }
    }
  };
}

export function decide(answers, input) {
  const a = answers?.culprit_line;
  if (!a || typeof a.choice !== "string") return { culprit_line: "abstain" };
  if (a.choice === "ambiguous") return { culprit_line: "abstain" };
  const p = a.probabilities?.[a.choice] ?? 0;
  if (p < 0.8) return { culprit_line: "abstain" };
  const idx = Number(a.choice);
  const original = Array.isArray(input?.log_lines) ? input.log_lines : [];
  const kept = original.slice(-MAX_LINES);
  if (!Number.isInteger(idx) || idx < 0 || idx >= kept.length) return { culprit_line: "abstain" };
  return { culprit_line: idx + Math.max(0, original.length - MAX_LINES) };
}
