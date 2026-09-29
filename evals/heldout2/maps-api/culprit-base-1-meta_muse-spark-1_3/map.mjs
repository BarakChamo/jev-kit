const MAX = 30;
const LIM = 180;

function clean(s) {
  s = String(s ?? "").replace(/\s+/g, " ").trim();
  if (s.length > LIM) s = s.slice(0, LIM - 1) + "…";
  return s;
}

function sline(t, i, n) {
  let s = 0;
  if (t.includes("##[error]")) {
    if (/process completed with exit code/i.test(t)) s += 0.5;
    else s += 4;
  }
  if (/fail|error|exception|traceback|panic|fatal|timeout|timed out|not found|no such|undefined|cannot|can't|could not|denied|forbidden|unauthorized|out of memory|segmentation|assertion|expected|received|missing|broken|invalid|elifecycle/i.test(t)) s += 3;
  if (/[×✗✘❌]/.test(t)) s += 3;
  else if (/→|did not|was not|but got/i.test(t)) s += 1.5;
  if (/exit code/i.test(t)) s += 0.5;
  if (/##\[warning\]/i.test(t)) s += 0.5;
  if (/✓|✔|passed|success|up to date|reused|done|resolved/i.test(t)) s -= 3;
  if (/##\[group\]|##\[endgroup\]|syncing repository|lockfile|packages:/i.test(t)) s -= 3;
  if (/^(progress|downloading|installing)/i.test(t)) s -= 2;
  if (/test files|tests\s+\d+ (failed|passed)/i.test(t)) s -= 1;
  if (!t) s -= 5;
  if (i >= n - 15) s += 0.8;
  return s;
}

function candList(log_lines) {
  const n = log_lines.length;
  if (n === 0) return [];
  const norm = log_lines.map((v, i) => ({ n: i, t: clean(v) }));
  const byText = new Map();
  for (const x of norm) {
    if (!x.t) continue;
    byText.set(x.t, x);
  }
  const uniq = [...byText.values()].sort((a, b) => a.n - b.n);
  if (uniq.length <= 50) return uniq.slice(0, 50);
  const scored = uniq.map(x => ({ ...x, s: sline(x.t, x.n, n) }));
  let good = scored.filter(x => x.s >= 2.5);
  if (good.length === 0) return uniq.slice(-25);
  good.sort((a, b) => b.s - a.s || b.n - a.n);
  good = good.slice(0, MAX);
  good.sort((a, b) => a.n - b.n);
  return good.map(({ n, t }) => ({ n, t }));
}

export function buildState(input) {
  const log = Array.isArray(input?.log_lines) ? input.log_lines : [];
  const cs = candList(log);
  return {
    job: input?.job_name ?? "",
    runner: input?.runner ?? "",
    lines: cs.map(c => ({ n: c.n, t: c.t }))
  };
}

export function questions(input) {
  const log = Array.isArray(input?.log_lines) ? input.log_lines : [];
  const cs = candList(log);
  const crit = {};
  for (const c of cs) crit[String(c.n)] = `log line n=${c.n}`;
  crit["none"] = "no line states a specific cause";
  return {
    culprit: {
      type: "choice",
      instructions: "Failed CI job. From state.lines (n=orig index, t=text) pick the n that best states WHY it failed. Prefer specific error/timeout/assertion over generic exit-code/ELIFECYCLE/summary counts. Ignore passing/setup lines. Duplicates: pick last. If no specific cause, pick none.",
      criteria: crit
    },
    valid: {
      type: "noul",
      instructions: "Does state.lines contain a specific cause (not only generic exit/summary)?",
      criteria: {
        true: "a line gives specific error/timeout/assertion causing failure",
        false: "no specific cause, only generic wrapper/summary or passing lines"
      }
    }
  };
}

export function decide(answers, input) {
  const log = Array.isArray(input?.log_lines) ? input.log_lines : [];
  const cs = candList(log);
  if (cs.length === 0) return { culprit_line: "abstain" };
  const set = new Set(cs.map(c => c.n));
  const q = answers?.culprit;
  const raw = q?.choice;
  if (raw == null) return { culprit_line: "abstain" };
  const s = String(raw);
  if (s === "none") return { culprit_line: "abstain" };
  const idx = Number(s);
  if (!Number.isInteger(idx) || idx < 0 || idx >= log.length) return { culprit_line: "abstain" };
  if (!set.has(idx)) return { culprit_line: "abstain" };
  const conf = typeof q?.confidence === "number" ? q.confidence : null;
  if (conf != null && conf < 0.55) return { culprit_line: "abstain" };
  const probs = q?.probabilities;
  if (probs && typeof probs === "object") {
    const vs = Object.values(probs).filter(v => typeof v === "number").sort((a, b) => b - a);
    if (vs.length > 0 && vs[0] < 0.35) return { culprit_line: "abstain" };
    if (vs.length > 1 && vs[0] - vs[1] < 0.08) return { culprit_line: "abstain" };
  }
  const nv = answers?.valid?.noul;
  if (typeof nv === "number" && nv < 0.5) return { culprit_line: "abstain" };
  return { culprit_line: idx };
}
