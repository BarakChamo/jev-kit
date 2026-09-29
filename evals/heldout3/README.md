# Third held-out task: asking Jev for a policy's outcome

> **In short.**
> - **What was tested:** skill v4.3, which tells agents never to ask Jev for a written policy's outcome. It was tested on a new task
>   (`data-export`) and re-checked on access-request.
> - **On the new task, every arm scored 89–90 of 90.** Too easy to separate v4.3 from v4.2.
> - **On access-request, v4.3 maps made 1 wrong decision in 90**, against 5 for v4.2. That task was already used for tuning, so treat it as a
>   diagnostic.
> - **Across both tasks, every wrong decision by a plugin map came from a map that asked Jev for this request's
>   outcome:** 6 of 6. Maps that read the facts, or read the policy table, made none in 270 cases.

Hypotheses and pass bars: [PREREGISTRATION.md](PREREGISTRATION.md), with outcomes appended.

## Task

`data-export`: grant, needs_approval or deny a request to export a dataset.
- **Policy:** six written rules, applied in order, where the first match decides.
- **Catalogs:** dataset classification, and destination type.
- **Requests:** phrased freely. Some mention a second dataset as context, and some claim an approval that doesn't count.
- **Cases:** 30, with gold computed by rule in `gen.mjs`. GLM 5.3 relabelled all 30 from the rules and agreed on every one (`label-audit.json`).

## Results

Claude Code agents, 3 maps per arm, graded end to end on Jev.

| task | arm | right | wrong | abstain |
| --- | --- | ---: | ---: | ---: |
| data-export | no plugin | 89 | 1 | 0 |
| | plugin v4.2 | 90 | 0 | 0 |
| | plugin v4.3 | 90 | 0 | 0 |
| access-request (diagnostic) | plugin v4.2 (round 2) | 76 | 5 | 9 |
| | plugin v4.3 | 88 | 1 | 1 |

## What the maps ask

`design.mjs` loads each map and checks every question on every case. It doesn't call Jev. The pre-registered measure flags any outcome
question. The split below separates questions about **this request** from questions that read the
**policy table** ("ignore the specific request; what is the outcome for restricted data to an internal system?"). That split is post hoc.

| maps | this request's outcome | policy table only | facts only | wrong decisions |
| --- | ---: | ---: | ---: | ---: |
| data-export, no plugin | 3 | 0 | 0 | 1 / 90 |
| data-export, v4.2 | 0 | 3 | 0 | 0 / 90 |
| data-export, v4.3 | 0 | 1 | 2 | 0 / 90 |
| access-request, v4.2 | 2 | 0 | 1 | 5 / 90, all from the 2 maps asking for the outcome |
| access-request, v4.3 | 1 | 1 | 1 | 1 / 90, from the map asking for the outcome (at 0.55) |

`jev-audit` on the access maps names the outcome question as the weakest answer behind every wrong decision.

## What changed in the skill

- **v4.3:**
  - a checklist item: never ask Jev for a written policy's outcome; ask for the facts the rules branch on, and apply the rules in code;
  - evidence added to rule 12;
  - a new pattern, "Apply a written policy in code", using a deploy-freeze example so it doesn't hand either test task its answer.
- **After this round:** a note that reading the policy table (a constant, independent of the request) is fine, and should be done once and pinned.

## Limitations

- data-export was at the ceiling for every arm, so it can't show that v4.3 improves on v4.2. The
  access-request gain is on a task already used for tuning.
- 3 maps per cell, one agent model.

## Reproduce

```bash
node gen.mjs
REPO=<repo> OUT=maps-v43 ../heldout2/run.sh data-export plugin 1       # a Claude Code author
node --env-file=../../.env.local ../heldout2/grade.mjs maps-v43/* --out results.v43.json
node design.mjs maps-base maps-v42 maps-v43 maps-access-v43
```
