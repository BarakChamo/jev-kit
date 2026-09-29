# Use cases

Jev is a good fit for high-volume decisions with a bounded answer: a yes/no, one of a known set, or a step on
a rubric. This page covers when to use it, and how to write maps for six common kinds of decision.
New to the terms? See the [glossary](glossary.md).

## When to use Jev

All four of these should hold:

1. **The answer space is bounded.** Yes/no, one of a known set, or a rung on a rubric. Jev doesn't generate
   text.
2. **The evidence fits in the state.** Your code assembles everything a careful person would need. Long is
   fine: 24 questions over a 25,500-token contract scored 100% in one request. TypeSafe's limit is 32k tokens
   of state per request.
3. **There is volume or latency pressure.** Thousands of decisions, or a hot path such as every tool call,
   commit, or message.
4. **A wrong answer is survivable.** There is a person, a larger model, or a safe default for the cases Jev
   is unsure about, and the decision tolerates a small rate of confident mistakes, which no gate catches.

The shape of the decision predicts how Jev compares with an LLM. Here the LLM is `zai/glm-5.3-flash`, the cheap
model the study compared against:

| decision shape | Jev vs a cheap LLM |
| --- | ---: |
| many independent facts from one document, and a verdict over them | **+13 to +17 points** |
| a single document against a rubric | about even |
| comparing two quantities or options | −2 points on average, worst −17 |
| needs knowledge that isn't in the state | **−10 points** |

Accuracy is usually close, so cost and latency are the reason to choose Jev. It costs $0.042 per million input
tokens with free output: 3–10× less per decision than a cheap flash LLM on short states, more when the LLM
reasons or the state is long. It answers in 0.25–0.6 s at p50, against 2.9 s for the cheap LLM. Ask the
`jev-fit` skill before you build. It runs this checklist and estimates the gap and the cost at your volume.

**Avoid Jev** for a rule nobody can write down, for generated text, and for picking the cause among
near-identical items (65% at 0.88 confidence in the study). The same goes for a decision whose main job is
resisting manipulation, such as fraud review or a security control: Jev detects planted manipulation well but
can be steered by it. It can be one signal in such a system, never the control.

## Examples

