# Pre-registered rubric (written before any output was read)

Primary: one trap per task, each a defect whose cost the study measured.

- notice (hidden comparison, law 13; asked 41.7% vs bucketed+compared 100%):
  PASS = the notice requirement and the notice actually given (or the dates) are obtained as separate
  quantities and compared in code. FAIL = a question asks Jev whether notice was sufficient / in time
  and the decision rests on it. PARTIAL = both, with the direct question used as a fallback or veto.
- retry (asked action / counterfactual, laws 2+4; asked 80% vs derived 92.5%):
  PASS = Jev classifies the failure's cause (or similar present-tense facts) and retry is derived in
  code. FAIL = a question asks whether to retry / whether it would pass on retry, and the decision
  rests on it. PARTIAL = both, direct question load-bearing in some branch.
- contra (missing premise, law 1; 77.5% -> 100%, contradicts recall 0 -> 1):
  PASS = the verified answer for the question is in the state. FAIL = it is not.

Secondary, scored 0/1 per run:
- S1 field naming: most instructions name the state field they read.
- S2 no branch in an instruction: no instruction contains an "if ... then/would" conditional.
- S3 gate: low confidence escalates or goes to a person, never defaults to the permissive action.
- S4 Score avoided unless the levels are genuinely ordered.

# Round 2 (pre-registered before any round-2 output was read)

- notice, retry: two more repetitions per arm, same rubric.
- contra2 (missing premise, harder: the canonical answer exists but the task does not say to use it):
  PASS = the canonical/current answer for the matched FAQ entry is put in the state. FAIL = passages
  judged against the question alone, or against "general knowledge".
- cheapest (a weighing task with no written rule; law 13 / the worst suite in the study, where both
  predicted fixes failed): PASS = the agent tells the user the cheapest-action choice itself should
  not be decided by Jev (it recommends facts from Jev with the choice in code under a written policy,
  or an LLM / human for the weighing) and names why. FAIL = a single Jev question picks the
  cheapest action and the decision rests on it.
- culprit (pointing at a cause; 65% at 0.88 confidence, the worst calibration measured): PASS = the
  agent warns that causal pointing is a weak mode for Jev and either redesigns (e.g. a noul per
  candidate line with argmax, plus a low-confidence path) or recommends a different tool, AND does
  not treat high confidence as sufficient on its own. FAIL = one choice over line ids, trusted as is.

# Round 3 (pre-registered): the culprit fix

Round 2 found no plugin run warned that causal pointing is a weak mode, because that guidance lived
only in jev-fit. Rule 11 of jev-questions and the hook checklist now carry it. Three new plugin runs
on `culprit`, graded with the round-2 culprit rubric unchanged. The fix counts as working if at least
2 of 3 PASS (warning given and the design does not auto-answer on confidence alone).

# Round 4 (pre-registered before any round-4 output was read)

Blind, both arms, three repetitions, graded with the same procedure as round 2.

- fanout (fan-out economics: one long state, many scoped questions; splitting re-pays for the state,
  11.7x for identical answers; 24 scoped questions over 25.5k tokens scored 100%):
  PASS = one request per contract (or a small fixed number) carrying the full text and all fields as
  questions, each question scoped to a named field. FAIL = one request per field, or retrieval /
  chunking per question as the default design. PARTIAL = one request per document but chunked
  per-chunk-per-question fan-out, or a hard 'too long, must chunk' assumption without measuring.
- compile (compile, select, pin: four drafts of one policy scored 24-80% on one field; a no-op
  rewording moved 82% of answers):
  PASS = compilation happens offline when the policy changes, several drafts are scored on labelled
  cases, the winner is committed/pinned, and the suite is re-run on each policy change. FAIL = the
  LLM compiles questions at request time, or compiles once and ships with no evaluation.
  PARTIAL = compiled offline and cached/pinned, but with no selection among drafts or no labelled
  evaluation gate.
- handoff (extract-then-decide: 75% -> 50% when the source is withheld; the other model's facts did not
  transfer):
  PASS = the transcript itself is in Jev's state (the LLM findings may be included too), with the
  decision's evidence read from the source. FAIL = Jev's state is only the LLM's extracted findings.

# Round 5 (pre-registered): the handoff fix

Round 4 found all six agents, plugin or not, decided from the upstream LLM's extracted findings. The
guidance sat in the architecture section; rule 1 of jev-questions and the hook checklist now carry it
as part of "put the premise in the state". Three new plugin runs on `handoff`, graded with the round-4
handoff rubric unchanged. The fix counts as working if at least 2 of 3 PASS.

# Round 6 (pre-registered): regression check on the final plugin

Both fixes lengthened jev-questions. With the final plugin, two runs each on `notice`, `retry`,
`culprit` and `compile`, graded with their earlier rubrics unchanged. The check passes if no run
FAILs; any FAIL or PARTIAL is reported as a regression.

**Round 6 result: 7 of 8 PASS, 1 FAIL, reported as a regression.** `notice-plugin-8` extracted the
required notice days, then asked Jev "is the receipt date on or before the deadline?" as a choice
and decided on it. Its own summary called this "not a conditional", so rule 5 was read but its
scope was missed: a deadline is a computed quantity. Rule 5 and the hook now name deadlines, "on
time", "within the limit" and "exceeds the cap" as comparisons, and say not to add the direct
question even as a cross-check.

# Round 7 (pre-registered): the deadline wording

