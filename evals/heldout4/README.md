# Fourth held-out task: a hard policy decision, and the latest non-Anthropic models

> **In short.**
> - **A task that separates the arms.** `procurement` has five outcomes, ordered rules with an exception, currency
>   conversion near every threshold, vendor aliases, and distractor amounts. Maps without the plugin averaged 76.9%.
>   The round-3 task was at the ceiling.
> - **With the skill, wrong decisions nearly vanished:** 52 in 576 without the plugin, 3 in 864 with it.
> - **v4.3 beat v4.2 on accuracy for every author whose maps ran:** Claude Code 84.0% → 99.3%, DeepSeek V4 Pro
>   90.3% → 96.5%, GLM 5.3 59.7% → 68.1%. Both versions made almost no wrong decisions (1 and 2 in 432), so the gain is
>   decisions made rather than errors avoided.
> - **Most failed maps were a gateway limit, not the models.** GLM's "no code" failures were the gateway's cap on
>   stream duration. One non-streaming retry recovered all 9. Qwen 3.8 Max with the skill didn't finish any of 8
>   maps within 30 minutes, even without streaming.

Hypotheses and pass bars: [PREREGISTRATION.md](PREREGISTRATION.md), with outcomes appended.

## Task

`procurement`: approve, needs_manager, needs_finance, needs_security or reject a purchase request.
- **Policy:** six rules in order, where the first match decides.
  1. Blocked vendor: reject.
  2. Software from a vendor not on the approved-software list: security review.
  3. Above $50,000: reject, unless the requester is a director (then finance).
  4. Above $10,000: finance.
  5. Above $1,000: manager.
  6. Anything else: approve.
- **Amounts:** in USD, EUR, GBP or JPY, at given rates. 27 of 48 land within 2% of a threshold after conversion.
- **Distractors:** vendors named by alias, last year's amount mentioned in some requests, and approval claims that don't count.
- **Gold:** by rule in `gen.mjs`. GLM 5.3 relabelled all 48 from the rules and agreed on every one.

## Models used

| author | how | maps |
| --- | --- | ---: |
| Claude Code agent (session default) | `../heldout2/run.sh` | 9 |
| `zai/glm-5.3` | `../heldout2/author.mjs`, one call, 64k output; failed maps retried once without streaming | 18 + 12 retries |
| `alibaba/qwen3.8-max-0902` | same | 18 + 8 retries |
| `deepseek/deepseek-v4-pro-0813` | same | 18 |
| subject | `typesafe-ai/jev` | — |

v4.2 is the skill at `32d605f`; v4.3 is the commit in each `SKILL_VERSION`.

## Procurement results

"Loaded" leaves out maps that produced no code. Retried maps replace their failed first attempt; `summary.md` has
the full table.

| author | no plugin | v4.2 | v4.3 |
| --- | ---: | ---: | ---: |
| Claude Code | 67.4% · 8 wrong | 84.0% · 0 wrong | **99.3% · 0 wrong** |
| DeepSeek V4 Pro (0813) | 82.6% · 18 wrong | 90.3% · 1 wrong | **96.5% · 0 wrong** |
| GLM 5.3 | 74.3% · 16 wrong | 59.7% · 0 wrong | 68.1% · 2 wrong |
| Qwen 3.8 Max (0902) | 83.3% · 10 wrong | no code (3 of 3) | no code (3 of 3) |
| **all authors, loaded** | 76.9% · 52 / 576 | 78.0% · 1 / 432 | **88.0% · 2 / 432** |

- **Without the plugin**, two of three Claude Code maps asked Jev for the outcome directly. No plugin map did,
  under either version.
- **GLM's plugin maps abstain rather than err.** On the maps that abstain most, the least certain answer is
  usually "is this purchase software?", at 0.5–0.8, for items like a monitoring-service subscription from a
  consulting vendor. One map also reads the amount as a band, which rule 9 warns against. None of these abstentions
  are wrong decisions.

## Earlier tasks: v4.3 against round 2's v4.2, same models

Loaded accuracy (wrong decisions). Both versions made **no wrong decisions on any of these tasks**.

| author | sla-breach | culprit | access-request |
| --- | --- | --- | --- |
| GLM 5.3 | — → 56.7% (2 of 3 maps ran) | 83.3% → 75.6% | 100% → 100% |
| Qwen 3.8 Max (0902) | 93.3% → 93.3% | 78.9% → 84.4% | 94.4% → 100% |
| DeepSeek V4 Pro | 93.3% → 93.3% | 90.0% → 84.4% | 100% → 98.9% |

Round 2's DeepSeek maps used `deepseek-v4-pro`. This round's used the newer `-0813` weights.

## Why single-call maps failed

| model | first attempt, no code | after one non-streaming retry |
| --- | ---: | ---: |
| GLM 5.3 | 9 of 18 | 0 of 18 |
| Qwen 3.8 Max (0902) | 8 of 18 | 8 of 18 |
| DeepSeek V4 Pro (0813) | 0 of 18 | — |

- **GLM:** every GLM first-attempt failure was "Stream exceeded maximum duration before function timeout", a
  gateway limit. The same request without streaming finished in 1–4 minutes.
- **Qwen:** its retries ran into our 30-minute limit.
- **Revised finding:** round 2's advice to give single-call authors a large output budget holds, but for GLM the
  cause was the stream limit, not the budget.

## Limitations

- 3 maps per author and arm. Qwen produced no plugin maps, so it contributes only to the no-plugin arm on procurement.
- The retry wasn't pre-registered. It's reported separately, and the first attempts are in `results.*.json`.

## Reproduce

```bash
node gen.mjs
REPO=<repo> OUT=maps-cc-v43 ../heldout2/run.sh procurement plugin 1
MAX_OUTPUT=64000 node --env-file=../../../.env.local ../heldout2/author.mjs procurement plugin zai/glm-5.3 1 maps-api-v43
STREAM=0 MAX_OUTPUT=64000 node --env-file=../../../.env.local ../heldout2/author.mjs ...   # the retry
node --env-file=../../../.env.local ../heldout2/grade.mjs maps-api-v43/* --out results.api-v43.json
python3 summarise.py
node ../heldout3/design.mjs maps-cc-base maps-cc-v42 maps-cc-v43
```
