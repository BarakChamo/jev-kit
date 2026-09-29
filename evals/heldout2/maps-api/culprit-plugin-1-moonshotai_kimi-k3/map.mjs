// Point at the single log line that states the cause of a CI failure.
// One `choice` over every line (never pre-filtered), with a rubric naming the
// generic wrapper lines to skip, a "none of these" abstain option, and a gate
// on the probability of the chosen line. Logs over 254 lines are split across
// several chunk questions (API limit is 255 options); all lines are still sent.

const CHUNK = 250;   // lines per choice question (250 lines + "none" <= 255 options)
const NONE = "none"; // option meaning: no listed line states the specific cause
const ACT = 0.8;     // act only when the chosen line's probability clears this

function instruction(input, range) {
  let s =
    `The CI job "${input.job_name}" of ${input.repo} on ${input.runner} failed; ` +
    "its complete log is in `lines`, an array indexed from 0. Which line states the " +
    "specific cause of the failure: the error message, exception, failed assertion, " +
    "or the failing command's own output saying what went wrong? Not a generic " +
    'wrapper such as "Process completed with exit code 1" or "ELIFECYCLE ... ' +
    'failed", not a summary count such as "Tests 1 failed | 311 passed", not a ' +
    "stack frame, progress or timing line.";
  if (range) {
    s += ` Only lines ${range[0]} through ${range[1]} appear as options here; the cause may lie in lines outside this range.`;
  }
  return s;
}

export function buildState(input) {
  return {
    repo: input.repo,
    branch: input.branch,
    runner: input.runner,
    job_name: input.job_name,
    attempt: `${input.attempt_number} of ${input.max_attempts}`,
    lines: input.log_lines ?? [],
  };
}

export function questions(input) {
  const lines = input.log_lines ?? [];
  const qs = {};
  const nChunks = Math.max(1, Math.ceil(lines.length / CHUNK));
  for (let k = 0; k < nChunks; k++) {
    const start = k * CHUNK;
    const slice = lines.slice(start, start + CHUNK);
    qs[nChunks === 1 ? "culprit" : `culprit_${k}`] = {
      type: "choice",
      instructions: instruction(input, nChunks === 1 ? null : [start, start + slice.length - 1]),
      criteria: {
        ...Object.fromEntries(slice.map((text, i) => [String(start + i), text])),
        [NONE]: "none of the listed lines states the specific cause of the failure",
      },
    };
  }
  return qs;
}

export function decide(answers, input) {
  const n = input.log_lines?.length ?? 0;
  let best = -1;
  let bestP = 0;
  for (const [id, a] of Object.entries(answers ?? {})) {
    if (!id.startsWith("culprit") || a?.choice == null || a.choice === NONE) continue;
    const idx = Number(a.choice);
    const p = a.probabilities?.[a.choice] ?? 0;
    if (Number.isInteger(idx) && idx >= 0 && idx < n && p > bestP) {
      best = idx;
      bestP = p;
    }
  }
  // Gate on the probability of the line we would act on; doubt never relaxes
  // into a guess — it goes to a person.
  return best >= 0 && bestP >= ACT ? best : "abstain";
}
