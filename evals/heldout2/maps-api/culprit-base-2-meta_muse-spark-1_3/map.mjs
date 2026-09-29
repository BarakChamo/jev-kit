function trunc(s, n) {
  if (typeof s !== "string") s = String(s ?? "");
  return s.length > n ? s.slice(0, n) : s;
}

function getCands(log) {
  if (!Array.isArray(log)) return [];
  const MAX = 60, ML = 250;
  const strong = /##\[error\]|ELIFECYCLE|→|×|❯|FAIL|failed to|error:|Error:|ERROR|Exception|Traceback|panic:|fatal:|timed?\s?out|timeout|assert|expected|not found|ENOENT|EACCES|denied|permission|exit code [1-9]|cannot|can't|could not|unable to|missing|invalid/i;
  const weak = /fail|error|warn|exception/i;
  const out = [];
  for (let i = 0; i < log.length; i++) {
    let r = typeof log[i] === "string" ? log[i] : String(log[i] ?? "");
    const t = r.trim();
    if (!t) continue;
    if (/^##\[(group|endgroup|command|section)\]/i.test(t)) continue;
    const sStrong = strong.test(r);
    if (/^[✓✔✅]/u.test(t) && !sStrong) continue;
    if (/^(Packages:|Progress:|Lockfile|Syncing repository:|RUN\s+v\d+\s)/i.test(t) && !sStrong) continue;
    if (/^>\s*(webapp@|vitest run|pnpm|npm|yarn|node)\b/i.test(t) && !sStrong) continue;
    let sc = 0;
    if (sStrong) sc = 2;
    else if (weak.test(r)) sc = 1;
    else continue;
    out.push({ i, t: r.length > ML ? r.slice(0, ML) : r, score: sc });
  }
  if (out.length === 0) {
    const tail = [];
    for (let i = Math.max(0, log.length - 10); i < log.length; i++) {
      let r = typeof log[i] === "string" ? log[i] : String(log[i] ?? "");
      if (!r.trim()) continue;
      if (/^##\[(group|endgroup)\]/i.test(r.trim())) continue;
      tail.push({ i, t: r.length > ML ? r.slice(0, ML) : r, score: 0 });
    }
    return tail;
  }
  if (out.length > MAX) {
    const st = out.filter((o) => o.score >= 2);
    const wk = out.filter((o) => o.score < 2);
    let kept;
    if (st.length >= MAX) kept = st.slice(-MAX);
    else kept = st.concat(wk.slice(-(MAX - st.length)));
    kept.sort((a, b) => a.i - b.i);
    return kept;
  }
  return out;
}

function isGeneric(t) {
  return /process completed with exit code|test files.*(failed|passed)|tests\s+\d+ failed|duration\s+[\d.]+s|elifecycle.*see above/i.test(t);
}

export function buildState(input) {
  const log = input?.log_lines ?? [];
  const c = getCands(log);
  return {
    job: input?.job_name ?? "",
    total: Array.isArray(log) ? log.length : 0,
    cands: c.map((o) => [o.i, o.t]),
  };
}

export function questions(input) {
  const c = getCands(input?.log_lines ?? []);
  const criteria = {};
  for (const o of c) criteria[String(o.i)] = trunc(o.t, 180);
  criteria["none"] = "No single line clearly states the cause (only generic exit/summary, truncated, empty, or multiple unrelated errors)";
  return {
    clear: {
      type: "noul",
      instructions: "Does this failed CI log contain one single line stating the failure cause? True only if a specific error line exists.",
      criteria: {
        true: "One specific line states the cause (assertion, timeout, error, exception)",
        false: "No single clear cause; generic exit only, truncated, empty, or multiple causes",
      },
    },
    culprit: {
      type: "choice",
      instructions: "Pick the single log line that states the failure cause. Prefer specific error (timeout, assertion, exception, error) over summary counts and exit-code lines. If no clear single cause pick none.",
      criteria,
    },
  };
}

export function decide(answers, input) {
  const no = () => ({ culprit_line: "abstain" });
  try {
    const log = input?.log_lines;
    if (!answers || !Array.isArray(log)) return no();
    const cl = answers.clear;
    const cu = answers.culprit;
    if (!cl || typeof cl.noul !== "number") return no();
    if (!cu || typeof cu.choice !== "string") return no();
    if (cl.noul < 0.6) return no();
    if (cu.choice === "none") return no();
    if (typeof cu.confidence === "number" && cu.confidence < 0.6) return no();
    const idx = Number(cu.choice);
    if (!Number.isInteger(idx) || idx < 0 || idx >= log.length) return no();
    let raw = typeof log[idx] === "string" ? log[idx] : String(log[idx] ?? "");
    const t = raw.trim();
    if (!t) return no();
    if (/^[✓✔✅]/u.test(t)) return no();
    if (/^##\[(group|endgroup|command)\]/i.test(t)) return no();
    if (isGeneric(t)) return no();
    return { culprit_line: idx };
  } catch (e) {
    return { culprit_line: "abstain" };
  }
}
