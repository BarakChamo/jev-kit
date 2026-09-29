# Changelog

The plugin's release number (in `plugin/.claude-plugin/plugin.json`) and the skill-text versions the
evaluations measure (v3, v4.2, v4.3…) are separate. This table maps one to the other.

| release | skill text | date |
| --- | --- | --- |
| 0.3.0 | v4.4 | 2026-09-29 |
| 0.2.1 | v4.3 | 2026-09-28 |
| 0.2.0 | v4.3 | 2026-09-28 |
| 0.1.0 | v4.2 | 2026-09-28 |

A release that changes only docs keeps its number; any change to `plugin/` or `audit/` gets a new one.

## 0.3.0

Changes from a review of the kit by sixteen readers with different goals (product, engineering, QA, security,
ML research, operations, open source).

**Tools**
- `jev-run` calls TypeSafe's API (`TYPESAFE_API_KEY`, `jev-latest`, version pinning with `--model jev-1.13.0`) or
  Vercel AI Gateway (`AI_GATEWAY_API_KEY`), whichever key is set, or `--provider`.
- `jev-run` stops before sending anything when no key is set, and stops the whole run on a rejected key, instead
  of failing every case and suggesting an audit of the empty result.
- `jev-run --check --map` now builds every case's state and questions, validates them against the API's limits,
  and runs `decide()` on synthetic answers. It reports bad question types, oversized choices and states, crashes,
  decision fields that never match the gold, and labels no gold uses.
- `jev-run`: a real `--help`; unknown flags and bad values are errors; `--flag=value` works; per-request timeout
  (`--timeout`); up to six attempts with no sleep after the last; `--resume`; rows streamed to disk as they
  finish; `.jsonl` case files; `--max-failures`; one-line errors instead of stack traces; the gateway's billed
  cost and the provider on each row.
- `jev-audit` reports errored rows instead of silently dropping them, and says so when every row failed.
- `jev-audit diff` refuses two runs graded on different gold labels; `--gold suite.json` re-grades both.
  The README's diff example was one of these, and now shows the correct result.
- `jev-audit` fits one gate per question (it pooled them before), reports a 95% lower bound on each gate's
  precision, and says so when a question made no errors to fit on. `--holdout 0.5` fits on one part of the cases
  and reports on the rest.
- `jev-audit` adds the top label's calibration and AUROC, the numbers a gate depends on, and labels the pooled
  calibration table's limits.

**Skills (v4.4)**
- API section covers both routes, the documented limits, and logging the served version.
- Rule 9: option lists built from the input, with an "other" option; periods read as a number and a unit and
  converted with calendar arithmetic; month-end clamping; ambiguous date formats.
- Rule 12: the "long AND" row no longer reads as permission to ask a written policy's outcome.
- Rule 13: calibration claims corrected; gates fitted per question with `--holdout`.
- Rule 15: the detector's evidence (six cases per domain) and its limits stated; not a security control.
- Rule 16: what to do with more than 255 candidates.
- `jev-eval`: script paths that work for every install method; both keys; new flags.
- `jev-fit`: cost and latency figures reconciled (3–10× cheaper than a cheap LLM on short states, not 20–100×);
  a worked cost example; the fit condition stated once.
- Skill descriptions separate writing (`jev-questions`) from measuring (`jev-eval`).

**Examples**
- The renewal-notice map reads the notice period as a number and a unit, computes deadlines in calendar months,
  clamps month ends, and abstains on values outside its option lists. The suite gained 12 cases for month ends,
  short terms and notice in months or weeks: 42/42 on Jev. A recorded run ships beside it.
- The guardrail examples gate on a fitted probability, fail closed, cover exfiltration, and scope the detector.
- Every snippet in the use-cases page is a valid map fragment.

**Docs**
- New pages: [glossary](docs/glossary.md), [production](docs/production.md) (limits, safe calls, cascades,
  monitoring, data handling, security), [for decision-makers](docs/decision-makers.md),
  [other agents](docs/other-agents.md).
- Numbers reconciled across pages; paired results where maps failed; per-version rates on the hard task; the
  commit order of every pre-registration; the relabelling results that were left out.
- CONTRIBUTING, SECURITY, this changelog, and an index of `evals/`.

**Repository**
- Every agent-written map from rounds 2–4 ships as code. Eval scripts run from the kit's own paths.
- Contributor build (`npm run build`), offline checks (`npm run check`), CI, and SHA-256 checksums for the scripts.

## 0.2.1

Round 4 (a hard procurement task; the latest GLM, Qwen and DeepSeek); advice to use non-streaming requests through
the gateway; the study's models named.

## 0.2.0

Skill v4.3: never ask Jev for a written policy's outcome. `jev-audit` reads map runs. The uploaded-skill harness.

## 0.1.0

First public release: three skills (v4.2), `jev-run`, `jev-audit`, the example suites and the evaluations.
