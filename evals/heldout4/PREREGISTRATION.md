# Fourth held-out task and the latest non-Anthropic models: pre-registration

Committed after the suite and its label audit, before any map was written.

## Why

- **The round-3 task was too easy.** Every arm scored 89–90 of 90, so it couldn't show whether skill v4.3 (never ask
  Jev for a written policy's outcome) improves on v4.2.
- **The easy tasks are a pattern.** Several earlier held-out tasks were near the ceiling too (alert-routing, clause-locator).
- **Other vendors lag a version.** They were last tested on v4.2.

This round adds a task built to be hard, and tests the latest GLM, Qwen and DeepSeek models on v4.3.

## Task (`gen.mjs`): procurement

Decide approve, needs_manager, needs_finance, needs_security or reject for a purchase request.
- **Policy:** six written rules applied in order, first match deciding. A software rule applies before the amount
  rules. Two amount thresholds, then a rejection threshold with an exception for directors.
- **Amounts:** in USD, EUR, GBP or JPY, converted at given rates. 27 of 48 land within 2% of a threshold after
  conversion.
- **Distractors:** vendors named by alias, a second (last year's) amount in some requests, and claims of approval
  that don't count.
- **Labels:** 48 cases, gold by rule: 13 needs_finance, 12 reject, 9 needs_security, 7 needs_manager, 7 approve.

Label audit (`label-audit.ts`, before any map): `zai/glm-5.3` agreed on 48/48.

## Authors and arms

| author | how | arms on procurement |
| --- | --- | --- |
| Claude Code agent | `../heldout2/run.sh` | no plugin, v4.2, v4.3 (3 maps each) |
| `zai/glm-5.3` | `../heldout2/author.mjs`, one call, 64k output | no plugin, v4.2, v4.3 (3 maps each) |
| `alibaba/qwen3.8-max-0902` | same | same |
| `deepseek/deepseek-v4-pro-0813` | same | same |

- **v4.2** is the skill at commit `32d605f`; **v4.3** is the skill at the commit in `SKILL_VERSION`.
- **Also:** 3 v4.3 maps from each of the three API models on sla-breach, culprit and access-request. They're compared with
  the same models' v4.2 maps from round 2. Round 2 used `deepseek/deepseek-v4-pro`, before the 0813 weights.

## Hypotheses (reported whatever the result)

1. **Difficulty (the task is not at the ceiling):** no-plugin maps average below 90% accuracy on procurement.
2. Plugin maps (v4.2 and v4.3 pooled) make fewer wrong decisions than no-plugin maps on procurement, pooled over
   authors.
3. v4.3 maps make fewer wrong decisions than v4.2 maps on procurement, pooled over authors, with accuracy within 7
   points or higher.
4. Fewer v4.3 maps than v4.2 maps ask Jev for this request's outcome (`../heldout3/design.mjs`).
5. For GLM, Qwen and DeepSeek on sla-breach, culprit and access-request, v4.3 makes no more wrong decisions than
   v4.2, with accuracy on loaded maps within 7 points or higher.

Maps that produce no code or fail to load count as failures in accuracy, and are reported separately.

## Outcomes (appended after grading)

| hypothesis | result |
| --- | --- |
| 1. No-plugin maps average below 90% on procurement | **Passed**: 76.9% (loaded, all authors). The task separates the arms. |
| 2. Plugin maps make fewer wrong decisions than no-plugin maps | **Passed**: 3 in 864 against 52 in 576. |
| 3. v4.3 fewer wrong decisions than v4.2, accuracy within 7 or higher | **Failed on the first part**: 2 against 1 in 432; both near zero. **Accuracy higher**: 88.0% against 78.0% (loaded), and higher for each author whose maps ran. |
| 4. Fewer v4.3 than v4.2 maps ask for the outcome | **Failed as written**: 0 and 0. Two of three no-plugin Claude Code maps asked for it. |
| 5. GLM, Qwen, DeepSeek on earlier tasks: v4.3 no more wrong than v4.2, accuracy within 7 | **Wrong decisions: passed** (0 everywhere). **Accuracy: passed except GLM on culprit** (−7.7 points). |

Not pre-registered: maps with no code were retried once without streaming. GLM recovered 9 of 9, Qwen 0 of 8.
The first attempts are in `results.*.json`, and the retries in `results.*-retry.json`.
