# Does the plugin change what an agent writes?

> **In short.** 98 agent runs over 14 rounds, blind where both arms ran, against rubrics committed first.
> - **Avoiding the traps:** agents with the plugin avoided the Jev-specific traps (8/8 against 1/8), compiled, scored and
>   pinned questions (3/3 against 0/3), and escalated the unsure band (19/19 against 7/19).
> - **Three gaps found:** each was fixed by moving or sharpening a rule, and each re-test went 3/3 or better.
> - **The hook:** rounds 8–14 tested it. It added nothing from scratch, and it was replaced by a review checklist in the
>   skill (3/3), then removed.
> - **Caveats:** rule and round numbers below are as they were at the time; the current numbering is in
>   `plugin/skills/jev-questions/references/rules.md`. This measures *design* only. Accuracy is in
>   [`../plugin-accuracy`](../plugin-accuracy/README.md).


Claude Code runs (`claude -p`) of design tasks, each with and without `--plugin-dir plugin`. Both arms got the same task text and the same one-paragraph API description (`run.sh`),
so the difference is the plugin (its skills, and at the time a hook) alone. Each task hides one trap whose cost the
study measured:

| task | trap | measured cost of falling in |
| --- | --- | --- |
| `notice` | the decision is a comparison of two quantities (notice required vs notice given) | 41.7% asked directly vs 100% bucketed and compared in code |
| `retry` | the natural question is the action or a counterfactual ("will a retry pass?") | 80% vs 92.5% deriving retry from the cause |
| `contra`, `contra2` | the judgment needs a premise (the verified answer) in the state; in `contra2` the task does not say to use it | 77.5% vs 100%, `contradicts` recall 0 → 1.00 |
| `cheapest` | choosing the cheapest of five resolutions is weighing, not deciding | the worst suite in the study; both predicted fixes failed |
| `culprit` | pointing at the log line that *caused* a failure | 65–67.5% at 0.88 mean confidence, the worst calibration measured |

