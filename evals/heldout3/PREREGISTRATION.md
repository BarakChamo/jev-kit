# Third held-out task: pre-registration

Committed after the suite and its label audit, before any map was written.

## Why

In round 2, every wrong decision left on access-request (5 in 90, skill v4.2) was an admin request answered
"needs_approval" instead of "deny". `jev-audit` traced all of them to maps that ask Jev for the policy's outcome
(a `deny` noul, a `decision_under_policy` choice) instead of reading the facts the policy branches on and
applying the policy in code. The fix (skill v4.3) makes that explicit in the checklist and rule 12. access-request
was used to tune the skill, so the fix is tested on a new task of the same shape.

## Task (`gen.mjs`)

`data-export`: grant, needs_approval or deny a request to export a dataset. There's a six-rule written policy,
applied in order with the first match deciding. It uses two catalogs (dataset classification, destination type),
free phrasing, a second dataset sometimes mentioned as context, and claims of prior approval that don't count.
30 cases, gold by rule: 15 deny, 10 grant, 5 needs_approval. All 12 classification × destination combinations
appear.

Label audit (`label-audit.ts`, before any map): `zai/glm-5.3` agreed on 30/30.

## Arms

Claude Code agents (`../heldout2/run.sh`), the same prompt (`../heldout2/prompt.mjs`), 3 maps each:

| arm | skill |
| --- | --- |
| no plugin | — |
| plugin v4.2 | the skill before this change |
| plugin v4.3 | the skill with the change |

Plus a diagnostic that isn't held out: 3 v4.3 maps on access-request, compared with the 3 v4.2 maps from round 2.

## Measures

- Accuracy, wrong-decision rate and coverage, graded by `grade.mjs` through `jev-run`'s map interface.
- **Asks for the outcome** (design, no Jev calls): a map asks Jev for the policy's outcome when any question is a
  `choice` whose options include `grant` and `deny` (or `allow`/`deny`, `approved`/`denied`), or a `noul` whose
  instructions ask whether the request should be granted, denied, allowed or approved.

## Hypotheses (reported whatever the result)

1. v4.3 maps make at most 2 wrong decisions in 90 on data-export, and no more than v4.2 maps.
2. No v4.3 map asks Jev for the policy's outcome.
3. v4.3 accuracy is within 7 points of v4.2's, or higher.
4. Diagnostic: v4.3 access-request maps make fewer wrong decisions than v4.2's 5 in 90.

## Outcomes (appended after grading)

| hypothesis | result |
| --- | --- |
| 1. v4.3 at most 2 wrong in 90, and no more than v4.2 | **Passed, uninformatively**: v4.3 0/90, v4.2 0/90, no plugin 1/90. The task was at the ceiling for every arm. |
| 2. No v4.3 map asks for the outcome | **Failed as defined**: 1 of 3 v4.3 maps is flagged. Its flagged questions ask for the outcome per classification × destination with "ignore the specific request". That reads the policy table, not this request's outcome. |
| 3. v4.3 accuracy within 7 points of v4.2 | **Passed**: 100% and 100%. |
| 4. Access diagnostic: fewer wrong than v4.2's 5 in 90 | **Passed**: 1 in 90. It came from the one v4.3 map that still asks for this request's outcome (0.55). |

The design measure was implemented, then checked on round-2 access maps only, before any round-3 map was read. After
reading the round-3 flags, one noul ("Does the policy in `policy_text` state…") turned out to be about the policy,
not the request. It's reported as flagged here because that's what the committed measure returned.
