# Using the kit outside Claude Code

The skills are plain Markdown and the scripts are plain Node, so they work in any agent that reads skills or
follows instructions. This page covers Codex, Cursor and other agents, apps built on the AI SDK, and what was
measured with models other than Claude.

## Codex, Cursor and other agents

```bash
npx skills add barakchamo/jev-kit --agent codex -y     # → ./.agents/skills/jev-*/
npx skills add barakchamo/jev-kit --agent cursor -y    # → ./.agents/skills/jev-*/ as well
npx plugins add barakchamo/jev-kit --target codex -y   # → ~/.codex/plugins/…, registered in ~/.codex/config.toml
```

- **Install all three skills together.** `jev-questions` points to the worked example that ships with
  `jev-eval`, and `jev-eval` measures what `jev-questions` writes.
- **The scripts** are in `jev-eval/scripts/` inside wherever the skills landed. Run them by that path:
  `node .agents/skills/jev-eval/scripts/jev-run.mjs --help`.
- **`npx plugins --target cursor`** currently writes Claude Code's plugin files (`~/.claude/…`), not Cursor's.
  For Cursor, use `npx skills --agent cursor`.
- **If your agent doesn't pick skills up by itself,** point to them from `AGENTS.md`:

  ```md
  ## Jev
  Before writing or changing any Jev (TypeSafe System One) question map, read
  `.agents/skills/jev-questions/SKILL.md`. Before shipping one, follow `.agents/skills/jev-eval/SKILL.md`.
  To decide whether a decision belongs on Jev at all, read `.agents/skills/jev-fit/SKILL.md`.
  ```

Whether Codex or Cursor load the right skill unprompted hasn't been tested; the evaluations put the skill text in
the model's context directly.

## An AI SDK app that writes maps

To have a model write a map in one call, put the skill in the system prompt. This is how every non-Claude map in
the evaluations was written (`evals/heldout2/author.mjs`):

```js
import { readFileSync } from 'node:fs';
import { generateText } from 'ai';

const skill = ['jev-questions/SKILL.md', 'jev-questions/references/patterns.md']
  .map((p) => readFileSync(`plugin/skills/${p}`, 'utf8'))
  .join('\n\n');

const { text } = await generateText({
  model: 'deepseek/deepseek-v4-pro',          // any model; this id goes through Vercel AI Gateway
  system: `You are an expert software engineer. Answer with the complete contents of map.mjs in one js code block.\n\n` +
          `You have this skill for writing Jev question maps. Follow it.\n\n${skill}`,
  prompt: 'Write a Jev map that decides … The input has these fields: …',
  maxOutputTokens: 64000,
});
```

- **Don't stream through the gateway.** It caps how long a stream may run, and slow reasoning models hit the cap:
  GLM 5.3 lost 9 of 18 maps that way, and the same requests without streaming finished all 9 in 1–4 minutes.
- **Give it room:** maps written with the skill are about 40% longer. Use a 64k output budget.
- **Then run it before trusting it:** `jev-run suite.json --map map.mjs --check` loads the map, builds every case
  and runs `decide()` offline. A model that can't run its own code needs this step most.

## Calling Jev from an AI SDK app

There is no AI SDK provider for Jev's typed questions; call the HTTP API directly. A minimal client with timeouts,
retries and fail-closed handling is in [production](production.md#calling-it-safely). Use the AI SDK for the
cascade to an LLM on the cases Jev is unsure about.

## What was measured with other models

In round 2, nine models besides Claude wrote maps in one API call each, with and without the skill. Accuracy on
the maps that ran:

| author | without the skill | first version | v4.2 |
| --- | ---: | ---: | ---: |
| DeepSeek V4 Pro | 73.3% | 93.9% | 94.4% |
| Gemini 3.8 Flash | 58.9% | 93.3% | 92.8% |
| GLM 5.3 | 83.6% | 76.2% | 90.7% |
| Qwen 3.8 Max | 95.3% | 79.7% | 90.8% |
| GPT-5.6 Terra | 35.6% | 43.3% | — |
| Mistral Medium 3.5 | 61.1% | 50.0% | — |
| MiniMax M3 | 67.2% | 42.2% | — |

- **Wrong decisions fell for every author**, pooled over tasks, though partly because maps abstained more.
- **GPT, Mistral and MiniMax were only tested on the first version**, which made one-call authors abstain too
  often; that was fixed in v4.2 for the four models retested. GPT's first-version maps decided only 44% of cases.
  Retesting them on the current skill is open.
- **Some one-call maps didn't finish.** 6 of 42 panel maps with the skill were unusable, against none without.
  Claude Code agents, which run their own maps, had no such failures.
- **Only `jev-questions` was tested** with other models. `jev-fit` and `jev-eval` were exercised by Claude Code
  agents only.

Full tables: [evaluations](evals.md#other-vendors-models).
