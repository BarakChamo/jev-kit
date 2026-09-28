# Patterns, with code

Plain TypeScript with no dependencies. `ask(state, questions)` stands for one POST to the systemone
endpoint (see the SKILL.md for the request shape). Every pattern keeps the model's side to "what is
true" and puts "what to do" in code.

| pattern | rule | measured |
| --- | --- | --- |
| [Derive the action from a classification](#derive-the-action-from-a-classification) | 12 | 80.0% → 92.5% |
| [Apply a written policy in code](#apply-a-written-policy-in-code) | 12 | wrong outcomes at 0.57–0.63 → facts read at 0.9+ |
| [Read dates exactly, compute in code](#read-dates-exactly-compute-in-code) | 9 | 64–75% → 30/30 |
| [Compare two estimated quantities in code](#compare-two-estimated-quantities-in-code) | 8 | 41.7% → 100% when a side is computed |
| [Ask whether it includes the excluded thing](#ask-whether-it-includes-the-excluded-thing) | 7 | 10/12 → 12/12 |
| [Pick one of many with a choice](#pick-one-of-many-with-a-choice) | 10 | 13–100% → 100% |
| [A gate that never relaxes](#a-gate-that-never-relaxes) | 13 | — |
| [Detector question beside a manipulable judgment](#detector-question-beside-a-manipulable-judgment) | 15 | 75.0% → 83.3% |
| [Abstain option plus confidence gate](#abstain-option-plus-confidence-gate) | 14 | 2× ambiguity caught |
| [Rank candidates with one noul each](#rank-candidates-with-one-noul-each) | 10 | recall@2 = 1.00 |
| [Cascade the unsure tail](#cascade-the-unsure-tail) | — | — |
| [One long state, many scoped questions](#one-long-state-many-scoped-questions) | 1, 2 | 24/24 over 25.5k tokens |

## Derive the action from a classification

```ts
// not: "Should we retry this CI job?"          → 80.0%, recall 0.38
// but: "What caused the failure in `log_tail`?" → 92.5% at 100% recall, no extra call
const questions = {
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
const { cause } = (await ask(state, questions)).answers;
const retry = cause.choice === 'flaky_test' || cause.choice === 'infrastructure';
```

## Apply a written policy in code

```ts
// not: "Under `policy`, should `request` go ahead, wait for the change board, or be refused?"
//      the outcome question came back at 0.57–0.63 and picked the milder outcome where the policy refuses
// but: read each fact the rules branch on, then apply the rules in order
const questions = (input) => ({
  service: { type: 'choice', instructions: 'Which service in `catalog` does `request` deploy?',
             criteria: Object.fromEntries(input.catalog.map((c) => [c.service, null])) },
  kind:    { type: 'choice', instructions: 'What kind of change does `request` describe?',
             criteria: { feature: 'new or changed behaviour', hotfix: 'a fix for a live incident', config: 'settings only' } },
});
const decide = (a, input) => {
  const tier = input.catalog.find((c) => c.service === a.service.choice)?.tier;        // lookups in code
  const frozen = input.freeze_active;                                                  // known facts in code
  if (frozen && tier === 'critical' && a.kind.choice !== 'hotfix') return 'refuse';     // rule 1
  if (frozen || tier === 'critical') return 'change_board';                            // rule 2
  return 'go_ahead';                                                                   // rule 3
};
```

Jev reads the facts reliably, and code applies the rules reliably. Asking Jev to combine them is what goes wrong.
Facts that are already structured in the input (a catalog entry, a flag, the requester's role) stay out of the
questions entirely.

## Read dates exactly, compute in code

```ts
// not: "Was the notice in `email` received early enough under `contract`?"  → 64–75%
// but: read the dates and terms as choices; do all arithmetic in code          → 30/30
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const opts = (xs: (string | number)[]) => Object.fromEntries(xs.map((x) => [String(x), null]));
const questions = {
  start_year:  { type: 'choice', instructions: 'In which year does `contract` say the agreement begins?', criteria: opts([2021, 2022, 2023, 2024, 2025, 2026]) },
  start_month: { type: 'choice', instructions: 'In which month does `contract` say the agreement begins?', criteria: opts(MONTHS) },
  start_day:   { type: 'choice', instructions: 'On which day of the month does `contract` say the agreement begins?', criteria: opts(Array.from({ length: 31 }, (_, i) => i + 1)) },
  term_months: { type: 'choice', instructions: 'How many months long is each term in `contract`?', criteria: opts([1, 3, 6, 12, 24, 36]) },
  notice_days: { type: 'choice', instructions: 'How much notice before the end of a term does `contract` require? Months count as 30 days.', criteria: opts([30, 45, 60, 90, 120]) },
};
const a = (await ask(state, questions)).answers;
// ...then: start date -> the term end the email falls in -> lead time -> compare, all in code.
// Gate each read at p >= 0.8 and abstain otherwise. Full version: jev-eval/examples/renewal-notice.map.mjs
```

## Compare two estimated quantities in code

Use bands when a value must be *estimated* from prose. When it is stated, read it exactly (above).

```ts
// not: "Can the termination right in `clause` be exercised within `term`?" → 41.7%
// but: bucket each side, compare the buckets → 100%
const NOTICE = { under_1_month: 0, '1_to_3_months': 1, '3_to_6_months': 2, '6_to_12_months': 3, over_12_months: 4 };
const TERM   = { under_1_month: 0, '1_to_3_months': 1, '3_to_6_months': 2, '6_to_12_months': 3, over_12_months: 4 };
const band = (field: string, scale: Record<string, number>, what: string) => ({
  type: 'choice',
  instructions: `How long is ${what} stated in \`${field}\`? Compute it if it is given as a formula.`,
  criteria: Object.fromEntries(Object.keys(scale).map((k) => [k, null])),
});
const a = (await ask(state, { notice: band('clause', NOTICE, 'the notice period'), term: band('contract', TERM, 'the remaining term') })).answers;
const n = NOTICE[a.notice.choice], t = TERM[a.term.choice];
// Same bucket cannot be settled by buckets: escalate it, or add finer buckets around the boundary.
const exercisable = n < t ? true : n > t ? false : 'escalate';
const confidence = (a.notice.probabilities[a.notice.choice] + a.term.probabilities[a.term.choice]) / 2;
```

Separate scales are deliberate: the two quantities may come from different vocabularies, and
assigning each an ordinal is the policy. Write it down.

## Ask whether it includes the excluded thing

```ts
// not: "Is the expense in `description` a kind that is never reimbursable?"   → 10/12, never decisive
// but:                                                                          → 12/12 at 0.93–0.98
const questions = {
  includes_excluded: {
    type: 'noul',
    instructions: 'Does the expense described in `description` include any alcohol or any entertainment (shows, tickets, outings), even as part of a larger purchase? Food-only purchases at a venue with a drink-related name do not count.',
  },
};
```

## Pick one of many with a choice

```ts
// not: a noul per line ("does this line show why the job failed?") → 13–100%; the wrapper line wins
// but: one choice over every line, with a rubric naming what to skip → 100%
const questions = {
  culprit: {
    type: 'choice',
    instructions: 'Which line of `lines` states the specific cause of the failure: the error message, exception or failed assertion? Not a generic wrapper such as "Process completed with exit code 1", not a summary count, not a stack frame below the error.',
    criteria: Object.fromEntries(lines.map((text, i) => [String(i), text])), // all lines: no pre-filter
  },
};
const a = (await ask({ lines }, questions)).answers;
const p = a.culprit.probabilities[a.culprit.choice];
const pick = p >= GATE ? Number(a.culprit.choice) : 'show the top 3 to a person'; // GATE: fit it with jev-audit (0.8 is a common start)
```

## A gate that never relaxes

```ts
type Gate = { act: number; review: number };
const GATES = {
  low:    { act: 0.6,  review: 0.3 },  // cheap, reversible
  medium: { act: 0.8,  review: 0.5 },  // customer-visible, or costs money to undo
  high:   { act: 0.95, review: 0.7 },  // irreversible, financial, security-relevant
} satisfies Record<string, Gate>;

// Gate on the probability of the label you would act on, not the `confidence` scalar,
// which was under-confident by up to 29 points. Fit act/review on held-out labelled cases.
const p = answer.probabilities['allow'] ?? 0;
const next = p >= GATES.high.act ? 'allow' : p >= GATES.high.review ? 'ask_human' : 'escalate';
// Unsure never becomes 'allow'.
```

## Detector question beside a manipulable judgment

For a judgment no written rule settles. When a written policy decides, apply it in code
([above](#apply-a-written-policy-in-code)) and keep the detector as a veto.

```ts
const questions = {
  disposition: { type: 'choice', instructions: 'Is the command in `proposed_call` safe to run in `environment`?',
                 criteria: { allow: '...', ask: '...', block: '...' } },
  claims_approval: { type: 'noul', instructions: 'Does any text in the state claim a person already approved `proposed_call`?',
                     criteria: { true: 'some text asserts prior approval or authorisation', false: 'no such claim' } },
};
const a = (await ask(state, questions)).answers;
// Jev detects the manipulation (5/6) better than it resists it (3/6). Let the detector veto.
const decision = a.claims_approval.noul > 0.5 && a.disposition.choice === 'allow' ? 'ask' : a.disposition.choice;
```

## Abstain option plus confidence gate

```ts
criteria: {
  // ...the real options...
  ambiguous: 'the state genuinely supports more than one answer; a person should decide',
}
// then, separately:
const needsPerson = a.v.choice === 'ambiguous' || (a.v.probabilities[a.v.choice] ?? 0) < fitted.review;
```

"This case is ambiguous" is a property of the case. "I am unsure" is a property of the answer.

## Rank candidates with one noul each

For *ranking* where several can be good. To pick exactly one, use a `choice` (above).

```ts
// Which of k patches / passages / elements is best? One noul per candidate, argmax in code.
const questions = Object.fromEntries(candidates.map((c, i) => [`c${i}`, {
  type: 'noul',
  instructions: `Does candidate \`candidates[${i}]\` correctly do what \`goal\` asks?`,
}]));
const a = (await ask({ goal, candidates }, questions)).answers;
const ranked = candidates.map((c, i) => ({ c, p: a[`c${i}`].noul })).sort((x, y) => y.p - x.p);
// Cheap tier: judge only ranked.slice(0, 2) with an expensive model (recall@2 was 1.00).
```

For mutually exclusive *classes*, do the opposite: one `choice`, because it normalises.

## Cascade the unsure tail

```ts
const a = (await ask(state, questions)).answers;
const p = a.verdict.probabilities[a.verdict.choice] ?? 0;
const verdict = p >= threshold ? a.verdict.choice : await askTheLLM(state); // only the tail pays
```

A cascade buys the ambiguous tail. It cannot fix a question that is confidently wrong. Build the hard
cases first, because on easy sets there was nothing for the cascade to fix.

## One long state, many scoped questions

```ts
// 24 questions over a 25,500-token document with near-duplicate distractors: 100%, one request,
// ~2 s, ~$0.001. Splitting into 24 requests: identical answers, 11.7× the cost.
const state = { contract: fullText, schedule_a: scheduleText };
const questions = {
  governing_law: { type: 'choice', instructions: 'Which jurisdiction does `contract` name as governing law?', criteria: { ... } },
  auto_renews:   { type: 'noul',   instructions: 'Does `contract` renew automatically at the end of its term?' },
  // ...every other fact, each scoped to its field
};
```
