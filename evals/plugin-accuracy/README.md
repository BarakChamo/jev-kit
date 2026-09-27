# Do plugin-written question maps score better on Jev?

> **In short.** The design A/B's 37 maps, graded on what Jev actually answers.
> - **Design grade ≠ accuracy:** the first plugin cut CI-retry wrong decisions from 20% to 1.7%, but raised culprit-line wrong
>   decisions from 13% to 46%. It had misapplied a ranking rule, and its unmeasured regex pre-filters dropped the answer.
> - **Four rules came from reading Jev's wrong answers:**
>   - pick one with a `choice`;
>   - measure a pre-filter's recall;
>   - split compound questions;
>   - read dates as year/month/day choices.
> - **After those rules:** culprit went to 0% wrong decisions and renewal notice to 91.7%.
> - **Labels:** an LLM reviewer agreed with 88 of 90.


The [design A/B](../plugin-ab/README.md) graded 37 agent-written question maps on design, by whether
each avoided the one trap its task hid. This experiment grades the same 37 maps on **what Jev actually
answers**. Every map runs on a labelled suite through its **own unchanged `questions.json` and
`decide.ts`**, and its decision is compared with gold.

- **Suites** (`gen-*.mjs`, 30 cases each, gold computed by rule):
  - `notice`: contract text, cancellation email, dates. `avoided` / `not_avoided` / `not_applicable`.
    Boundary cases sit 3–6 days either side of the deadline, and some use months, later renewal terms or 24-month terms.
  - `retry`: 40-line CI log tails. Retry iff the cause is flaky or infrastructure. Half the cases carry
    a cue that points the wrong way: a "timeout" that is a real bug, or a network error from a wrong port.
    Causes repeat, so there are 11 distinct logs.
  - `culprit`: the same logs, with the acceptable root-cause line or lines marked.
- **Adapters** (`make-adapter.sh`): for each map, an agent wrote `adapter.ts`, which is plumbing only. It
  builds the map's state from a case, builds its questions (with the map's own builder where one
  exists), calls the map's `decide`, and maps the result to gold labels. "Needs review" and similar
  results count as **abstain**.
- **Runner** (`run-maps.ts`): real Jev calls through the plugin's own `evaluate()`. Scores are rounded to
  their nearest level before the adapter sees them, the same for every map. `--mock` proves each adapter
  runs before any spend. About 1,100 calls in total.

## Adapter bugs found and fixed

| bug | maps | fix |
| --- | --- | --- |
| a `noul` treated as a boolean (`noul ? 1 : 0`): any nonzero probability became 1 | 8, **all baseline** | pass the probability through. Left in, it would have biased the comparison against the baselines |
| a per-case choice rebuilt from the *example's* line numbers, so Jev chose among lines that did not exist | 1 baseline | rebuild the options from the case |
| an async `questions()` not awaited; a map that decides in code with no Jev call | 1 plugin | runner awaits, and skips the call when there are no questions |
| `__dirname` in an ES module | 1 plugin | `import.meta.url` |
| a numeric `noul` read as 0.5 (the adapter expected a boolean or a `probabilities.true`) | 1 plugin (round 11) | pass the number through |

## Result

`accuracy` counts an abstention as not right. `wrong` is the share of cases decided wrongly, which is
the error that costs you. `decided` is accuracy on the cases the map did not abstain on.

| task / arm | maps | accuracy | **wrong** | coverage | decided |
| --- | ---: | ---: | ---: | ---: | ---: |
| notice / no plugin | 4 | 69.2% | 3.3% | 72.5% | 95.5% |
| notice / plugin | 12 | 56.9% | 4.7% | 61.7% | 91.4% |
| retry / no plugin | 4 | 80.0% | **20.0%** | 100% | 80.0% |
| retry / plugin | 6 | 76.1% | **1.7%** | 77.8% | 98.1% |
| culprit / no plugin | 3 | 77.8% | **13.3%** | 91.1% | 86.3% |
| culprit / plugin | 8 | 47.5% | **45.8%** | 93.3% | 51.7% |

Per-map numbers: [`analysis.txt`](analysis.txt). Raw answers for every case: `out/`.

**The design grade did not predict accuracy.** Maps that passed the targeted trap were not reliably
more accurate, because accuracy depended mostly on design choices the design grading never looked at.

## What actually decided accuracy

