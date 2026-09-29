# jev-kit

**Skills and tools that get your coding agent to write [Jev](https://docs.typesafe.ai) questions that work, and
prove it on labelled cases.**

[Install](#installation) · [Get a key](#get-a-key) · [Try it without a key](#try-it-without-a-key) · [Quick start](#quick-start) · [Concepts](#how-jev-works) · [Use cases](docs/use-cases.md) · [Rules](docs/rules.md) · [Evaluations](docs/evals.md) · [Production](docs/production.md) · [Glossary](docs/glossary.md)

**Jev** is a model from TypeSafe that answers typed questions about data you send it: yes/no, one of a set of
options, or a step on a rubric. It returns probabilities, never text, so it costs a fraction of an LLM
($0.042 per million input tokens, output free) and answers in 0.25–0.6 s. It suits decisions made thousands of
times: routing, screening, checking documents against a policy.

**The catch is wording.** In a study of 57 labelled decision tasks, rewriting a single question moved accuracy
by 30–40 points, several times more than switching between Jev and an LLM. The wording an agent reaches for by
habit is often the wording Jev gets wrong. jev-kit teaches the agent the wording that works, then makes it
measure the result.

Maps (decision code) that Claude Code agents wrote with and without the kit, graded on Jev:

| decision | measure | without the kit | with it |
| --- | --- | ---: | ---: |
| Did this ticket breach its SLA? (held out) | wrong decisions | 15.6% | **1.1%** |
| Approve, escalate or reject a purchase? (held out, hard) | wrong decisions | 5.6% | **0%** |
| Which log line caused the CI failure? | wrong decisions | 13.3% | **0%** |
| Does this reply expose personal data? (held out) | accuracy | 84–88% | **97–98%** |

Nine other models wrote maps too, including GPT, Gemini, DeepSeek, GLM and Qwen. Pooled over tasks, their wrong
decisions fell or stayed at zero with the skill, partly because their maps sent more cases to a person; some
one-call authors failed to finish a map. [The evaluations](docs/evals.md), with every caveat.

**New here?** Read [what Jev is and isn't good for](docs/use-cases.md#when-to-use-jev) or the page
[for decision-makers](docs/decision-makers.md). Using Codex, Cursor or the AI SDK? See [other agents](docs/other-agents.md).

## What's in the kit

- **Three skills** your agent loads by itself: `jev-fit` (should this decision run on Jev?), `jev-questions`
  (how to ask), and `jev-eval` (how to measure).
- **Two scripts**, single files with no dependencies: `jev-run` sends labelled cases through Jev, and `jev-audit`
  analyses the results offline.
- **The evidence:** labelled suites, recorded results, every agent-written map, and every evaluation of the skills.

## Where the rules come from

The skills rest on 16 rules for writing Jev questions:

1. **Measured failures.** A study of 57 hand-labelled suites (1,836 cases) read every case Jev got wrong with
   high confidence, and measured each fix.
2. **Replicated.** A finding became a rule after it held on a second task. Rules that hold only under a condition
   say so, and two that rest on one measurement so far are marked "single".
3. **Re-tested.** Ten rules were probed in three new domains each. The skills were tested in four pre-registered
   rounds of held-out tasks, with maps from ten authoring models.

[The rules](docs/rules.md) · [their evidence](plugin/skills/jev-questions/references/rules.md) · [the evaluations](docs/evals.md)

## Installation

All three methods install the same three skills.

| method | installs into | use it when |
| --- | --- | --- |
| Claude Code marketplace | Claude Code, as the `jev` plugin | you use Claude Code |
| `npx plugins` | Claude Code, Codex, VS Code, GitHub Copilot CLI and other plugin-aware tools | you want it in several tools |
| `npx skills` | the skills folder of 70+ agents, including Cursor and Codex | your agent reads skills, not plugins |

**Claude Code marketplace**, inside Claude Code:

```text
/plugin marketplace add barakchamo/jev-kit
/plugin install jev@jev
```

**[`npx plugins`](https://www.npmjs.com/package/plugins)** installs into every supported tool it detects:

```bash
npx plugins add barakchamo/jev-kit                        # every detected tool
npx plugins add barakchamo/jev-kit --target claude-code   # one tool
```

It writes to your user folders (`~/.claude/`, `~/.codex/`), not the project. For Cursor, use `npx skills`. Restart
your agent afterwards. To remove it from Claude Code: `claude plugin uninstall jev@jev`.

**[`npx skills`](https://www.npmjs.com/package/skills)** copies the skill folders into the current project:

```bash
npx skills add barakchamo/jev-kit --agent claude-code -y  # → .claude/skills/jev-*
npx skills add barakchamo/jev-kit --agent cursor -y       # → .agents/skills/jev-* (Codex uses the same)
npx skills add barakchamo/jev-kit --list                  # list the skills without installing
```

Add `-g` to install for your user. It also writes `skills-lock.json`, which records what was installed. Install
all three skills: they refer to each other. The scripts land in `<skills folder>/jev-eval/scripts/`.

To pin a version and verify it, see [SECURITY.md](SECURITY.md#verifying-a-copy).

## Get a key

The scripts need Node.js 18 or later. Calling Jev needs one of two keys; the offline parts need neither.

| route | key | notes |
| --- | --- | --- |
| [TypeSafe API](https://docs.typesafe.ai) | `TYPESAFE_API_KEY` | model `jev-latest`, or pin a version (`jev-1.13.0`) |
| [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) | `AI_GATEWAY_API_KEY` | model `typesafe-ai/jev`, billed to your Vercel account; no version pinning |

```bash
export TYPESAFE_API_KEY=...        # or: export AI_GATEWAY_API_KEY=...
```

`jev-run` uses whichever is set (TypeSafe first), or `--provider typesafe|gateway`. A run of the 42-case example
costs about $0.003. Behind an HTTPS proxy on Node 22.21+, also set `NODE_USE_ENV_PROXY=1`.

## Try it without a key

Clone the repository and run these from its root. Nothing is sent anywhere.

```bash
git clone https://github.com/barakchamo/jev-kit && cd jev-kit
S=plugin/skills/jev-eval

# check the example map: builds all 42 cases and runs decide() on synthetic answers
node $S/scripts/jev-run.mjs $S/examples/renewal-notice.json --map $S/examples/renewal-notice.map.mjs --check

# audit a recorded run of that map (42/42), and a real map from the evaluations that got 3 wrong
node $S/scripts/jev-audit.mjs $S/examples/renewal-notice.recorded.jsonl
node $S/scripts/jev-audit.mjs evals/heldout2/access-request-plugin-2.map.jsonl

# fit confidence gates on recorded answers, judged on held-out cases
node $S/scripts/jev-audit.mjs evals/support-triage/results/jev.jsonl --target 0.95 --holdout 0.5
```

## Quick start

With a key set, from the repository root (with `S` set as above), grade the example map. It decides whether a contract's renewal was cancelled in time:

```bash
node $S/scripts/jev-run.mjs $S/examples/renewal-notice.json --map $S/examples/renewal-notice.map.mjs
```

```text
wrote renewal-notice.map.jsonl: 42 answered, 0 failed · gateway typesafe-ai/jev · 69507 input tokens · $0.00292 at list price ($0.00292 billed) · p50 285 ms · p95 406 ms
outcome: accuracy 100.0% · wrong 0/42 · abstain 0 · coverage 100.0%
next: jev-audit renewal-notice.map.jsonl
```

Then ask your agent to build one for your own decision:

```text
Write a Jev map that decides whether a support ticket breached its first-response SLA.
The policy and some example tickets are in fixtures/.
```

## How Jev works

A request has a `state` (the facts: a string, or JSON with named fields) and named questions of three types:

```jsonc
POST https://api.typesafe.ai/v1/systemone          // or https://ai-gateway.vercel.sh/typesafe/v1/systemone
Authorization: Bearer $TYPESAFE_API_KEY             //    with $AI_GATEWAY_API_KEY
{
  "model": "jev-latest",                             //    and "typesafe-ai/jev"
  "state": { "command": "rm -rf ./build", "environment": "ci" },
  "questions": {
    "risk": {
      "type": "choice",
      "instructions": "How destructive is the command in `command` in the environment named in `environment`?",
      "criteria": { "harmless": "reads or builds only", "recoverable": "deletes files that can be regenerated", "destructive": "deletes data that cannot be regenerated" }
    },
    "targets_home": { "type": "noul", "instructions": "Does the command in `command` touch anything outside the current directory?" }
  }
}
```

| type | asks | answer |
| --- | --- | --- |
| `noul` | a yes/no question | `{ noul: 0.03 }`, the probability of yes |
| `choice` | one of up to 255 options | `{ choice, confidence, probabilities }` |
| `score` | a step on an ordered rubric | `{ score, confidence, legend, probabilities }` |

All questions are answered in one pass, independently. Act on `probabilities`; `confidence` is a separate scalar
that runs low. Jev reads each question's `instructions` and `criteria` and ignores its key. The response's
`model` names the version that answered. Limits and errors: [production](docs/production.md#limits).

## Maps and suites

A **map** is the code for one decision: a module that exports three functions.

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
      criteria: { urgent: null, high: null, normal: null, low: null, other: 'none of these, or not stated' },
    },
    // ...one small question per fact
  };
}

export function decide(answers, input) {
  // Read the answers, do the arithmetic and apply the policy here, in code.
  // Return { breached: 'yes' | 'no' }, or { breached: 'abstain' } to send the case to a person.
  return { breached: 'abstain' };
}
```

A **suite** is a JSON file of labelled cases: an `input` for the map, and the `gold` (correct) decision.

```json
{ "name": "sla-breach", "cases": [
  { "id": "sla-001", "input": { "policy_text": "...", "ticket_log": "..." }, "gold": { "breached": "yes" } }
] }
```

Each graded case is **right**, **wrong** (a decision acted on, and incorrect), or **abstain** (sent to a person).
The full format: [`suite-format.md`](plugin/skills/jev-eval/references/suite-format.md). Terms: [glossary](docs/glossary.md).

## Using the skills

You don't call the skills by name. Describe the task, and the agent loads the one that matches.

| step | skill | ask for | you get |
| --- | --- | --- | --- |
| 1. Decide | `jev-fit` | whether a decision belongs on Jev | Jev, Jev with a fallback, an LLM, or plain code, with the expected accuracy gap and the cost at your volume |
| 2. Write | `jev-questions` | a new map, or a review of one | `map.mjs` written to the 16 rules, or the rule violations in an existing one |
| 3. Measure | `jev-eval` | a test suite, a grade, a threshold, a before/after | a labelled suite, graded results, fitted gates, and whether a change was real |

```text
We route 40k support tickets a day to one of 12 teams with GPT. Should this run on Jev instead?
Write a Jev map that decides whether a refund request is eligible under policy.md.
Build a 30-case labelled suite for the refund map, grade it on Jev, and fit a threshold for 95% precision.
Our culprit-line field is 71% accurate. Find out why and fix it.
```

## Using the scripts

Both scripts are in `plugin/skills/jev-eval/scripts/` (after `npx skills`, in `<skills folder>/jev-eval/scripts/`),
and both print `--help`. Below, `jev-run` means `node <that folder>/jev-run.mjs`.

```bash
jev-run suite.json --map map.mjs --check    # offline: build every case, validate, run decide() on synthetic answers
jev-run suite.json --map map.mjs            # grade a whole map, decision by decision
jev-run suite.json                          # grade a suite's own questions, field by field
jev-run suite.json --pad 4000               # add unrelated text, to find questions that don't name their field
jev-run cases.jsonl --map map.mjs --resume  # large case sets: streamed output, re-run only what failed

jev-audit results.jsonl --holdout 0.5       # audit; gates fitted on half the cases, judged on the rest
jev-audit diff before.jsonl after.jsonl     # which cases a change fixed or broke, and whether it's real
```

On a map run, the audit lists each wrong decision with the least certain answer behind it. On a real map from the
evaluations, it points at one question behind all three wrong decisions:

```text
| case       | decision | gold | map decided    | weakest answer | certainty |
| access-003 | decision | deny | needs_approval | deny           |      0.59 |
| access-013 | decision | deny | needs_approval | deny           |      0.57 |
| access-023 | decision | deny | needs_approval | deny           |      0.63 |
```

The `deny` question asked Jev for the policy's outcome; the fix was to read the facts and apply the policy in code.
On a per-question run, it fits a gate per question, with a lower bound on the precision it can promise:

```text
| question   | n  | threshold | coverage | precision | 95% lower bound |
| department | 50 | 0.740     | 98.0%    | 95.9%     | 86.3%           |
| urgency    | 50 | 0.840     | 60.0%    | 96.7%     | 83.3%           |
| refund     | 50 | 0.760     | 94.0%    | 97.9%     | 88.9%           |
```

A diff calls a change `real` only if accuracy moved at least 7 points and the fixed-versus-broken split is
significant. It refuses to compare runs graded on different labels (`--gold suite.json` re-grades both). The
[`audit/`](audit) folder packages the audits as a JavaScript library; it isn't on npm yet, and the unscoped
`jev-audit` package on npm is unrelated.

## The rules

`jev-questions` has 16 rules. The five with the largest measured effects:

| rule | measured effect |
| --- | --- |
| Put every fact the decision needs in the state | a missing fact gave 0 recall at 0.99 confidence |
| Name the field each question reads | an unscoped question lost 28.5 points, with no change in confidence |
| Ask what is true now; no "if", "would", or "should" | 48.7% → 82.1% |
| Read dates and numbers exactly; do arithmetic and comparisons in code | 64–75% → 30/30 |
| Pick one of many with a single `choice`, not a `noul` per item | 1–2 of 12 → 12 of 12 |

[All 16 rules, with examples, evidence and status](docs/rules.md).

## Evaluations

The skills were tested the way they tell you to test a map: pre-registered pass bars, labels computed by rule
and checked by another model, blind grading, and held-out tasks.

| evaluation | size | result |
| --- | --- | --- |
| Design A/B | 76 agent runs | tasks hiding a known Jev pitfall: avoided 8/8 times with the plugin, 1/8 without |
| Accuracy on Jev | 37 maps | renewal notice 69.2% → 91.7%; the first plugin version made the culprit task worse (13.3% → 45.8% wrong), the fix took it to 0% |
| Held-out tasks | 53 maps, 2 agent models | reply exposure 84–88% → 97–98%; a second task tied at 100%; a third was later used for tuning |
| Rule probes | 10 rules × 3 domains | 7 held everywhere, 2 held under their stated condition, 1 narrowed |
| Other models | 266 maps, 10 authoring models | wrong decisions fell or stayed at zero for every author, pooled over tasks; some one-call maps didn't finish |
| Policy outcomes | 12 maps, 2 tasks | access requests 5 → 1 wrong decision in 90 after telling agents not to ask Jev for a policy's outcome |
| A hard task, latest models | 63 maps, 4 authors | procurement wrong decisions 9.0% → 0.2–0.5%; accuracy 67% → 99% (Claude Code), 83% → 97% (DeepSeek) |

[The evaluations in detail](docs/evals.md) · [the evidence](evals/README.md)

## Limitations

- **One author.** One person wrote the suites, labels and rules. LLM relabelling agreed on 83–89% of the study's
  labels and 97.8–100% of the plugin suites' labels; no second person has labelled them.
- **Small numbers.** Most comparisons use 2–12 maps per arm. Read the results as consistent directions, not
  precise effect sizes, and treat gaps under ~7 points as noise.
- **Abstaining isn't free.** Part of every drop in wrong decisions comes from maps sending more cases to a
  person. The evaluations report coverage beside it.
- **The study isn't public.** Its write-up and 55 of its 57 suites stay in a private research repository; the
  rules cite its numbers, and the public evaluations re-test them.
- **One-call authors.** Models writing a map in a single call sometimes don't finish with the skill loaded.
  Through the gateway, use a non-streaming request and a 64k output budget ([details](docs/other-agents.md)).

## Documentation

| page | for |
| --- | --- |
| [Use cases](docs/use-cases.md) | when to use Jev, with six worked examples |
| [Rules](docs/rules.md) | all 16 rules, with examples, evidence and status |
| [Production](docs/production.md) | limits, safe calls, cascades, monitoring, data handling, security |
| [For decision-makers](docs/decision-makers.md) | a one-page view without code |
| [Other agents](docs/other-agents.md) | Codex, Cursor, the AI SDK, and results with non-Claude models |
| [Evaluations](docs/evals.md) | how the skills were tested, and what changed as a result |
| [Glossary](docs/glossary.md) | every term the kit uses |
| [How it was built](plugin/docs/how-it-was-built.md) | the full history, round by round |
| [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) | the project |

## License

MIT
