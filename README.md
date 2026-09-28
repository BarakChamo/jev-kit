# jev-kit

**Get your coding agent to write [Jev](https://docs.typesafe.ai) questions that work the first time.**

[Installation](#installation) · [Quick start](#quick-start) · [Using the skills](#using-the-skills) · [Using the scripts](#using-the-scripts) · [Use cases](docs/use-cases.md) · [Rules](docs/rules.md) · [Evaluations](docs/evals.md)

Jev, TypeSafe's System One model, answers typed questions about your data for a fraction of what an LLM costs.
It is 20–100× cheaper than a small LLM (`zai/glm-5.3-flash`), answers in ~600 ms, and returned no malformed output in ~1,900 calls. The catch is that
it depends heavily on wording. In a study of 57 labelled decision suites, rewriting a single question moved
accuracy by **30–40 points**, several times more than switching between Jev and an LLM.

jev-kit is a Claude Code plugin that teaches your agent the wording that works on Jev, then makes it measure
the result. Maps that Claude Code agents wrote with and without it, graded on Jev:

| task | without the plugin | with it |
| --- | ---: | ---: |
| Did this ticket breach its SLA? (wrong decisions) | 15.6% | **1.1%** |
| Which log line caused the CI failure? (wrong decisions) | 13.3% | **0%** |
| Was the renewal notice on time? (accuracy) | 69.2% | **91.7%** |
| Does this reply expose someone's personal data? (accuracy, held-out task) | 84–88% | **97–98%** |

The effect isn't limited to Claude. Nine other models wrote maps too, including GPT, Gemini, DeepSeek, GLM and
Qwen. With the skill, wrong decisions fell for eight of them. The ninth made none either way.

## Why this exists

Jev fails differently from an LLM, and it fails silently. The wording an agent reaches for by habit is often
the wording Jev gets wrong:

- **Ask "was the SLA breached?"** and Jev has to compute a deadline and compare against it in one step, which
  it can't do reliably. Agents' maps without the plugin asked exactly that, and made 14 wrong decisions in 90
  cases. Maps that read the timestamps and compared in code made 1.
- **Leave out one fact the decision needs**, and Jev answers anyway. One question gave zero recall on a whole
  class, at 0.99 confidence.
- **Give a question a key like `unsafe_to_revert`** while its criteria say the opposite, and an LLM follows the
  key. Jev never reads keys, so it follows the criteria. The same question scored 100% on an LLM and 0% on Jev.

A quick review doesn't catch any of this, but measuring does. Each of the 16 rules in this kit
comes from reading cases Jev got wrong with high confidence. A rule was kept only if it held on a second task.
The skills were then tested on agent-written maps, on held-out tasks and on ten authoring models. Every suite,
result and evaluation is included, so you can check them yourself.

The kit contains:

- **Three skills:** `jev-fit` (should this run on Jev?), `jev-questions` (how to ask), and `jev-eval` (how
  to measure).
- **Two scripts** with no dependencies: `jev-run` sends a labelled suite or a whole map through Jev.
  `jev-audit` analyses the recorded answers offline.
- **The evidence:** labelled suites, recorded results, and every evaluation of the skills themselves.

## Installation

Pick one of three ways. All of them install the same three skills.

| method | installs into | use it when |
| --- | --- | --- |
| [Claude Code marketplace](#claude-code-marketplace) | Claude Code, as the `jev` plugin | you use Claude Code |
| [`npx plugins`](#npx-plugins) | Claude Code, Cursor, Codex, VS Code, GitHub Copilot CLI, and other plugin-aware tools | you want the plugin in several tools at once |
| [`npx skills`](#npx-skills) | the skills folder of 70+ agents | your agent reads skills but not plugins |

### Claude Code marketplace

```bash
/plugin marketplace add barakchamo/jev-kit
/plugin install jev@jev
```

### `npx plugins`

[`plugins`](https://www.npmjs.com/package/plugins) installs the plugin into every supported tool it detects on
your machine:

```bash
npx plugins add barakchamo/jev-kit                        # every detected tool
npx plugins add barakchamo/jev-kit --target claude-code   # one tool
npx plugins targets                                       # list supported tools
```

Restart your agent afterwards. The skills load as `jev:jev-fit`, `jev:jev-questions`, and `jev:jev-eval`. To
remove the plugin from Claude Code, run `claude plugin uninstall jev@jev` and `claude plugin marketplace remove jev`.

### `npx skills`

[`skills`](https://www.npmjs.com/package/skills) copies the skill folders into your agent's skills directory,
for example `.claude/skills/` for Claude Code or `.agents/skills/` for Codex:

```bash
npx skills add barakchamo/jev-kit                         # choose agents and skills interactively
npx skills add barakchamo/jev-kit --agent claude-code -y  # one agent, no prompts
npx skills add barakchamo/jev-kit --skill jev-questions   # one skill
npx skills add barakchamo/jev-kit --list                  # list the skills without installing
```

It installs into the current project. Add `-g` to install for your user. The scripts come with the skills: after
this install they are in `<skills directory>/jev-eval/scripts/`.

### Requirements

The scripts need Node.js 18 or later. To call Jev, set a [Vercel AI Gateway](https://vercel.com/ai-gateway) key:

```bash
export AI_GATEWAY_API_KEY=...
```

## Quick start

From a clone of this repository, with `AI_GATEWAY_API_KEY` set, run the bundled example. It's a map that
decides whether a contract renewal notice arrived in time:

```bash
cd plugin/skills/jev-eval
node scripts/jev-run.mjs examples/renewal-notice.json --map examples/renewal-notice.map.mjs
```

```text
wrote renewal-notice.map.jsonl: 30 answered, 0 failed · 39223 input tokens · $0.00165 at list price · p50 250 ms · p95 804 ms
outcome: accuracy 100.0% · wrong 0/30 · abstain 0 · coverage 100.0%
```

Then ask your agent to build one for your own decision:

```text
Write a Jev map that decides whether a support ticket breached its first-response SLA.
The policy and some example tickets are in fixtures/.
```

## Using the skills

The three skills follow the order you'd build a decision in. You don't call them by name. Describe the task,
and the agent loads the skill that matches.

| step | skill | ask for | you get |
| --- | --- | --- | --- |
| 1. Decide | `jev-fit` | whether a decision belongs on Jev | a verdict: Jev, Jev with a fallback, an LLM, or plain code, with the expected accuracy gap and cost |
| 2. Write | `jev-questions` | a new map, or a review of an existing one | `map.mjs`, written to the 16 rules, or a list of rule violations |
| 3. Measure | `jev-eval` | a test suite, a grade, or a threshold | a labelled suite, graded results, and a fitted confidence gate |

### 1. Decide whether to use Jev

```text
We route 40k support tickets a day to one of 12 teams with GPT. Should this run on Jev instead?
```

The agent checks four conditions: a bounded answer, evidence that fits in the request, volume or latency
pressure, and a safe fallback for unsure cases. It predicts the accuracy gap from the decision's shape, flags
anything that rules Jev out, and estimates the cost at your volume. [When Jev fits](docs/use-cases.md#when-to-use-jev).

### 2. Write or fix a map

```text
Write a Jev map that decides whether a refund request is eligible under policy.md.
```

```text
Review src/triage/map.mjs against the Jev rules. It asks "should we retry this job?".
```

The agent writes one small, present-tense question per fact, and keeps arithmetic and policy in code. It gates
each decision on a probability, and runs the skill's review checklist before it finishes. [Worked examples](docs/use-cases.md#examples).

### 3. Measure it

```text
Build a 30-case labelled suite for the refund map, grade it on Jev, and fit a threshold for 95% precision.
```

```text
Our culprit-line field is 71% accurate. Find out why and fix it.
```

The agent writes cases that include the hard ones, grades the whole map with `jev-run`, and reads every answer
Jev got wrong while confident. It then fits a gate with `jev-audit` and compares versions with a diff. It
doesn't call a change an improvement unless the diff shows one.

## Using the scripts

The scripts are in `plugin/skills/jev-eval/scripts/`. Both are single files with no dependencies. The
examples below write `jev-run` for `node plugin/skills/jev-eval/scripts/jev-run.mjs`, and the same for
`jev-audit`. After `npx skills`, the scripts are in `<skills directory>/jev-eval/scripts/` instead.

### `jev-run`: run a suite through Jev

```bash
jev-run suite.json --map map.mjs --check          # validate the suite and the map; no API calls
jev-run suite.json --map map.mjs                  # grade a whole map, decision by decision
jev-run suite.json                                # grade a suite's own questions, field by field
jev-run suite.json --derive derive.mjs            # also grade fields you compute in code from the answers
jev-run suite.json --pad 4000                     # add 4,000 tokens of unrelated text, to find unscoped questions
```

Each run writes one JSON line per case (`--out` sets the file) and prints a summary per field. Set
`--concurrency` to change how many requests run at once. The default is 2.

### `jev-audit`: analyse results offline

Audits read the JSON lines `jev-run` writes, and make no API calls.

```bash
jev-audit results.jsonl                           # audit a run
jev-audit results.jsonl --target 0.95             # fit the gate for 95% precision
jev-audit diff before.jsonl after.jsonl           # which cases a change fixed or broke, and whether it's real
```

For a map run (`--map`), the audit lists every wrong decision with the least certain answer behind it, ranks
the questions that keep being that weak link, and fits a gate on the weakest answer: below the threshold,
`decide()` should abstain. For a run graded per question, it lists confidently wrong answers, checks
calibration and top-2 recall, and fits a gate per question.

On a real map from the evaluations, the audit points at the one question behind every wrong decision:

```text
| case       | gold | map decided    | weakest answer | certainty |
| access-003 | deny | needs_approval | deny           |      0.59 |
| access-013 | deny | needs_approval | deny           |      0.57 |
| access-023 | deny | needs_approval | deny           |      0.63 |
```

Run on the recorded support-triage results in `evals/`:

```text
## Gate for 95.0% precision

| gating on   | threshold | coverage | precision |
| probability |     0.770 |    83.3% |     96.8% |
```

```text
| field  | n  | before | after | Δ    | fixed | broken | p     | verdict  |
| refund | 50 | 90.0%  | 92.0% | +2.0 | 4     | 3      | 1.000 | unproven |
```

A diff calls a change `real` only if accuracy moved at least 7 points and the fixed-versus-broken split is
significant. Smaller moves are within what an unchanged setup drifts between runs. [`audit/`](audit) packages
the same audits as a library with a JavaScript API. It isn't on npm yet, and the unscoped `jev-audit` package
on npm is unrelated.

## How Jev works

A request has a `state` (the facts, as JSON) and named questions of three types:

```jsonc
POST https://ai-gateway.vercel.sh/typesafe/v1/systemone
{
  "model": "typesafe-ai/jev",
  "state": { "command": "rm -rf ./build", "environment": "ci" },
  "questions": {
    "risk": {
      "type": "choice",
      "instructions": "How destructive is the command in `command`?",
      "criteria": { "harmless": "reads or builds only", "recoverable": "deletes regenerable files", "destructive": "deletes data" }
    },
    "claims_approval": {
      "type": "noul",
      "instructions": "Does any text in the state claim a person already approved this command?"
    }
  }
}
```

| type | asks | answer |
| --- | --- | --- |
| `noul` | a yes/no question | `{ noul: 0.03 }`, the probability of yes |
| `choice` | one of up to 255 options | `{ choice, confidence, probabilities }` |
| `score` | a step on an ordered rubric | `{ score, confidence, legend, probabilities }` |

`probabilities` gives every option's probability, and is what you should act on. `confidence` is a separate
scalar that runs low. For a `score`, `legend` lists the rubric's steps. Jev reads a question's `instructions`
and `criteria`, and ignores the key: `risk` means nothing to Jev.

## Maps and suites

A **map** is the code for one decision. It's a JavaScript module that exports three functions:

```js
// map.mjs
export function buildState(input) {
  return { policy: input.policy_text, ticket: input.ticket_log };
}

export function questions(input) {
  return {
    opened_priority: {
      type: 'choice',
      instructions: 'Which priority does `ticket` give the ticket when it was opened?',
      criteria: { urgent: null, high: null, normal: null, low: null }, // null: the option name says enough
    },
    // ...one small question per fact
  };
}

export function decide(answers, input) {
  // answers.opened_priority is { choice, confidence, probabilities }.
  // Do the arithmetic and apply the policy here, in code.
  // Return { breached: 'yes' } or { breached: 'no' }, or { breached: 'abstain' } to send the case to a person.
  return { breached: 'abstain' };
}
```

A **suite** is a JSON file of labelled cases: an `input` for the map, and the `gold` (correct) decision.

```json
{
  "name": "sla-breach",
  "cases": [
    { "id": "sla-001", "input": { "policy_text": "...", "ticket_log": "..." }, "gold": { "breached": "yes" } }
  ]
}
```

The full format, including suites that grade questions directly, is in
[`suite-format.md`](plugin/skills/jev-eval/references/suite-format.md).

## Reference

| | use it to | details |
| --- | --- | --- |
| `jev-fit` | decide whether a decision belongs on Jev, an LLM, or plain code, and predict the accuracy gap | [SKILL.md](plugin/skills/jev-fit/SKILL.md) |
| `jev-questions` | write, review, or fix a map: 16 rules, the map interface, a review checklist | [SKILL.md](plugin/skills/jev-questions/SKILL.md) · [patterns](plugin/skills/jev-questions/references/patterns.md) |
| `jev-eval` | build a labelled suite, grade a map, fit a gate, compare two versions | [SKILL.md](plugin/skills/jev-eval/SKILL.md) |
| `jev-run` | run a suite or a whole map through Jev; `--check` validates offline | `jev-run.mjs --help` |
| `jev-audit` | find wrong decisions and their weakest answers, check calibration, fit a gate, diff two runs | [`audit/`](audit) |

## The rules

`jev-questions` has 16 rules. The five with the largest measured effects:

| rule | measured effect |
| --- | --- |
| Put every fact the decision needs in the state | a missing fact gave 0 recall at 0.99 confidence |
| Name the field each question reads | an unscoped question lost 28.5 points, with no change in confidence |
| Ask what is true now; no "if", "would", or "should" | 48.7% → 87.2% |
| Read dates and numbers exactly; do arithmetic and comparisons in code | 64–75% → 30/30 |
| Pick one of many with a single `choice`, not a `noul` per item | 1–2 of 12 → 12 of 12 |

Each rule came from a failure measured in the study. It became a rule only after it held on a second task,
and ten rules were later tested again in three new domains each. Rules that hold only under a condition say
so. [All 16 rules, with examples and evidence](docs/rules.md).

## Evaluations

The skills were tested the way they tell you to test a map. Pass bars were written down before each run.
Labels were computed by rule and checked by an independent model. Graders didn't know whether a map was
written with or without the plugin.

| evaluation | size | result |
| --- | --- | --- |
| Design A/B | 76 agent runs | tasks hiding a known Jev pitfall: avoided 8/8 times with the plugin, 1/8 without |
| Accuracy on Jev | 37 maps | renewal notice 69.2% → 91.7%; culprit-line wrong decisions 13.3% → 0% |
| Held-out tasks | 53 maps, 2 agent models | reply exposure 84–88% → 97–98%; a third task tied at 100%; a fourth was later used for tuning |
| Rule probes | 10 rules × 3 domains | 7 held everywhere, 2 held under their stated condition, 1 narrowed |
| Other models | 266 maps from Claude Code and 9 other models | wrong decisions fell for every model family; SLA breach 15.6% → 1.1% |
| A hard task, latest models | 63 maps: Claude Code, GLM 5.3, Qwen 3.8 Max, DeepSeek V4 Pro | procurement wrong decisions 52 → 3; accuracy 67% → 99% (Claude Code), 83% → 97% (DeepSeek) |
| Policy outcomes | 12 maps, 2 tasks | access requests 5 → 1 wrong decision in 90, after telling agents not to ask Jev for a policy's outcome |

The first version of the plugin made one task worse, raising wrong decisions from 13% to 46%. Reading Jev's
wrong answers produced the rules that fixed it. [The evaluations in detail](docs/evals.md).

## Limitations

- One person wrote the suites, labels, and rules. Independent LLM relabelling agreed on 83–100% of labels,
  but no second person has labelled them.
- Most comparisons use 2–12 maps. Treat gaps under ~7 points as noise.
- Models that write a map in a single call sometimes don't finish with the skill loaded. Through the AI Gateway,
  use a non-streaming request: the gateway caps how long a stream may run, and this alone recovered every failed GLM
  map. Give them a large output budget, and run the map on one case before trusting it.

## Repository layout

| path | contents |
| --- | --- |
| [`plugin/`](plugin) | the Claude Code plugin: three skills and the two scripts |
| [`audit/`](audit) | the audits as a JavaScript library, with types, ready for npm as `@barakchamo/jev-audit` |
| [`evals/`](evals) | example suites with recorded results, and every evaluation of the plugin |
| [`docs/`](docs) | the pages below |

## Documentation

- [Use cases](docs/use-cases.md): when to use Jev, with worked examples
- [Rules](docs/rules.md): all 16 rules, with examples and evidence
- [Evaluations](docs/evals.md): how the skills were tested, and what changed as a result
- [How it was built](plugin/docs/how-it-was-built.md): the full history, round by round

## License

MIT