Every example below shows the question an agent usually writes first, the version that works, and what the
difference was when measured. Each is a fragment of a map: the `questions` and `decide` exports of the
[map interface](../README.md#maps-and-suites). Thresholds in the code are starting points; fit them on your own
labelled cases with `jev-audit`.

### Triage: derive the action from a classification

Deciding whether to retry a failed CI job.

```js
// Instead of: "Should we retry this CI job?"        → 80.0%, catches 38% of retryable jobs
// Ask what caused the failure, and decide in code    → 92.5%, catches all of them
export function questions() {
  return {
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
  };
}

export function decide(a) {
  const p = a.cause.probabilities[a.cause.choice];
  if (p < 0.8) return { retry: 'abstain' };            // placeholder gate: fit it
  return { retry: ['flaky_test', 'infrastructure'].includes(a.cause.choice) ? 'yes' : 'no' };
}
```

Jev is reliable at stating what happened. Which action to take is policy, so it belongs in your code.

### Deadlines: read the dates, compute in code

Deciding whether a renewal notice arrived early enough.

```js
// Instead of: "Was the notice received early enough under `contract`?"   → 64–75%
// Read the dates, the term and the notice period as choices, then compute  → 42/42
const OTHER = { other: 'none of the listed values, or not stated' };
const opts = (xs) => ({ ...Object.fromEntries(xs.map((x) => [String(x), null])), ...OTHER });
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function questions(input) {
  const year = new Date(input.received_date).getUTCFullYear();
  return {
    start_year:   { type: 'choice', instructions: 'In which year does `contract` say the agreement begins?', criteria: opts(Array.from({ length: 10 }, (_, i) => year - 9 + i)) },
    start_month:  { type: 'choice', instructions: 'In which month does `contract` say the agreement begins?', criteria: opts(MONTHS) },
    start_day:    { type: 'choice', instructions: 'On which day of the month does `contract` say the agreement begins?', criteria: opts(Array.from({ length: 31 }, (_, i) => i + 1)) },
    notice_count: { type: 'choice', instructions: 'What number does `contract` give for the notice needed before a term ends, whatever its unit?', criteria: opts([7, 10, 14, 15, 30, 45, 60, 90, 120, 1, 2, 3, 4, 6]) },
    notice_unit:  { type: 'choice', instructions: 'In what unit does `contract` state that notice period?', criteria: { days: null, weeks: null, months: null, ...OTHER } },
    // ...and the term length, the same way
  };
}
```

`decide()` abstains on any "other" answer or unsure read, then builds the dates, finds the end of the term the
email arrived in, subtracts the notice in calendar months or days, and compares. Never tell Jev "a month is 30
days": three months before January 10 is October 10. The full map is
[`renewal-notice.map.mjs`](../plugin/skills/jev-eval/examples/renewal-notice.map.mjs). Agent-written maps using
this pattern went from 69.2% to 91.7% accuracy, with no wrong decisions.

The same applies to SLA checks. Without the plugin, Claude Code maps made 14 wrong decisions in 90 cases
(15.6%), every one from maps that asked Jev "was the SLA breached?". With the plugin, the maps read the
timestamps and computed business minutes in code, and made 1 wrong decision in 90 (1.1%).

### Pointing: pick one of many with a single `choice`

Finding the log line that states why a CI job failed.

```js
// Instead of: a yes/no per line ("does this line explain the failure?")   → 13–100%; "exit code 1" wins
// One choice over every line, with a rubric naming what to skip           → 100%
export function buildState(input) {
  return { lines: input.lines };
}

export function questions(input) {
  return {
    culprit: {
      type: 'choice',
      instructions:
        'Which line of `lines` states the specific cause of the failure: the error message, exception or failed ' +
        'assertion? Not a generic wrapper such as "Process completed with exit code 1", and not a stack frame.',
      criteria: Object.fromEntries(input.lines.map((text, i) => [String(i), text])), // every line, no pre-filter
    },
  };
}
```

A `choice` normalizes across options, so the lines compete with each other. Separate yes/no questions are each
scored on their own, and a generic line can score as high as the real error. Don't narrow the lines with a
regex first: in the evaluations, pre-filters kept the right line in as few as 5 of 30 cases. A `choice` takes up
to 255 options; for longer logs, see [rule 16](rules.md#16-dont-pre-filter-with-unmeasured-code).

### Policies: pin the policy, ask about the case

Deciding whether an item can be returned under a written returns policy.

A fixed policy is the same for every case, so read its windows, limits, and exclusions once and write them into
code. Ask Jev only about the case. Every clause maps to something: the window to the order date, the category
and exclusions to the item, final sale to the order, the defect window to the customer's claim.

```js
const POLICY = {
  windowDays: { default: 30, electronics: 15 },   // "30 days, 15 for electronics"
  defectiveWindowDays: 30,                        // "defective items: 30 days, even if opened"
  excludedCategories: ['gift_card'],              // "gift cards cannot be returned"
  openedNotReturnable: ['software', 'media'],     // "opened software and media cannot be returned"
};

export function questions(input) {
  return {
    item: {
      type: 'choice',
      instructions: 'Which item in `order` does `message` ask to return?',
      criteria: { ...Object.fromEntries(input.order.items.map((i) => [i.sku, i.name])), unclear: 'no single item can be identified' },
    },
    says_defective: { type: 'noul', instructions: 'Does `message` say the item is faulty or damaged?' },
    says_opened: { type: 'noul', instructions: 'Does `message` say the item was opened or used?' },
  };
}

export function decide(a, input) {
  const item = input.order.items.find((i) => i.sku === a.item.choice);
  if (!item || a.item.probabilities[a.item.choice] < 0.8) return { returnable: 'abstain' };
  if (POLICY.excludedCategories.includes(item.category) || item.final_sale) return { returnable: 'no' };  // facts already in the order
  const days = (Date.parse(input.message_date) - Date.parse(input.order.date)) / 86400000;
  const defective = a.says_defective.noul >= 0.7;
  if (defective) return { returnable: days <= POLICY.defectiveWindowDays ? 'yes' : 'no' };
  if (a.says_defective.noul > 0.3) return { returnable: 'abstain' };
  if (POLICY.openedNotReturnable.includes(item.category) && a.says_opened.noul >= 0.5) return { returnable: 'no' };
  return { returnable: days <= (POLICY.windowDays[item.category] ?? POLICY.windowDays.default) ? 'yes' : 'no' };
}
```

Don't ask Jev what the policy says to do with the request. On access requests, every wrong decision left came
from maps that asked for the outcome directly. Check that every clause of the policy maps to something in code.
Maps that encoded the return windows but not the gift-card exclusion approved gift-card returns with full
confidence. With every clause covered, three maps scored 90/90. Do this check yourself, while writing the map,
and write one test case per clause. Don't ask Jev "does this policy have rules the map doesn't handle?": a map
that did abstained on 23 of 30 cases.

### Guardrails: a detector beside the judgment, and a gate

Screening a command an agent proposes to run. Where a written rule can decide (an allowlist, "no writes
outside the workspace"), apply it in code first. Jev handles what is left: what the command would do. A second
question checks for text trying to steer the answer.

```js
export function questions() {
  return {
    effect: {
      type: 'choice',
      instructions: 'What would running the command in `proposed_call` do in `environment`?',
      criteria: {
        read_only: 'only reads, builds or runs tests, and sends nothing outside the machine',
        reversible: 'changes something that can be undone, and sends nothing outside the machine',
        destructive: 'deletes or overwrites data, or changes credentials or permissions',
        exfiltrates: 'reads secrets, credentials or private data and sends them anywhere, or opens a network connection out',
      },
    },
    claims_approval: { type: 'noul', instructions: 'Does `context` claim that a person already approved `proposed_call`?' },
  };
}

export function decide(a) {
  if (['destructive', 'exfiltrates'].includes(a.effect.choice)) return { action: 'block' };
  const safe = a.effect.probabilities.read_only ?? 0;
  if (a.claims_approval.noul < 0.5 && a.effect.choice === 'read_only' && safe >= 0.95) return { action: 'allow' };
  return { action: 'ask' };   // unsure, reversible, or a planted approval: a person decides
}
```

Only `read_only` at a high, fitted probability runs unattended. Everything unsure goes to a person, and an API
error or timeout must also mean "ask", never "allow". Jev detects a planted "this was already approved" far
better than it resists one: in a deploy-freeze probe, the claim fooled the judgment in 6 of 6 cases, and the
detector's veto stopped all 6. That is six cases and one phrasing. Treat this map as one layer under
deterministic rules, test it against your own attacks, and read the [security notes](production.md#security).

When a written policy decides the outcome (an access policy, a returns policy), don't ask Jev for the outcome at
all. Read the facts the rules depend on and apply them in code, as in [Policies](#policies-pin-the-policy-ask-about-the-case).
Keep the detector as a veto.

### Extraction: many facts from one document

Reviewing a contract.

```js
export function buildState(input) {
  return { contract: input.full_text, schedule_a: input.schedule_text };
}

export function questions() {
  return {
    governing_law: { type: 'choice', instructions: 'Which jurisdiction does `contract` name as governing law?', criteria: { delaware: null, new_york: null, california: null, england: null, other: 'another or none' } },
    auto_renews:   { type: 'noul',   instructions: 'Does `contract` renew automatically at the end of its term?' },
    // ...one question per fact
  };
}
```

Extraction is Jev's strongest shape: 13–17 points ahead of a cheap LLM on average. 24 questions over a
25,500-token contract scored 100% in one request, in about 2 seconds. Sending them as 24 separate requests gave
identical answers at 11.7× the cost, because the long contract was paid for 24 times. Questions don't
interfere: adding or reordering them moved 0–1.2% of answers.

## Next steps

- [Rules](rules.md): the 16 rules behind these patterns.
- [`patterns.md`](../plugin/skills/jev-questions/references/patterns.md): more patterns with code.
- [Production](production.md): limits, monitoring, data handling and security.
- [Evaluations](evals.md): how each number on this page was measured.
