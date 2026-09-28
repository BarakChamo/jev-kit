# Second held-out round: pre-registration

Committed before any author, of any model, wrote a map for these tasks.

## Suites (`gen.mjs`)

| task | decision | exercises rules |
| --- | --- | --- |
| `sla-breach` | was the first-response SLA breached? | 8, 9, 12, 16: business-hours arithmetic, holidays, the opening priority, agent vs customer messages in a free-text log |
| `refund-eligibility` | is the requested item returnable? | 7, 8, 9, 10: pick the item from the message, "opened but defective", windows counted inclusively, final sale |
| `access-request` | grant / needs_approval / deny | 6, 12, 15: catalog lookup, free phrasing of access levels, claims of prior approval |
| `clause-locator` | which section sets a term? | 10: pick one of 12 sections, some untitled, with cross-reference distractors |
| `culprit` | the log line that states the cause | 10, 16: re-run of item 4; gold = original labels plus the reviewer-accepted lines, fixed now |

30 cases each, gold computed by rule.

## Label audit (`label-audit.ts`, run before any map)

| reviewer | sla-breach | refund-eligibility | access-request | clause-locator |
| --- | ---: | ---: | ---: | ---: |
| `zai/glm-5.3` | 30/30 | 30/30 | 30/30 | 29/29 (1 unparsed) |
| `alibaba/qwen3.8-max-0902` | 19/30 | 26/30 | 23/30 | 30/30 |

Every Qwen disagreement read was Qwen's error, often its answer contradicting its own reasoning (for
example, "20 minutes past the 13:00 deadline" then "no"; "rule 2 does not apply here" then "deny").
The labels stand. Qwen 3.8 Max is recorded as an unreliable labeller for date and policy arithmetic.

## Authors and arms

| author | how | models |
| --- | --- | --- |
| Claude Code agent | `run.sh`: `claude -p` in an empty directory, `--plugin-dir plugin` in the plugin arm | the session default |
| GLM | `author.mjs`: one API call; the plugin arm has `jev-questions/SKILL.md` and `references/patterns.md` in the system prompt | `zai/glm-5.3` |
| Qwen | same | `alibaba/qwen3.8-max-0902` |

Three maps per task, arm and author. The same prompt everywhere (`prompt.mjs`). Every map is graded by
`grade.mjs` through `jev-run`'s map interface, with no adapters. A map that fails to load counts as
0 right on every case. It is reported, not fixed.

## Hypotheses (reported whatever the result)

1. For each task and author, the plugin arm has a lower mean wrong-decision rate and a higher mean
   accuracy than the base arm.
2. **Item 4, culprit:** the Claude plugin maps make at most 5% wrong decisions against the pre-registered
   gold.
3. **Item 5, Sonnet on expense-review:** four more runs per arm with the original held-out prompt
   (`../heldout/run.sh`), pooled with the earlier three. Does the plugin arm's wrong-decision rate stay
   above the base arm's once n = 7 per arm?

## Addendum (2026-09-26, before any v4 map is graded): skill v4 against v3

The gateway ran out of credit at 16:32 UTC. While it was down, Claude Code agents wrote 9 maps with
skill v4 (commit in `maps-v4/SKILL_VERSION`). That is the plugin arm, 3 reps each, for sla-breach,
refund-eligibility and culprit, with the same prompt as round 2. v4 changed rule 8 (narrowed to
computed sides) and rule 13 (gates fitted per question, no gating on questions about the policy, and a
fixed policy's constants pinned).

Compared with the v3 Claude plugin maps (`maps/`), graded by `resume.sh` into `results.v4.json`:

4. **Fewer over-gated maps.** v3 had two maps that abstained on 24+ of 30 (culprit plugin-1,
   refund plugin-3). v4 has none with 20 or more abstentions.
5. **No loss on wrong decisions.** v4's wrong-decision rate is within 2 points of v3's on each task
   (v3: sla 1/90, refund 0/90, culprit 0/90).

With 3 maps per cell, a gap under ~7 points in accuracy is not evidence either way.

## Outcomes (appended after grading)

| hypothesis | result |
| --- | --- |
| 1. plugin arm: fewer wrong decisions, higher accuracy, per task and author | **Wrong decisions: held** for every author family where both arms ran (Claude, GLM, Qwen, the panel). **Accuracy: mixed under v3.** Claude up on 3 of 5 tasks; the panel up on all 3 counting maps that ran; GLM and Qwen down (over-abstention). |
| 2. item 4: Claude culprit plugin maps ≤ 5% wrong | **Passed**: 0/90 (v3), 0/90 (v4), 0/90 (v4.2) |
| 3. item 5: Sonnet expense, n = 7 per arm | The plugin stays above baseline on wrong decisions by 0.7–1.9 points, all cautious, at higher accuracy (see `../heldout/README.md`) |
| 4. v4: no map abstains on 20+ of 30 | **Passed**: at most 4 |
| 5. v4: wrong decisions within 2 points of v3, per task | **Failed on refund**: 3.3% against 0% (gift cards approved: no field for the exclusion). This led to v4.1 and v4.2. sla and culprit passed. |