**1. `retry`: the trap bit, and the plugin avoided it.** The four baseline maps each gated retry on a
`score` asking how likely a retry was to succeed (law 2's counterfactual). They decided wrongly on
**20%** of cases, and the worst on 47%. The plugin maps derived retry from the classified cause and
escalated the unsure band: **1.7% wrong**, at 78% coverage. This is the one task where passing the
design trap and scoring well are the same thing.

**2. `notice`: the trap is real, but the gates hid it.** Jev's direct "was notice timely?" question was
right **64–75%** of the time at about 0.7 confidence, as law 13 predicts. The maps that relied on it
made few wrong decisions only because that low confidence sent most cases to review, at **42%**
coverage. The two best maps in the whole experiment (100% and 96.7%) did the date arithmetic in code
from the explicit term-end date, and asked Jev only for the notice period. That is law 10: let code
decide what it can.

The largest single cost was one question. "Does the email satisfy the contract's notice-method
requirements?" sits at **0.50–0.79** when the contract plainly allows email, so careful maps route
every such case to review. The simple "does the contract allow notice by email?" is decisive:
0.90–0.94 when allowed, 0.02–0.06 when not. A compound noul that asks whether X satisfies whatever
Y requires is the weakest question in the suite.

**3. `culprit`: the plugin made it worse, in two measurable ways.**

| map | encoding | gold line offered to Jev | right when offered |
| --- | --- | ---: | ---: |
| best baseline | one `choice` over all lines, rubric naming the wrapper lines to skip | 30/30 | **30/30** |
| plugin maps with a regex pre-filter | one `noul` per candidate | **5, 16, 16, 22 of 30** | 1/5 · 13/16 · 4/16 · 17/22 |
| other plugin maps | one `noul` per candidate | 27–30/30 | 21/27 · 30/30 · 6/30 |

- **Pre-filters dropped the answer before Jev saw it.** Plugin agents narrowed 40 lines to "likely error
  lines" with a regex, to keep the request small. That filter is a classifier nobody measured, and it
  kept the true line in as few as 5 of 30 cases. The long-state result says the narrowing buys
  nothing: 40 lines, or 200, is a cheap single request.
- **A `noul` per candidate is absolute.** In one map, "##[error]Process completed with exit code 1"
  was the top line in 23 of 30 cases. It truthfully "shows the job failed", and a per-candidate yes/no
  cannot prefer a more specific line. A single `choice` normalises across lines, and with a rubric that
  names the wrapper lines it scored 100%. The skill's rule 11 ("a `noul` per candidate beat every other
  encoding") was measured on ranking patches and DOM elements, and it transferred wrongly to picking
  one line from a log.
- **Pointing at a cause was not the weak mode here.** The study's 65% came from near-identical log
  lines. These error lines are distinctive, and the best map hit 100%. The warning the plugin now gives
  is right to require measurement, and wrong if read as "this cannot work".

## Then the plugin was fixed and re-measured, three times

Each round was pre-registered with a numeric bar in
[`../plugin-ab/rubric.md`](../plugin-ab/rubric.md) before its maps were written. Every map was graded by
the same procedure.

| task / plugin version | maps | accuracy | **wrong** | coverage | decided |
| --- | ---: | ---: | ---: | ---: | ---: |
| notice / no plugin | 4 | 69.2% | 3.3% | 72.5% | 95.5% |
| notice / v1 | 12 | 56.9% | 4.7% | 61.7% | 91.4% |
| notice / v2 | 4 | 58.3% | 5.0% | 63.3% | 91.2% |
| notice / **v3** | 4 | **91.7%** | **0.0%** | 91.7% | 100% |
| retry / no plugin | 4 | 80.0% | 20.0% | 100% | 80.0% |
| retry / v1 | 6 | 76.1% | 1.7% | 77.8% | 98.1% |
| retry / **v3** | 3 | **85.6%** | **3.3%** | 88.9% | 95.9% |
| culprit / no plugin | 3 | 77.8% | 13.3% | 91.1% | 86.3% |
| culprit / v1 | 8 | 47.5% | 45.8% | 93.3% | 51.7% |
| culprit / **v2** | 4 | **100%** | **0.0%** | 100% | 100% |
| culprit / v3 | 3 | 86.7% | 13.3% | 100% | 86.7% |

- **v2 (round 10)** added the four fixes above: pick one with a `choice`, measure a pre-filter's recall
  or do not use one, split compound nouls, and do arithmetic in code. **Culprit went from 45.8% wrong
  to 0%**: all four maps used one `choice` over every line with a wrapper-naming rubric, and all four
  scored 100%. Notice did not move (58.3%). Its two weak maps asked Jev "how many days before the term
  ends did the email arrive?", which is date arithmetic in prose, answered at 0.65–0.68 confidence.
- **A reference design** that uses only what the task promised then scored **30 of 30** on notice. Jev
  reads the effective date as three `choice`s (year, month, day), plus the term length and the notice
  period, and code does every piece of arithmetic (`ref-notice-dates.mjs`). Every read was above 0.8.
  That became rule 5's "read dates exactly, as choices".
- **v3 (round 11)**: notice **91.7%, 0 wrong** (bar: at least 85% and at most 5% wrong). Every map read
  the dates as choices. One adapter read the API's numeric `noul` as 0.5, sending every answer to
  review. It was found because the map abstained on all 30 cases, fixed in the adapter only, and the map re-run.
- **Round 12**, a regression check of v3 on the other two tasks, was pre-registered at at most 5%
  wrong:
  - **retry passes**: 3.3% wrong, accuracy up to 85.6%.
  - **culprit fails**: 13.3% wrong. All 12 misses are one substitution on two failure kinds. The map
    picked the failing test's name (`× discount > applies the loyalty tier before tax`) over the
    assertion line beneath it (`→ expected 91.8 to be 90`). Both maps' rubrics explicitly allowed "the
    name of the specific test that failed". The gold, fixed before any run, accepts only the assertion
    line. The primary number stays on that gold, because relabelling after seeing results is the thing
    this project warns against.
  - **Sensitivity**: accept the test-name line directly above an accepted assertion and both maps score
    30/30. That changes no other map by more than one case.

## What it adds up to

- **The design grade is not the accuracy.** Passing the trap a task was built around did not make a
  map accurate. Accuracy was decided by choices the design grading never looked at: pre-filters,
  compound questions, where the arithmetic happened, and how one item is picked from many.
- **The first plugin helped where its guidance matched the task and hurt where it did not.** On
  `retry` it cut wrong decisions from 20% to 1.7%. On `culprit` a rule measured on a different shape of
  task (ranking) raised them from 13% to 46%.
- **Measured fixes worked, and the gains are large.** With the final plugin, every task makes as few or
  fewer wrong decisions than the baseline on the pre-registered gold, except culprit's test-name
  substitution. Notice went 69% → 92%, retry wrong decisions 20% → 3%, culprit wrong decisions 13% →
  0% (v2) or 13% (v3; 0% under the broader label).
- **None of this was visible without running the maps on Jev.** Three of the four rules added here came
  from reading what Jev answered on cases where a map was wrong. That is the confidently-wrong loop, the
  same method the study used on its own questions.

## Independent label audit

`label-audit.ts` gave each case and each suite's labelling rule, written as a person would read it,
to `zai/glm-5.3-flash` with reasoning on. The gold labels were never shown. Results are in
`label-audit.json` and `label-audit.txt`, at a cost of $0.03.

| suite | agreement with gold | disputed |
| --- | ---: | --- |
| notice | **30/30** | — |
| retry | **30/30** | — |
| culprit | **28/30** | 2. The reviewer's best line was the one *explaining* the cause (a port mismatch, a regenerated lockfile) rather than the error line, and it listed the gold line as acceptable in both |

- **The notice and retry labels hold.** They are computed by rule, so agreement mainly shows that the
  rules are readable and the cases unambiguous. It is not independent evidence that the rules are the
  right ones.
- **The culprit dispute from round 12 goes the maps' way.** The reviewer always picked the assertion
  line as *best*. It also listed the failing test's name line as *acceptable* in 5 of 6 cases. Scored
  against gold plus the reviewer's acceptable lines, the two round-12 maps go from 24/30 to **29/30**.
  The round-12 bar was pre-registered on the original gold, so it still reads as failed.
- **No conclusion changes.** Under the reviewer's sets, the first plugin's culprit maps still score
  1–26/30, the baselines 20–30/30, and the fixed plugin 29–30/30.
- **The reviewer is not fully independent.** GLM 5.3 Flash was also the study's comparator model. It
  is independent of the agent that wrote the maps and of me.

## Limits

- 3–12 maps per cell. One author wrote the suites and gold; an LLM reviewer agreed on 88 of 90 cases.
  Every map comes from the same agent model.
- The retry suite has 11 distinct logs, and the culprit suite reuses them.
- The adapters were written by an agent. Five kinds of bug in them, touching 12 adapters, were found and
  fixed. The `noul`-as-boolean bug was found by scanning every adapter before the comparison. The rest
  were found because a map abstained or errored on all 30 cases, and they were fixed before any arm
  was compared. Every fix is listed above, and all of them are in the committed adapter files. A bug
  that produced plausible but wrong numbers would not have been caught this way.
