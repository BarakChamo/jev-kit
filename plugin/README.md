# jev: write and measure Jev question maps

A Claude Code plugin for [Jev](https://docs.typesafe.ai), TypeSafe's System One model. Jev takes one
`state` and a map of typed questions (`noul`, `choice`, `score`), answers them all in one parallel
pass, and never emits text. It's cheap and fast enough for hot paths an LLM can't sit in, and it rewards a
different way of asking.

**Why a plugin:** in the research behind it, rewriting a question moved accuracy **30–40 points**, and
switching models moved it by a few. The plugin teaches agents to ask well, then makes them measure.

## What's in it

| | what it does |
| --- | --- |
| **`jev-fit`** | Should this decision run on Jev at all? Four gates, the shapes that win and lose, the disqualifiers, the economics |
| **`jev-questions`** | How to ask: 16 rules with their numbers, the map interface, a review checklist for existing maps, and a debugging order |
| **`jev-eval`** | How to measure: case design, the audit loop, whole-map grading, and when to trust a number |
| `jev-run.mjs` | runs a suite through Jev; `--map` grades a whole map end to end; `--check` validates offline |
| `jev-audit.mjs` | offline, no key: confidently-wrong queue, calibration, top-2, a fitted gate, before/after `diff` |
| examples | a 50-case support-triage suite, and a 30-case renewal-notice suite with a map that scores 30/30 |

No hooks and no linter. Both were built, measured, and removed ([why](docs/how-it-was-built.md#6-what-was-built-and-removed)).

## Install

```bash
/plugin marketplace add barakchamo/jev-kit
/plugin install jev@jev
```

Or from a checkout: `claude --plugin-dir ./plugin`. For other tools, `npx plugins add barakchamo/jev-kit`
installs the plugin and `npx skills add barakchamo/jev-kit` copies the skills. See the
[root README](../README.md#installation).

## Quick start

```bash
cd skills/jev-eval
node scripts/jev-run.mjs examples/renewal-notice.json --map examples/renewal-notice.map.mjs --check
AI_GATEWAY_API_KEY=... node scripts/jev-run.mjs examples/renewal-notice.json --map examples/renewal-notice.map.mjs
node scripts/jev-audit.mjs renewal-notice.map.jsonl
```

Behind an HTTPS proxy, add `NODE_USE_ENV_PROXY=1`.

## Does it work?

Agent-written maps graded on Jev accuracy, with and without the plugin:

| task | no plugin | with the plugin |
| --- | ---: | ---: |
| renewal notice | 69.2% | **91.7%**, 0 wrong decisions |
| CI retry: wrong decisions | 20.0% | **3.3%** |
| culprit log line: wrong decisions | 13.3% | **0%** (13.3% in a later re-check\*) |
| *held out:* reply-exposure | 84–88% | **97–98%** |
| *held out:* alert-routing | 100% | 100% |
| *held out:* expense-review | 92–94% | **97–100%** |
| *held out, round 2:* sla-breach | 60.0%, 15.6% wrong | **94.4%**, 1.1% wrong |
| *held out, round 2:* culprit, clause-locator, access | 67–97% | 84–93% (access: 84.4%, 5.6% wrong, all cautious) |
| *other vendors, one API call:* GLM 5.3, Qwen 3.8 Max, Gemini 3.8 Flash, DeepSeek V4 Pro | wrong decisions up to 11.4% | **91–94%** on maps that ran, wrong ≈ 0 |

\* The re-check's misses were a failing test's name picked over its assertion. The maps' rubric
allowed that, and an independent reviewer accepted it in 5 of 6 cases.

It didn't start there. The first version made culprit maps *worse* (45.8% wrong decisions), and the
fixes came from reading what Jev answered. How the research became the plugin, every round of
measurement, and the limits: **[docs/how-it-was-built.md](docs/how-it-was-built.md)**.

## Using it with a one-shot author

An agent that can run its map (Claude Code) catches its own broken code. A model asked for the whole map in
one call cannot. With the skill, maps are about 40% longer, and slow reasoning models can take many minutes.
- Through the AI Gateway, use a non-streaming request. The gateway caps how long a stream may run: GLM 5.3 hit
  that cap on 9 of 18 maps, and the same requests without streaming finished all 9 in 1–4 minutes.
- Give a one-shot author a large output budget (64k).
- Load the map and run it on one case before trusting it. `jev-run --map` reports a map that fails to load.

## Caveats

- One author wrote the suites, labels and rules. LLM relabelling agreed 83–98%.
- 2–12 maps per comparison. Gaps under ~7 points are noise. Re-grading the same maps moved accuracy by up to 2.2 points.
- Prices and latencies are as measured in 2026 through Vercel AI Gateway.

MIT licensed.
