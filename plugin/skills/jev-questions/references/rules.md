# The rules: evidence and replication status

Each rule was found on one task and then tested somewhere else. The **status** column records what
happened when it was.

| status | meaning |
| --- | --- |
| **held** | replicated, or never contradicted wherever it was applied |
| **conditional** | real only under the stated condition; outside it, it did nothing or hurt |
| **single** | one large measured effect, not yet replicated |

**Where it came from:** *study* means the original 57-suite comparison of Jev with LLMs. *plugin evals*
means grading agent-written maps by Jev accuracy (`plugin-accuracy`, `heldout`, `heldout2`). *probes*
means `results/experiments/rule-probes`: each rule's two wordings on 12 items in each of three new domains.

> At n = 20–50, re-running an unchanged baseline drifted 2.5 and 5.9 points. Treat any single-task gap
> under ~7 points as unproven.

## The skill's rules

| skill rule | rule | found (where) | re-tested | status |
| --- | --- | --- | --- | --- |
| 1 | Put the missing premise in the state | contradiction screening: recall 0 → 1.00, 77.5% → 100% (study) | +11.4, +2.7 elsewhere; **−5.1** when a *library* was added instead; probes: 6/12 → 12/12 in three domains, the failure confident (0.82–0.90) | **held**, with its condition |
| 1 | Decide from the source, not another model's extraction | auditing agent transcripts: 75% → 50% without the source (study) | agents building on an extractor: 0/6 kept the source; after the rule moved into rule 1, 3/3 (plugin A/B) | **held** |
| 2 | Name the field | +31.4 under padding ("this document" → "`excerpt`") (study) | as a blanket rewrite: **−5.4, +2.6**; probes with trigger content beside the field: 6/12 → 12/12 in two domains of three | **conditional**: matters when the state holds other material; pad-test |
| 3 | Write a domain convention in once | +20.0, +12.1 (study) | +0 on live-fact tasks; LLM-generated primers: half, nothing, −5.7 | **conditional**: conventions, not facts |
| 4 | The key carries no meaning | polarity-contradicting question: LLM 100%, Jev 0% (study) | probes: renaming keys changed no answer in three domains | **held** (structural) |
| 5 | Ask what is true now; never branch inside a question | severity 48.7% → 82.1% gated, 87.2% as two facts; retry recall 0.38 as a counterfactual (study) | "if this turned out wrong" as framing, not a branch: 100%, 95.0%, 91.7%; retry maps gating on "will a retry succeed?" made 20% wrong decisions vs 1.7% (plugin evals); probes: counterfactual 11, 6, 12 of 12 at 0.35–0.56 decisiveness vs 12/12 at 0.92–0.98 | **held** for branches and counterfactuals; framing is fine |
| 6 | Split compound questions | "does the email satisfy whatever method is required?" 0.50–0.79; "does the contract allow email?" 0.90–0.94 / 0.02–0.06 (plugin evals) | probes: the compound tied on accuracy (12/12 in three domains) but fell to 0.56 decisiveness where meeting the requirement took reasoning | **conditional**: split when the requirement needs reasoning |
| 7 | Ask "does it include", not "is it a kind" | "is it a never-reimbursable kind?" 10/12, 0.32–0.71; "does it include alcohol or entertainment?" 12/12, 0.93–0.98 (plugin evals) | expense maps using it: 3 of 4 with 0 wrong decisions in 50, the fourth 1; probes: 6, 6, 10 of 12 → 12/12 | **held** |
| 8 | Never ask Jev to compare against a value it must compute | exercisability 41.7% → 100%, deliverability 50.0% → 92.9% (study) | a price flag inside a policy table: **0.0**; direct "on time?" 64–75% (plugin evals); probes: two *stated* values 12/12 even across units or 3k tokens apart, a *computed* limit 9/12 at 0.25, months vs days 11/12 at 0.57; sla-breach maps asking "breached?" made all 14 wrong decisions (heldout2) | **held, narrowed** to computed sides |
| 9 | Read dates as year/month/day choices; do arithmetic in code | direct "on time?" 64–75%; reading dates and computing: 30/30 (plugin evals) | four agent-written maps using it: 86.7–100%, 0 wrong decisions; probes: direct 8, 12, 9 of 12 at 0.21–0.56 vs 12/12 at 1.00 | **held** |
| 9 | Read a stated number exactly | "USD 75" banded as 70–75: 10 wrong in 20 hard cases (plugin evals) | maps reading limits exactly: 0–1 wrong | **single** |
| 10 | Pick one with a `choice`, rank with a `noul` each | log-line culprit: one `choice` 100%, a `noul` per line 13–100% (plugin evals) | seven more maps with one `choice`: 30/30 in five, 24/30 in two; probes: a `noul` per item 1–2 of 12, one `choice` 12/12 | **held** |
| 10 | Pointing at a cause among similar items is weak | 65–67.5% at 0.88 confidence, three encodings (study) | distinctive error lines: up to 100% (plugin evals) | **conditional**: on how alike the candidates are |
| 11 | `score` is the fragile primitive | compiled score rubrics swung 56 points, choice 4; severity 48.7% → 69.2% as a choice (study) | score → choice elsewhere: **−4.0, −2.9, +2.9** | **conditional**: fragile, but not always worth replacing |
| 12 | Derive only from reliable, sufficient facts | five facts at 100/95/90/87/67% → 48.7% as an AND (study) | splitting a two-clause AND: 0.0 (predicted); twenty data points below | **held** |
| 13 | Gate on the label's probability, not the scalar | 5,227 answers: scalar off by up to 29 points, distribution within ~4 (study) | 379 picks over 20+ options: right median 0.94, wrong 0.68; a gate at 0.8 dropped 6/6 wrong, at 0.6 kept 5/6; a guessed 0.6 abstained on right picks at 0.58; v3 maps by GLM and Qwen over-abstained on policy-level gates, and v4 (fitted gates, no gates on the policy, pinned constants) raised them from 76–80% to 91% on maps that ran (heldout2) | **held**; fit the gate per question, gate on the case |
| 14 | Abstain option *and* confidence gate | ambiguity caught 25% → 50% together (study) | — | **single** |
| 15 | Detector question beside a manipulable judgment | detection 5/6, resistance 3/6; gate 75.0% → 83.3% (study) | added unprompted in at least six plugin A/B runs, none in the baseline; probes: where the claim fooled the decision (6/6, deploys) the veto stopped all 6; elsewhere it cost nothing | **held** |
| 16 | Measure a pre-filter's recall, or send everything | regex pre-filters kept the right line in 5, 16, 16, 22 of 30 (plugin evals) | — | **single** |
| 16 | Let code settle what it can | placeholder integrity 82.1% → 87.2% → 89.7% (study) | best renewal maps computed the deadline in code: 100%, 96.7% (plugin evals) | **held** |

