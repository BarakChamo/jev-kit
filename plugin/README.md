# jev: write and measure Jev question maps

The Claude Code plugin inside [jev-kit](../README.md). [Jev](https://docs.typesafe.ai) is TypeSafe's System One
model: it takes one `state` and a map of typed questions (`noul`, `choice`, `score`), answers them all in one
pass, and never emits text. The plugin teaches agents the wording that works on Jev, then makes them measure.

## What's in it

| | what it does |
| --- | --- |
| **`jev-fit`** | Should this decision run on Jev at all? Four conditions, the shapes that win and lose, the disqualifiers, the cost at your volume |
| **`jev-questions`** | How to ask: 16 rules with their numbers, the map interface, a review checklist for existing maps, and a debugging order |
| **`jev-eval`** | How to measure: case design, the audit loop, whole-map grading, and when to trust a number |
| `jev-run.mjs` | runs a suite through Jev (TypeSafe's API or Vercel AI Gateway); `--map` grades a whole map; `--check` validates offline |
| `jev-audit.mjs` | offline, no key: confidently-wrong queue, calibration, top-2, gates per question, before/after `diff` |
| examples | a 50-case support-triage suite, and a 42-case renewal-notice suite with a map that scores 42/42, its generator, and a recorded run |

No hooks and no linter. Both were built, measured, and removed ([why](docs/how-it-was-built.md#6-what-was-built-and-removed)).

## Install

```text
/plugin marketplace add barakchamo/jev-kit
/plugin install jev@jev
```

Or from a checkout: `claude --plugin-dir ./plugin`. For other tools and install methods, see the
[kit README](../README.md#installation).

## Quick start

```bash
cd skills/jev-eval
node scripts/jev-run.mjs examples/renewal-notice.json --map examples/renewal-notice.map.mjs --check   # no key
TYPESAFE_API_KEY=... node scripts/jev-run.mjs examples/renewal-notice.json --map examples/renewal-notice.map.mjs
node scripts/jev-audit.mjs renewal-notice.map.jsonl
```

`AI_GATEWAY_API_KEY` works in place of `TYPESAFE_API_KEY`. Behind an HTTPS proxy, add `NODE_USE_ENV_PROXY=1`.

## Does it work?

In short: agent-written maps made far fewer wrong decisions with the plugin, on held-out tasks and for ten
authoring models, partly by sending more cases to a person. The kit README has the headline table, and
[docs/evals.md](../docs/evals.md) has every round with its caveats. How the research became the plugin:
**[docs/how-it-was-built.md](docs/how-it-was-built.md)**.

MIT licensed.