The rubrics ([`rubric.md`](rubric.md), one section per round) were committed before that round's output was read. Outputs were copied
under random ids and graded blind (`roundN/grades.json` in each round's folder), then unblinded.

## Result, fourteen rounds, 98 runs

Rounds 1 (12 runs), 2 (26) and 4 (18) are blind, graded against rubrics committed before the output
was read. Rounds 3 and 5 (3 runs each) test fixes to the skill that rounds 2 and 4 motivated. Round 6 (8 runs) is
a regression check of the final plugin on the tasks it had already won, and round 7 (6 runs) tests the
fix for the one regression round 6 found. Rounds 3, 5, 6 and 7 have only the plugin arm, so they are
not blind. Blinding is also imperfect where an agent named a
skill inside its code rather than its final message (seen in round 4's `compile` runs). Grades: [`round1/grades.json`](round1/grades.json),
[`round2/grades.json`](round2/grades.json), [`round3/grades.json`](round3/grades.json), each with its
unblinding `key.json`.

| trap | plugin | no plugin |
| --- | ---: | ---: |
| `notice`: both quantities bucketed and compared in code | **4/4** | 1/4 (two ask Jev "was notice timely?", one keeps that question as a veto) |
| `retry`: cause classified, retry derived in code | **4/4** | 0/4 (all four also gate retry on a `score` asking how likely a retry is to succeed) |
| **`notice` + `retry` combined** | **8/8** | **1/8** (one-sided Fisher exact p < 0.001) |
| `contra` / `contra2`: the answer key in the state | 5/5 | 5/5 (does not discriminate, even with the key left implicit) |
| `cheapest`: the weighing done in code, not asked | 3/3 | 3/3 (does not discriminate) |
| `culprit` round 2: warns that causal pointing is weak and ranks for a person | 0/3 (all three redesigned to a `noul` per candidate, none warned) | 0/3 (all three one `choice`, trusted on its confidence) |
| `culprit` round 3, **after the fix below** | **3/3** | — |
| `compile`: drafts scored on labelled cases, winner pinned, never recompiled at runtime | **3/3** | 0/3 (one never addresses compilation; two regenerate on each policy edit with no selection) |
| `fanout`: one request per contract, all 25 fields over the full text | 3/3 | 3/3 (does not discriminate) |
| `handoff` round 4: the source transcript in Jev's state, not only the upstream extraction | 0/3 | 0/3 |
| `handoff` round 5, **after the second fix below** | **3/3** | — |
| round 6 regression check (`notice`, `retry`, `culprit`, `compile`, two each) | 7/8: one `notice` FAIL | — |
| `notice` round 7, **after the third fix below** | **6/6** | — |
| **`notice`, all rounds** | **11/12** | 1/4 |
| round 8 `notice` with the skills but **no hook** | 4/4 | — |
| round 8 `edit`: flags a comparison trap in existing code during an unrelated edit | first hook 0/3 · skills only 0/3 | 0/3 |
| round 9 `edit`, **hook redesigned to review on read** | **3/3** | — |
| round 13 `edit`, hook removed, a one-line review instruction in the skill | 1/3 | — |
| round 14 `edit`, a six-item review checklist in the skill | **3/3** | — |
| unsure band escalated rather than defaulted to the permissive action (rounds 1–2) | **19/19** | 7/19 |
| a detector question beside a manipulable judgment, unprompted (`retry`, `cheapest`) | 3 | 0 |
| final message tells the user to measure on labelled cases before trusting it | **every run** | none |

## The two gaps the A/B found, and the fixes

In round 2, no plugin agent warned that "which log line caused this" is Jev's weakest measured mode.
The guidance was in the `jev-fit` skill, and agents writing questions load `jev-questions`. Rule 11
of `jev-questions` and the hook checklist now carry it. In round 3, all three plugin runs led with the
warning (65–67.5% at 0.88 confidence) and shipped a ranked shortlist for a developer instead of an
auto-pointer, which is the design the study supports. The pre-registered bar was 2 of 3.

In round 4, **every** agent, with the plugin or without, decided "was this agent session safe"
from the upstream LLM's extracted findings rather than the transcript. The study measured exactly
this at 75% → 50%. The guidance was in `jev-questions`, but in the architecture section, and the
task's framing ("we already run an LLM that extracts findings") won. It now sits in rule 1 as part
of "put the premise in the state", with an instruction to say so before building, and in the hook
checklist. In round 5, all three plugin runs put the transcript in the state with the findings
alongside, and explained why. The pre-registered bar was again 2 of 3.

Round 6 re-ran the final plugin on the tasks it had already won, and one `notice` run failed. It
extracted the required notice period, then asked Jev "is the receipt date on or before the
deadline?" and decided on that. Its own summary called the question "not a conditional". It had read
rule 5 and missed its scope, because a deadline is a computed quantity. Rule 5 and the hook now name
deadlines, "on time", "within the limit" and "exceeds the cap" as comparisons, and say not to add the
direct question even as a cross-check. Round 7 went 6 of 6 against a pre-registered bar of 5 with no
FAIL.

Rounds 8 and 9 asked what the hook adds. From scratch, the skills alone matched the full plugin (4/4),
so the hook contributed nothing there. On a small edit to an existing map with a comparison trap in
it, every arm went 0/3. That includes the full plugin, whose hook fired each time and was read as a
note about the agent's own change. Rewritten to fire on read and to ask for a review of every question
in the file, reported to the user, it went 3/3. That job, reviewing code the agent did not write, is
the hook's only measured contribution. Rounds 13–14 then moved that job into a checklist in the skill (3/3), and the hook was removed.

This is the A/B working as it should. It measured a behaviour, found where the skill failed to
transfer a measured result, and the fix was then measured too.

## What this does and does not show

- **It shows transfer of practice**: with the plugin, agents avoided the two traps that decide these
  tasks every time. Without it, they fell in 7 times out of 8, in the exact form the study measured.
  The `retry` baseline's `score` "how likely is a retry to succeed" is law 2's counterfactual,
  verbatim.
- **Four traps did not discriminate**: premise, weighing, and fan-out were avoided by both arms, and
  handoff (before the fix) by neither. A capable agent already puts an answer key in the state, does
  cost arithmetic in code, and sends one request per document. The plugin's value is in the traps
  that are specific to this model class: hidden comparisons, asked-for actions, causal pointing,
  compile-and-pin, and deciding from the source.
- **A rule's scope has to be stated, not implied.** The round-6 regression came from an agent that
  followed rule 5's letter ("compare in code") and not its reach ("a deadline is a comparison").
  Every fix in this A/B added an example of what the rule covers, not a new rule.
- **Placement in the skill matters as much as content.** Both gaps were guidance the plugin already
  contained, in a place the agent did not weigh. Moving each into the rule the agent reaches first
  fixed it in the next round.
- **n is small** (3–4 per cell), and one person graded, blind, using rubrics derived from the rules
  the plugin teaches. That is what "transfer" means here, and it is also the obvious bias.
- **It does not show accuracy.** None of these maps was run against Jev. The next step is to write
  labelled suites for `notice`, `retry` and `culprit` and grade every map by Jev accuracy (`jev-run` +
  `jev-audit`). That needs gateway credit.

Reproduce: `REPO=<repo root containing plugin/> OUT=/tmp/ab bash run.sh notice plugin 1`.
