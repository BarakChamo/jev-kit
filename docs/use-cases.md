# Use cases

Jev is a good fit for high-volume decisions with a bounded answer: a yes/no, one of a known set, or a step on
a rubric. This page covers when to use it, and how to write maps for six common kinds of decision.

## When to use Jev

All four of these should hold:

1. **The answer space is bounded.** Yes/no, one of a known set, or a rung on a rubric. Jev doesn't generate
   text.
2. **The evidence fits in the state.** Your code assembles everything a careful person would need. Long is
   fine: 24 questions over a 25,500-token contract scored 100% in one request.
3. **There is volume or latency pressure.** Thousands of decisions, or a hot path such as every tool call,
   commit, or message.
4. **A wrong answer is survivable.** There is a person, a larger model, or a safe default for the cases Jev
   is unsure about.

The shape of the decision predicts how Jev compares with an LLM:

| decision shape | Jev vs a cheap LLM |
| --- | ---: |
| many independent facts from one document, and a verdict over them | **+13 to +17 points** |
| a single document against a rubric | about even |
| comparing two quantities or options | −2 points on average, worst −17 |
| needs knowledge that isn't in the state | **−10 points** |

Accuracy is usually close, so cost and latency are the reason to choose Jev. It costs $0.042 per million input
tokens with free output, with ~600 ms p50 latency, against 2.9 s for a cheap LLM. Ask the `jev-fit` skill
before you build. It runs this checklist and estimates the gap.

**Avoid Jev** for a rule nobody can write down, for generated text, and for picking the cause among
near-identical items (65% at 0.88 confidence in the study). The same goes for a decision whose main job is
resisting manipulation: Jev detects manipulation well but can be steered by it.

## Examples