Six plugin runs on `notice` with the round-1 rubric unchanged. The fix counts as working if at least
5 of 6 PASS and none FAIL.

# Round 8 (pre-registered): what does the hook add?

Arms: `plugin` (skills + hook), `nohook` (the same plugin with hooks/ removed), `base` (no plugin).

- `edit`, 3 runs per arm: the agent is asked for a small, unrelated edit (an authorised-sender check)
  to an existing Jev integration whose timeliness decision rests on a direct `notice_timely` noul,
  the law-13 comparison trap. The request does not ask for a review.
  PASS = the agent flags the direct timeliness question as unreliable (a comparison Jev should not
  make) or replaces it with bucketed quantities compared in code. FAIL = it makes only the requested
  edit.
- `notice` from scratch, 4 runs of `nohook`, graded with the round-1 rubric, compared against the
  full plugin's 11/12.

Whether the hook fired is recorded from its once-per-file markers, not inferred.

**Round 8 result.** `edit`: 0/3 in every arm (plugin, nohook, base); the hook fired in all three
plugin runs (logged) and no agent flagged the existing direct timeliness question. `notice` from
scratch without the hook: 4/4, the same as the full plugin. The hook as designed had no measurable
effect in either test.

# Round 9 (pre-registered): a redesigned hook

The hook now fires on Read as well as Write/Edit, so it arrives before the agent edits, and its
message asks for a review of every question already in the file, reported to the user. `edit` task,
three plugin runs with the redesigned hook, round-8 rubric unchanged. The redesign earns the hook
its place if at least 2 of 3 PASS; otherwise the recommendation is to ship the plugin without a hook.

**Round 9 result: 3 of 3 PASS** (hook fired on Read in all three, logged). Every run made the
requested edit, then flagged `notice_timely` as the law-13 comparison trap, proposed the bucketed
fix, and left it unchanged as out of scope. The redesigned hook is kept.

# Round 10 (pre-registered): accuracy after the accuracy-driven fixes

The accuracy eval (`plugin-accuracy`) found the plugin's culprit maps worse than baseline (45.8% vs
13.3% wrong decisions), and the notice maps lower in coverage. Rule 11 (pick one with a choice), a
pre-filter rule, compound-question splitting and "do arithmetic in code" were added. Four new plugin
runs on each of `culprit` and `notice`, graded by **accuracy** on the same labelled suites and with
the same adapter procedure. Success is measured against the earlier numbers, fixed now:
- culprit: mean wrong-decision rate below the baseline arm's 13.3%, and mean accuracy above the old
  plugin arm's 47.5%.
- notice: mean accuracy above the old plugin arm's 56.9%, with wrong decisions at or below 5%.

**Round 10 result (accuracy).** culprit: 4 of 4 maps at 100%, 0 wrong decisions (target met: 0% <
13.3% baseline; 100% > 47.5%). notice: mean accuracy 58.3% (target 56.9%: met by 1.4 points, within
noise) and 5.0% wrong (target at or below 5%: met exactly). The notice spread was 33–100%, and the two
weak maps asked Jev to compute the lead time from the contract (0.65–0.68 confidence). A reference
design that reads the effective date as year/month/day choices and computes everything in code
scored 30/30. That rule is now in rule 5.

# Round 11 (pre-registered): read dates as choices

Four plugin runs on `notice`, graded by accuracy with the same adapter procedure. Success: mean
accuracy at least 85% with wrong decisions at or below 5%.

**Round 11 result (accuracy): met.** notice maps at 93.3, 86.7, 100 and 86.7% (mean 91.7%), 0 wrong
decisions. One adapter read a numeric `noul` as 0.5 (every answer "unsure"); it was found because
the map abstained on all 30 cases, fixed in the adapter only, and the map re-run.

# Round 12 (pre-registered): accuracy regression check of the final plugin (v3)

Three v3 runs on each of `retry` and `culprit`, graded by accuracy. Passes if retry wrong decisions stay
at or below 5% (v1 1.7%, no plugin 20%) and culprit wrong decisions at or below 5% (v2 0%, no plugin
13.3%).

**Round 12 result (accuracy).** retry: 3.3% wrong, accuracy 85.6%, **passes**. culprit: 13.3% wrong,
**fails** the pre-registered bar. All 12 misses are the failing-test-name line chosen over the
assertion line beneath it, which the maps' rubrics explicitly allowed. The primary number stays on the
original gold. Sensitivity: 30/30 for both maps if the test-name line is accepted, and no other map
changes by more than one case.

# Round 13 (pre-registered): the hook removed, its instruction moved into jev-questions

The hook is deleted. `jev-questions` now tells the agent to review every question in any existing map
it edits and report failures. `edit` task, three runs of the hookless plugin, round-8 rubric
unchanged. The instruction replaces the hook if at least 2 of 3 PASS.

**Round 13 result: 1 of 3, below the bar.** One run flagged the timeliness comparison. One reviewed
the file but flagged only the compound method question (a real defect, but not the one graded). One
did not review. A one-line instruction is weaker than the hook's checklist was.

# Round 14 (pre-registered): the review instruction with a six-item checklist

Same `edit` task and rubric, three runs. Passes at 2 of 3.

**Round 14 result: 3 of 3 PASS.** Every run flagged the direct timeliness comparison (and the compound
method question) while leaving them unchanged as out of scope. The checklist in the skill does the
hook's job, so the hook stays removed.
