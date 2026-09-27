# jev-kit: write and measure Jev question maps

Measured best practices and evaluation tools for [Jev](https://docs.typesafe.ai), TypeSafe's System One
model, packaged as a Claude Code plugin.

| | |
| --- | --- |
| **the research** | 57 hand-labelled suites, 1,836 cases, a cheap LLM and a frontier model as comparators |
| **its biggest finding** | rewriting a question moved accuracy 30–40 points; switching models moved it by a few |
| **the plugin's measured effect** | on the held-out tasks with headroom, agent-written maps went from 84–94% to 97–100% |

## What is here

| | |
| --- | --- |
| [`plugin/`](plugin) | three skills (`jev-fit`, `jev-questions`, `jev-eval`) and two zero-dependency scripts. [README](plugin/README.md) |
| [`plugin/docs/how-it-was-built.md`](plugin/docs/how-it-was-built.md) | **how the research became the plugin**, and every round of measurement that corrected it |
| [`audit/`](audit) | `jev-audit` as a library and CLI. Offline, no API key |
| [`evals/`](evals) | example suites with recorded results, and the plugin's own evaluations (`plugin-ab`, `plugin-accuracy`, `heldout`) |

## Install

```bash
/plugin marketplace add <owner>/<repo>
/plugin install jev@jev
```

## Try it without a key

```bash
node plugin/skills/jev-eval/scripts/jev-audit.mjs evals/support-triage/results/jev.jsonl
node plugin/skills/jev-eval/scripts/jev-audit.mjs diff evals/support-triage/results/glm-oneshot.jsonl evals/support-triage/results/jev.jsonl
```

## Read

| question | read |
| --- | --- |
| should this decision run on Jev? | [jev-fit](plugin/skills/jev-fit/SKILL.md) |
| how do I write the questions? | [jev-questions](plugin/skills/jev-questions/SKILL.md) · [the evidence for every rule](plugin/skills/jev-questions/references/rules.md) · [patterns with code](plugin/skills/jev-questions/references/patterns.md) |
| how do I know it works? | [jev-eval](plugin/skills/jev-eval/SKILL.md) · [suite format](plugin/skills/jev-eval/references/suite-format.md) |
| why should I believe any of it? | [how it was built](plugin/docs/how-it-was-built.md) |

## Publishing

- **The plugin:** push this directory to a public repository, and `/plugin marketplace add <owner>/<repo>` installs it.
- **The audit library** (`audit/`, built to `dist/` with types): `cd audit && npm publish --access public` with your npm login.

MIT licensed.