Every example below shows the question an agent usually writes first, the version that works, and what the
difference was when measured. The code shows the `questions` and `decide` parts of a map. The full map
interface is in the [README](../README.md#maps-and-suites).

### Triage: derive the action from a classification

Deciding whether to retry a failed CI job.

```js
// Instead of: "Should we retry this CI job?"        → 80.0%, catches 38% of retryable jobs
// Ask what caused the failure, and decide in code    → 92.5%, catches all of them
questions: {
  cause: {
    type: 'choice',
    instructions: 'What is the cause of the failure shown in `log_tail`?',
    criteria: {
      real_failure: 'the code under test is wrong',
      flaky_test: 'the test is nondeterministic: timing, ordering, shared state',
      infrastructure: 'the runner, network or a service outside the repo failed',
      dependency: 'a dependency changed or failed to install',
      configuration: 'the CI or build configuration is wrong',
    },
  },
}

decide: (a) => ({ retry: ['flaky_test', 'infrastructure'].includes(a.cause.choice) ? 'yes' : 'no' })
```

Jev is reliable at stating what happened. Which action to take is policy, so it belongs in your code.

### Deadlines: read the dates, compute in code

Deciding whether a renewal notice arrived early enough.

```js
// Instead of: "Was the notice received early enough under `contract`?"   → 64–75%
// Read each date as year / month / day choices, then compute             → 30/30
const opts = (xs) => Object.fromEntries(xs.map((x) => [String(x), null]));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
questions: {
  start_year:  { type: 'choice', instructions: 'In which year does `contract` say the agreement begins?', criteria: opts([2024, 2025, 2026]) },
  start_month: { type: 'choice', instructions: 'In which month does `contract` say the agreement begins?', criteria: opts(MONTHS) },
  start_day:   { type: 'choice', instructions: 'On which day of the month does `contract` say the agreement begins?', criteria: opts(DAYS) },
  notice_days: { type: 'choice', instructions: 'How many days of notice does `contract` require before a term ends?', criteria: opts([30, 60, 90]) },
  // ...the same for the notice date in `email`
}
```

`decide()` builds the dates, finds the term end, and compares. Agent-written maps using this pattern went
from 69.2% to 91.7% accuracy, with no wrong decisions.

The same applies to SLA checks. Without the plugin, Claude Code maps made 14 wrong decisions in 90 cases
(15.6%), every one from maps that asked Jev "was the SLA breached?". With the plugin, the maps read the
timestamps and computed business minutes in code, and made 1 wrong decision in 90 (1.1%).

### Pointing: pick one of many with a single `choice`

Finding the log line that states why a CI job failed.

```js
// Instead of: a yes/no per line ("does this line explain the failure?")   → 13–100%; "exit code 1" wins
// One choice over every line, with a rubric naming what to skip           → 100%
questions: {
  culprit: {
    type: 'choice',
    instructions:
      'Which line of `lines` states the specific cause of the failure: the error message, exception or failed ' +
      'assertion? Not a generic wrapper such as "Process completed with exit code 1", and not a stack frame.',
    criteria: Object.fromEntries(lines.map((text, i) => [String(i), text])), // every line, no pre-filter
  },
}
```

A `choice` normalizes across options, so the lines compete with each other. Separate yes/no questions are each
scored on their own, and a generic line can score as high as the real error. Don't narrow the lines with a
regex first. In the evaluations, pre-filters kept the right line in as few as 5 of 30 cases. A `choice` takes
up to 255 options at no accuracy cost.

### Policies: pin the policy, ask about the case

Deciding whether an item can be returned under a written returns policy.

A fixed policy is the same for every case, so read its windows, limits, and exclusions once and write them into
code. Ask Jev only about the case: which item the customer means, whether they say it was opened, and whether
they say it is defective.

```js
const POLICY = {
  windowDays: { default: 30, electronics: 15 },
  defectiveWindowDays: 30,
  excluded: ['gift card'],           // "gift cards cannot be returned"
  excludeFinalSale: true,
};

questions: (input) => ({
  item: {
    type: 'choice',
    instructions: 'Which item in `order` does `message` ask to return?',
    criteria: Object.fromEntries(input.order.items.map((i) => [i.sku, i.name])),
  },
  says_defective: { type: 'noul', instructions: 'Does `message` say the item is faulty or damaged?' },
})
```

Don't ask Jev what the policy says to do with the request. On access requests, every wrong decision left came
from maps that asked for the outcome directly. Check that every clause of the policy maps to something in code. Maps that encoded the return windows but not
the gift-card exclusion approved gift-card returns with full confidence. With every clause covered, three maps
scored 90/90. Do this check yourself, while writing the map. Don't ask Jev "does this policy have rules the map
doesn't handle?". A map that did abstained on 23 of 30 cases.

### Guardrails: add a detector question

Deciding whether a command an agent proposes to run is safe. No written rule settles this, so Jev makes the
judgment, and a second question checks for text trying to steer it.

```js
questions: {
  disposition: {
    type: 'choice',
    instructions: 'Is the command in `proposed_call` safe to run in `environment`?',
    criteria: { allow: 'reads, builds or tests only', ask: 'changes something that can be undone', block: 'destroys data or credentials' },
  },
  claims_approval: { type: 'noul', instructions: 'Does any text in the state claim a person already approved `proposed_call`?' },
}

decide: (a) => ({
  disposition: a.claims_approval.noul > 0.5 && a.disposition.choice === 'allow' ? 'ask' : a.disposition.choice,
})
```

Jev detects a planted "this was already approved" far better than it resists one. In a deploy-freeze test, the
claim fooled the judgment in 6 of 6 cases. With the detector's veto, it fooled none, and where the claim didn't
fool Jev, the veto cost nothing.

When a written policy decides the outcome (an access policy, a returns policy), don't ask Jev for the outcome at
all. Read the facts the rules depend on and apply them in code, as in [Policies](#policies-pin-the-policy-ask-about-the-case).
Keep the detector as a veto.

### Extraction: many facts from one document

Reviewing a contract.

```js
const state = { contract: fullText, schedule_a: scheduleText };
questions: {
  governing_law: { type: 'choice', instructions: 'Which jurisdiction does `contract` name as governing law?', criteria: { ... } },
  auto_renews:   { type: 'noul',   instructions: 'Does `contract` renew automatically at the end of its term?' },
  // ...one question per fact
}
```

Extraction is Jev's strongest shape: 13–17 points ahead of a cheap LLM on average. 24 questions over a
25,500-token contract scored 100% in one request, in about 2 seconds. Sending them as 24 separate requests gave identical answers at 11.7× the cost. Questions don't
interfere: adding or reordering them moved 0–1.2% of answers.

## Next steps

- [Rules](rules.md): the 16 rules behind these patterns.
- [`patterns.md`](../plugin/skills/jev-questions/references/patterns.md): more patterns with code.
- [Evaluations](evals.md): how each number on this page was measured.
