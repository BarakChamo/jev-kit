---
name: jev-fit
description: Decide whether a classification, extraction, triage, screening or gating decision should run on Jev (TypeSafe's System One typed evaluator) instead of an LLM, and predict the likely accuracy gap before building. Use when someone proposes using Jev / System One / a typed evaluator, asks "should this be an LLM call or Jev", or is choosing a model for a high-volume or hot-path decision.
---

# Does this decision fit Jev?

Jev takes one `state` and a map of typed questions (`noul` = probability, `choice` = one of ≤255
options with a full distribution, `score` = ordered rubric) and answers them all in one parallel pass.
It never emits text. Everything below comes from 57 hand-labelled suites (1,836 cases) run against a
cheap LLM and, on seven suites, a frontier model.

**The headline to calibrate expectations:** on the decisions this model class is built for it is
**+4.8 points** over a good cheap LLM and **a tie** with a frontier model. Per decision it is **3–10×
cheaper than a cheap flash LLM on short states** (a few hundred tokens; up to ~100× where the LLM
reasons or the state is long), **200–600× cheaper than a frontier model**, and **about 5× faster at
p50** (0.25–0.6 s against 2.9 s). Nobody buys four points of accuracy. Recommend Jev when the
**economics or latency** make an LLM impossible, not because it will be more accurate.

## Step 1 — the four gates (all must hold)

1. **Bounded answer space**: one of a known set, a yes/no, or a rung on a rubric.
2. **The evidence fits in the state**: everything a careful person would need, assembled by code.
   Long is fine: 24 questions over a 25,500-token state scored 100% in one request.
3. **Volume or latency pressure**: thousands of decisions, or a hot path (per tool call, per chunk,
   per turn, per commit).
4. **A wrong answer is survivable**: there is a human queue, a bigger model, or a safe default for
   the cases Jev is unsure about (the gate sends them there). Confidently wrong answers get past any
   gate, so the decision must also tolerate a small rate of those.

If any gate fails, say so and recommend an LLM or plain code.

## Step 2 — predict the gap from the decision's shape

| decision shape | measured mean Δ vs cheap LLM | wins |
| --- | ---: | ---: |
| **many independent facts + a verdict over them, from one artefact** (fan-out) | **+13.1 pp** | 8/9 |
| the verdict built over many facts (the aggregate judgment) | **+16.5 pp** | 7/7 |
| none of the hard shapes below | +4.8 pp | 15/21 |
| single artefact against a rubric | +0.8 pp | 25/44 |
| adversarial state (detecting hostility) | +0.5 pp | 5/8 |
| multi-hop (chaining facts across the state) | −0.5 pp | 4/11 |
| **comparative** (weighs two items or quantities) | −1.7 pp, worst −17 | 8/16 |
| **needs outside knowledge** not in the state | **−10.4 pp** | 1/6 |

Ask these in order. Any "yes" among the first three predicts a loss unless redesigned:

1. **Does it compare two things?** If it compares *quantities* (notice period vs term, cost vs cost),
   it can still work: ask Jev to read each quantity and compare in code. That took a 41.7% field to
   100% and a 50% field to 92.9%. If it *weighs* trade-offs ("which action is
   cheapest"), expect a loss. See the jev-questions skill, rule 8.
2. **Does it need facts it must chain across the state?** Expect a small loss. Distance costs nothing
   (20,000 tokens apart scored the same as adjacent). Plan a cascade for the unsure tail.
3. **Does it need knowledge that is not in the state?** If the missing knowledge is a *convention* of
   the domain, write it once as a short primer in the state (worth +12 to +20 points where measured).
   If it is a *fact about the world right now* (a price, a reputation), a primer does nothing. You need
   retrieval.
4. **Does it pull many independent facts from one artefact?** Build it. This is the structural win:
   extra questions in the same request are nearly free (13 short questions in one request cost 8.2×
   less than 13 requests; 24 questions over a 25,500-token contract, 11.7× less, because the long state
   is paid for once instead of 24 times), with identical answers, and the answers are independent
   (adding 24 unrelated questions moved 0.0–1.2% of answers).

## Step 3 — hard disqualifiers

- **A rule nobody can write down.** If you cannot state the decision rule, the model cannot be told
  it and code cannot apply it. The worst suite in the study was this (−17 points), and both predicted
  fixes failed.
- **Generated text** of any kind. Jev does not write.
- **Pointing at a cause among near-identical items** ("which of these similar log lines caused
  this"): 65% at 0.88 confidence, the most over-confident result in the study. Distinctive items are different:
  picking the error line from a real log with one `choice` scored 100%, and pointing at an affordance
  ("which element does what I want") 87–94%. Measure before ruling it in or out.
- **Resisting manipulation** as the primary job (fraud review, a security control). In the study it
  *detected* an injected approval claim 5 of 6 times with zero false alarms but *resisted* it only 3 of
  6; in the rule probes the claim fooled a deploy judgment 6 of 6. Ask it "is this hostile?" as one
  signal in a layered design, not "what should I do given this hostile input?". The evidence is six
  cases per domain.
- **Counting, date ordering and arithmetic at a threshold**, unless reshaped so that Jev *reads* the
  values (a date as year/month/day choices, 30/30) and code does the arithmetic.

## Step 4 — the economics check

Estimate decisions per month × input tokens per decision. Jev list price is **$0.042 per million
input tokens; output is free**. Measured envelope through the gateway: **~600 ms p50, ~1.05 s p95**
across the study's 54 suites (worst observed p95 4.1 s), and 250–325 ms p50 on the kit's example in
September 2026, against 2.9 s p50 and 10 s p95 (worst 95 s) for the cheap LLM. Model the economics
at 10× list price before committing a roadmap: prices move. TypeSafe documents 1,200 requests a
minute and 32k tokens of state per request; ask them about higher limits before planning above that.

Worked example: 40,000 tickets a day at ~1,300 input tokens each is 1.56 billion tokens a month:
**~$66 a month** at list price ($655 at 10×). Throughput: 40,000 a day is 0.5 requests a second,
far inside the documented limit.

If a cheap LLM already costs little at your volume and is not in a hot path, recommend a **cascade**
(Jev first, LLM on the unsure tail) rather than a replacement.

## What to output

A short verdict with: the four gates (pass/fail each), the shape and its expected Δ, any
disqualifier, the volume/latency argument in numbers, and a recommendation: **Jev**, **Jev + cascade**,
**LLM**, or **code**. Then point to the next step: design the questions with **jev-questions** and build
~30 labelled cases with **jev-eval** before writing product code. The expected Δ is a prior, not a
promise. Single-suite gaps under ~7 points never replicated in the study.