## Principles behind the architecture

| principle | evidence | status |
| --- | --- | --- |
| Ask everything at once | 13 questions: 8.2× cheaper, 7.4× faster, identical answers; adding or reordering questions moved 0.0–1.2% of answers | **held** |
| Confidence guards ambiguity, not mis-specification | a mis-specified question was wrong at 0.99–1.00; calibration held on every suite, including every loss | **held** |
| Compile, select, pin | four drafts of one policy: 24–80%; a no-op rewording moved 82% of answers; agents with the plugin did this 3/3, without 0/3 | **held** |
| Grade a gate by the direction of its errors | lower accuracy (79.1% vs 83.7%) yet 0 block-worthy commands allowed; 29/29 live secrets caught | **held** |
| Top two labels for people, not for models | argmax discards 12–25 points of recall; a shortlist handed to another model: **−4.6** | **held** |

## The derive-or-ask evidence, all twenty points

Derive (asked → derived in code):

| target | Δ |
| --- | ---: |
| a comparison of two quantities (exercisability) | **+58.3** |
| a comparison of two quantities (deliverability) | **+42.9** |
| definitionally a function of the class (post a review comment) | +29 precision |
| definitionally a function of the class (catches a regression) | +18.9 |
| an ordering over two named behaviours | +15.0 |
| a policy table over clean flags | +14.3 |
| a cause-to-action mapping (retry) | +12.5 |
| a short OR of clean flags (needs approval) | +10.0 |
| a precedence over five facts (agent next step) | +10.0 |

Ask:

| target | Δ if derived |
| --- | ---: |
| a judgment not a function of the askable facts (cheapest action) | **−34.3** |
| a judgment not a function of the askable facts (injection verdict from three detectors) | **−27.0** |
| a disjunction split | −10.0 |
| a weighted holistic judgment (review level) | −9.0 |
| a scoped-knowledge question | −8.6 |
| a long AND (behaviour preservation) | −7.7 |
| a four-way triage | −5.9 |
| a pointer (culprit line) | −5.0 |
| a weighted holistic judgment (clause risk) | −2.9 |
| a gate decision | −2.4 |

Fitting a derivation's thresholds on ~25 labelled cases gained 6.6 points on one task and lost 28 on
another. Always report held-out.

## What does not work, measured

| | evidence |
| --- | --- |
| a fact the state lacks | 1 win in 6, −8.5 to −10.4 pp. Convention primers fix about half; live facts need retrieval |
| holding a computed value against a separately stated one | 100% → 87.5%, confidence 0.92 → 0.73 |
| a rule nobody can write down | the worst loss measured; the derived version reproduced 31% of the author's own labels |
| weighted holistic judgment | −2.9 to −9.0 across four tasks |
| pointing at a cause | 65–67.5% at 0.88 mean confidence |
| resisting prompt injection | 3 of 6 (it never allowed what should be blocked, and detected it 5 of 6) |
| extract-then-decide | 75% → 50% when the source is withheld |
| static rule-checking of question text | 0 of 7 fixes outside noise; ~50% recall; flags fields at 100% |
| automating a hard queue | calibration survives adversarial cases; coverage does not (100% precision over 1 case in 8, against 40–70% on easy sets) |
| sustained large-state load | HTTP 503 at concurrency 8 on 20k-token states; concurrency 2 ran 855 calls with one failure |
