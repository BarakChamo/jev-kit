---
name: jev-eval
description: Build, run and audit a labelled eval suite for Jev (TypeSafe System One) question maps — case design, the confidently-wrong audit, calibration, gate fitting, pad tests, derive-vs-ask, whole-map grading, before/after diffs and comparator re-runs. Use when evaluating or benchmarking Jev, choosing a confidence threshold, checking whether a question change helped, comparing Jev to an LLM, or before shipping any Jev-backed decision.
---

# Evaluating Jev question maps

> **Measure, don't review.** 37 agent-written maps were graded both ways. Maps that looked right on
> review were not reliably more accurate on Jev. Accuracy turned on details no review looked at:
> pre-filters, compound questions, and where the arithmetic happened.

## The tools

Both are plain Node 18+, with nothing to install. They live in `scripts/`, i.e.
`"${CLAUDE_PLUGIN_ROOT}/skills/jev-eval/scripts/"`.

| tool | what it does | needs a key? |
| --- | --- | --- |
| `jev-run.mjs` | runs a suite through Jev and writes one JSONL row per case | yes, `AI_GATEWAY_API_KEY` (not for `--check`) |
| `jev-audit.mjs` | confidently-wrong queue, calibration, top-2 recall, a fitted gate. On a `--map` run: wrong decisions with the weakest answer behind each, the questions that keep being the weak link, and a gate on the weakest answer | no |
| `jev-audit.mjs diff` | before/after per field (or per decision, for two map runs), with a sign test | no |

```bash
node jev-run.mjs suite.json --check                   # validate against API limits, no calls
node jev-run.mjs suite.json --out base.jsonl          # field-level run
node jev-run.mjs suite.json --map map.mjs             # whole-map run (standard interface)
node jev-run.mjs suite.json --pad 4000 --out pad.jsonl  # pad test
node jev-audit.mjs base.jsonl                         # audit (a map run gets the decision audit)
node jev-audit.mjs diff base.jsonl fixed.jsonl        # did the change do anything?
```

- **Behind an HTTPS proxy**, set `NODE_USE_ENV_PROXY=1` (Node 22.21+). Otherwise Node's `fetch`
  ignores `HTTPS_PROXY`.
- **Concurrency:** keep it at 2 for large states. Concurrency 8 on 20k-token states drew HTTP 503s.
  `jev-run` retries six times, backing off up to 16 s.
- **Formats:** [references/suite-format.md](references/suite-format.md).
- **Examples:**
  - `examples/support-triage.json`, field-level;
  - `examples/renewal-notice.json` with `renewal-notice.map.mjs`, whole-map, 30/30.

## The loop

**1. Write ~30 labelled cases before any product code.**
- Make half of them hard: the same input with different context and opposite answers (the same
  command in CI and in production; a real key inside a test file).
- Label by hand, then argue with your labels. Below ~30 cases, gaps under ~7 points are noise.

**2. Validate** with `--check`, then **run**.

**3. Audit, outcomes first**, reading `jev-audit`'s output in this order:

| section | what to do with it |
| --- | --- |
| **confidently wrong (≥ 0.9)** | read every case. In the study all seven defects found this way were the question's or the label's, and each fix was worth ~15 points |
| **one direction** flag (≥ 3 errors, ≥ 80% the same gold → answer) | a question defect first: a missing premise, a question broader than its labels, or labels not following the rubric |
| **calibration** | the scalar runs *under* the diagonal and the distribution sits near it, so gate on the distribution |
| **top-2 recall** | the value of showing a person two labels |
| **gate** | the threshold that hits your target precision and how much it automates. That is your automation budget |

**4. Grade the whole map** when it follows the standard interface (jev-questions). Report **wrong
decisions** next to accuracy: a map that abstains more but decides wrongly less is often the better
gate.

**5. Fix, then diff.** `real` needs |Δ| ≥ 7 points **and** p < 0.05. Also read `flipped`: a no-op
rewording once moved 82% of answers while accuracy barely moved.

**6. Re-run the comparator** on the same change before claiming Jev beats an LLM. A clearer question
helps every model, and two apparent wins in the study reversed that way. `jev-audit diff` accepts
comparator rows (`predicted` instead of `raw`).

## Experiments worth running

Each of these moved at least one result by 10+ points in the study. Most suites had only run three or
four, and the largest wins were among the least explored.

| experiment | how | cost |
| --- | --- | --- |
| confidently-wrong queue | `jev-audit` | free |
| pad test | `--pad 4000` (better: `--pad-file` with realistic material), then `diff` | one run |
| derive vs ask | ask the action *and* derive it (`--derive`), grade both | one run |
| state ablation | add the premise or a convention paragraph, then `diff` | one run |
| alternative encoding | `choice` vs a `noul` per option vs `score`; choose by measurement | one run each |
| adversarial round | a second case set built to defeat the current questions | the real cost |
| independent label audit | a person, or an LLM given only the rubric and the case, relabels | cheap |
| reachable gate | does any threshold hit your precision target on held-out cases? | free |

## Rules for trusting a number

| rule | why |
| --- | --- |
| treat single-suite gaps under ~7 points as unproven | unchanged baselines drifted 2.5 and 5.9 points on re-run |
| fit thresholds on held-out cases, never guess them | the same two-parameter fit gained 6.6 points on one suite and lost 28 on another |
| treat coverage on your own cases as an upper bound | on adversarial sets, coverage fell to one case in eight |
| grade the error that costs you | a gate with lower accuracy and zero unsafe allows beats one with higher accuracy and one |
| relabel toward the model only under a criterion already written down | otherwise you are fitting labels to the thing under test |
| expect about a third of apparent error to be label dispute | independent relabelling agreed 83–89%; Jev scored ~5 points higher on agreed cases |
| check every generated input is non-empty and as expected | an empty primer silently turns an arm into its baseline |
| check every experimental win was actually shipped | this was missed three times in the study |
| never lint question text instead of measuring | a rule checker: ~50% recall, 0 of 7 fixes outside noise |

## Before shipping

- **Shadow mode first:** act as before, and log what the gate *would* have done.
- **Pin the questions.** If an LLM compiled them, score several drafts and commit the winner. Never
  recompile at runtime.
- **Re-run the suite on every question, policy or model change**, and `diff` it.
