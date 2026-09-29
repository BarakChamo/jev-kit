# Evaluations: the evidence

Every suite, recorded result and grading script behind the kit's numbers. What each round found is in
[docs/evals.md](../docs/evals.md); this page says what is where and what you can re-run.

| folder | what it is | read first |
| --- | --- | --- |
| [`support-triage/`](support-triage) | an example suite from the study, with Jev and LLM results | `suite.json`, `results/` |
| [`jagged-probes/`](jagged-probes) | capability-boundary probes from the study | `suite.json`, `results/` |
| [`plugin-ab/`](plugin-ab) | design A/B: agents with and without the plugin, 76 runs over 14 rounds | [README](plugin-ab/README.md), `rubric.md` |
| [`plugin-accuracy/`](plugin-accuracy) | those maps graded on Jev | [README](plugin-accuracy/README.md), `analysis.txt` |
| [`heldout/`](heldout) | round 1 of held-out tasks | [README](heldout/README.md) |
| [`heldout2/`](heldout2) | round 2: ten authoring models | [README](heldout2/README.md) |
| [`heldout3/`](heldout3) | round 3: policy outcomes (skill v4.3) | [README](heldout3/README.md) |
| [`heldout4/`](heldout4) | round 4: the hard procurement task | [README](heldout4/README.md) |
| [`rule-probes/`](rule-probes) | ten rules tested in three new domains each | [README](rule-probes/README.md) |
| [`lib/`](lib) | the LLM client the label audits use | — |

Each round folder has its suites, a `PREREGISTRATION.md` with outcomes appended, `results.*.json` (every case,
every answer), a summary script, and, for rounds 2–4, every map as code in `maps*/<map>/map.mjs` with the
`SKILL_VERSION` it was written under. The agents' transcripts and raw responses aren't published.

## Run without a key

```bash
# audit recorded results
node ../plugin/skills/jev-eval/scripts/jev-audit.mjs support-triage/results/jev.jsonl --holdout 0.5
node ../plugin/skills/jev-eval/scripts/jev-audit.mjs heldout2/access-request-plugin-2.map.jsonl

# check any published map against its suite: builds every case, runs decide() on synthetic answers
node ../plugin/skills/jev-eval/scripts/jev-run.mjs heldout4/procurement.json --map heldout4/maps-cc-v43/procurement-plugin-1-claude/map.mjs --check

# round 1's grader with a fake Jev (shapes only, meaningless values)
cd heldout && node grade.mjs maps/alert-routing-base-1 --mock

# regenerate suites and summaries
node heldout/gen.mjs && node heldout4/gen.mjs && python3 heldout4/summarise.py
```

## Run with a key

Set `TYPESAFE_API_KEY` or `AI_GATEWAY_API_KEY`, or put it in `.env.local` at the kit root (the scripts read
`../../.env.local`).

- **Re-grade maps:** `node heldout2/grade.mjs heldout2/maps-v42/<map> --out results.json`. `heldout2/grade.mjs`
  grades rounds 2–4 (it knows every task).
- **Rule probes:** `node rule-probes/probes.mjs`.
- **Label audits** (`label-audit.ts`) call an LLM through Vercel AI Gateway: `npm install` at the kit root, then
  `node --import tsx heldout4/label-audit.ts`.
- **Writing new maps** needs an agent: `heldout2/run.sh` drives Claude Code (`claude -p`) with `REPO` set to the
  kit root, and `heldout2/author.mjs` asks any AI SDK model for a map in one call.

## Known gaps

- The study's own write-up and its 57 suites aren't published; two suites are, as examples. The rules cite the
  study's numbers, and [docs/rules.md](../docs/rules.md) says which rules were re-tested in public evaluations.
- One round-2 map is withheld because its comments name unpublished material: `heldout2/maps-withheld.md`.
- `heldout/run.sh` and `heldout2/run.sh` fall back to picking up a map from Claude Code's scratchpad folder when an
  agent wrote it there; that path is specific to the environment the rounds ran in.
