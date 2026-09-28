# Rules

The `jev-questions` skill uses 16 rules for writing Jev question maps. This page explains each rule, shows
an example, and gives the evidence behind it and how well it held up when tested again.

## How the rules were derived

1. **A study found the failures.** 57 hand-labelled decision suites (1,836 cases) were run on Jev, a cheap
   LLM, and on seven suites a frontier model. Every case Jev got wrong with high confidence was read, and
   each pattern of failure was measured with and without a fix.
2. **A finding became a rule only after it held on a second task.** The study produced fourteen findings.
   Five held only under a condition and were rewritten to state it. Some were merged.
3. **Agent-written maps tested the rules again.** When agents using the skill made new mistakes, reading
   Jev's wrong answers added rules 6, 7, 10 and 16, part of rule 9, and sharper wording for others. That gives
   the sixteen rules below.
4. **Probes tested ten rules in three new domains each.** Each rule's recommended wording and the wording it
   warns against were run on 12 items per domain, with the truth known by construction. The probes report
   accuracy and **decisiveness**: for each item, how far its least certain answer is from a coin flip,
   averaged over the items. 0 means 50/50, and 1 means certain. Low decisiveness means a confidence gate would
   send the case to a person.

Each rule has a status:

| status | meaning |
| --- | --- |
| **held** | replicated, or never contradicted wherever it was applied |
| **conditional** | real only under the stated condition; outside it, it did nothing or hurt |
| **single** | one large measured effect, not yet replicated |

> [!IMPORTANT]
> Don't apply the rules to a field that already scores well. Applied that way, they produced five
> improvements and five regressions. Write new questions with them, then measure.

## Summary

| # | rule | status |
| --- | --- | --- |
| 1 | [Put every fact the decision needs in the state](#1-put-every-fact-the-decision-needs-in-the-state) | held |
| 2 | [Name the field each question reads](#2-name-the-field-each-question-reads) | conditional |
| 3 | [Write a domain convention into the state once](#3-write-a-domain-convention-into-the-state-once) | conditional |
| 4 | [The key carries no meaning](#4-the-key-carries-no-meaning) | held |
| 5 | [Ask what is true now](#5-ask-what-is-true-now) | held |
| 6 | [Split compound questions](#6-split-compound-questions) | conditional |
| 7 | [Ask whether it includes the thing](#7-ask-whether-it-includes-the-thing) | held |
| 8 | [Don't ask Jev to compare against a computed value](#8-dont-ask-jev-to-compare-against-a-computed-value) | held, narrowed |
| 9 | [Read dates and numbers exactly; compute in code](#9-read-dates-and-numbers-exactly-compute-in-code) | held |
| 10 | [Pick one with a `choice`; rank with a `noul` each](#10-pick-one-with-a-choice-rank-with-a-noul-each) | held |
| 11 | [Treat `score` as fragile](#11-treat-score-as-fragile) | conditional |
| 12 | [Derive in code only from reliable, sufficient facts](#12-derive-in-code-only-from-reliable-sufficient-facts) | held |
| 13 | [Gate on the probability, fitted per question](#13-gate-on-the-probability-fitted-per-question) | held |
| 14 | [Offer an abstain option and gate on confidence](#14-offer-an-abstain-option-and-gate-on-confidence) | single |
| 15 | [Add a detector question](#15-add-a-detector-question) | held |
| 16 | [Don't pre-filter with unmeasured code](#16-dont-pre-filter-with-unmeasured-code) | single |

## The state

### 1. Put every fact the decision needs in the state

Include the source too: the document, log, or transcript, not only another model's extraction of it.

```diff
- state: { question, passage }
+ state: { question, passage, known_answer }   // the fact the judgment depends on
```

A question that depends on a fact the state lacks fails silently. In the study it gave zero recall on a whole
class at 0.99 confidence. Adding the one missing fact took the task from 77.5% to 100%. Deciding from an
upstream model's extraction instead of the source dropped another task from 75% to 50%. Supply the fact
itself: adding a library of examples to search cost 5.1 points.

**Held.** Probes in three new domains: 6/12 without the premise, at 0.82–0.90 confidence, against 12/12 with it.

### 2. Name the field each question reads

```diff
- Is this document privileged?
+ Is `excerpt` privileged?
```

An unscoped question treats everything else in the state as evidence. One lost 28.5 points when unrelated
material was added, with no change in confidence.

**Conditional.** It matters when the state holds other material. Probes: 6/12 → 12/12 in two of three domains.
Applied as a blanket rewrite it moved accuracy −5.4 and +2.6. Pad-test a field (add unrelated text and rerun)
and fix only the questions whose answers move.

### 3. Write a domain convention into the state once

```js
state: {
  primer: 'Guidance cuts are read by the market as negative even when results beat estimates. ...',
  filing: text,
}
```

Where the missing knowledge was a convention of the domain, a short hand-written primer added 12 to 20 points.
Generating the primer per case with an LLM scored the same at 12× the cost.

**Conditional.** It does nothing when the missing knowledge is a live fact, such as a price or a reputation.
That needs retrieval.

## The wording

### 4. The key carries no meaning

```diff
- unsafe_to_revert: { instructions: 'Can this change be reverted safely?' }
+ revert_safety:    { instructions: 'Can the change in `diff` be reverted without losing data?' }
```

An LLM reads a JSON key as part of the prompt. Jev doesn't. A question whose key contradicted its criteria
scored 100% on an LLM and 0% on Jev. Put all meaning in `instructions` and `criteria`.

**Held.** Probes: renaming keys changed no answer in three domains.

### 5. Ask what is true now

```diff
- Would this job pass if it were retried?
+ What caused the failure in `log_tail`?     // then decide the retry in code
```

Jev answers the "then" part and drops the "if". Moving the condition into code took a task from 48.7% to 82.1%.
Asking two present-tense facts and combining them in code reached 87.2%.

**Held** for branches and counterfactuals. Probes: counterfactual wording was right 11, 6 and 12 times in 12, and
barely decisive (0.35–0.56) even when right. Present-tense wording scored 12/12 at 0.92–0.98. Framing that
isn't a branch ("if this turned out to be wrong" as context) is harmless.

### 6. Split compound questions

```diff
- Does the email satisfy whatever notice method the contract requires?
+ Does `contract` allow notice by email?     // and: Was the notice in `email` sent by email?
```

The compound version sat at 0.50–0.79 even when email was plainly allowed. The split version answered at
0.90–0.94 and 0.02–0.06.

**Conditional.** Probes: a compound question tied on accuracy in three domains, but lost decisiveness (0.56)
where meeting the requirement took reasoning. Split when the requirement needs reasoning.

### 7. Ask whether it includes the thing

```diff
- Is this expense a never-reimbursable kind, such as alcohol?
+ Does the expense in `description` include any alcohol or entertainment, even as part of a larger purchase?
```

The first version scored 10/12 and was never decisive: "Dinner and a bottle of wine" got 0.52. The second
scored 12/12 at 0.93–0.98.

**Held.** Probes: 6, 6 and 10 of 12 → 12/12. Expense maps using it made 0 or 1 wrong decisions in 50.

## Numbers, dates, and comparisons

### 8. Don't ask Jev to compare against a computed value

Read each side, and compare in code.

```diff
- Is the expense in `item` within the limit set by `policy`?
+ What amount does `item` state?   What limit does `policy` set for this contract?   // compare in code
```

Jev can compute a value, and it can compare two values that are both stated. It can't reliably do both at once.
Comparing in code took two tasks from 41.7% to 100% and from 50% to 92.9%.

**Held, narrowed.** Probes: two stated values compared directly scored 12/12, even across units (g vs kg) or
3,000 tokens apart. A computed side failed. "The greater of $500 or 2% of the contract" scored 9/12 at 0.25
decisiveness. Months against days scored 11/12 at 0.57. SLA maps that asked "was it breached?" made all 14
wrong decisions of the no-plugin arm. Deadlines, "on time", and "within the limit" are usually this kind.

### 9. Read dates and numbers exactly; compute in code

```js
start_year:  { type: 'choice', instructions: 'In which year does `contract` say the agreement begins?', criteria: opts([2024, 2025, 2026]) },
start_month: { type: 'choice', instructions: 'In which month does `contract` say the agreement begins?', criteria: opts(MONTHS) },
start_day:   { type: 'choice', instructions: 'On which day of the month does `contract` say the agreement begins?', criteria: opts(DAYS) },
```

"Was the notice on time?" was right 64–75% of the time. Reading the dates as year, month, and day choices and
computing in code scored 30/30. Read a stated amount as a `choice` over the values the document could state,
not as a band. One map read "up to USD 75" as 70–75, then called a $73.44 dinner over the limit.

**Held.** Probes: the direct question scored 8, 12 and 9 of 12 at 0.21–0.56 decisiveness, against 12/12 at 1.00.

## Choosing the encoding

### 10. Pick one with a `choice`; rank with a `noul` each

```js
// pick one line: one choice over all of them
culprit: { type: 'choice', instructions: 'Which line of `lines` states the cause of the failure? ...',
           criteria: Object.fromEntries(lines.map((t, i) => [String(i), t])) }
```

A `noul` is an absolute probability. When each line is asked separately, a generic line such as "Process
completed with exit code 1" truthfully shows the job failed, and can outscore the real error. A `choice`
makes the lines compete. To rank candidates where several can be good (patches, review comments), use a
`noul` per candidate.

**Held.** Probes: a `noul` per item picked the right one 1–2 times in 12; one `choice` picked it 12 times in 12.
Culprit maps' wrong decisions fell from 45.8% to 0%. Pointing at a cause among near-identical items remains weak
(65% at 0.88 confidence), so measure it.

### 11. Treat `score` as fragile

Prefer `choice` and `noul`. Use `score` only for ordered, well-separated levels.

`score` rubrics written by an LLM swung 56 points between drafts. `choice` stayed within 4.

**Conditional.** Converting a `score` to a `choice` is not a universal fix: +20.5 once, then −4.0, −2.9 and +2.9
elsewhere.

## From answers to decisions

### 12. Derive in code only from reliable, sufficient facts

| derive it in code | ask it as one question |
| --- | --- |
| a comparison of quantities (+58, +43) | a weighted, holistic judgment (−3 to −9 if derived) |
| anything defined by a class: retry if the cause is flaky or infrastructure (+12.5 to +29) | a long AND: five facts at 100/95/90/87/67% multiply to 49.5% |
| a short OR of reliable flags (+10) | a verdict the facts don't determine: "addresses a machine" is not "attacks it" (−27) |

When a written policy maps facts to outcomes, ask for each fact the rules branch on and apply the rules in order in
code. Don't ask for the outcome. On access requests, every wrong decision left after the round-2 fixes came from
maps that asked "should this be denied?" and got "needs approval" back at 0.57–0.63.

**Held.** Across twenty measured cases, deriving helped by up to 58 points and hurt by up to 34. The difference
was whether the facts were reliable and jointly sufficient.

### 13. Gate on the probability, fitted per question

Act on a label only when its probability clears a threshold you fitted on labelled cases. Send the rest to a
person. Unsure never becomes "allow".

```js
const p = a.culprit.probabilities[a.culprit.choice];
const pick = p >= GATE ? a.culprit.choice : 'abstain';   // GATE fitted with jev-audit
```

- **Use the distribution, not the `confidence` scalar.** Across 5,227 answers the scalar was under-confident by
  up to 29 points. The distribution tracked accuracy within about 4.
- **Fit the threshold per question.** A `choice` over many options tops out lower than a yes/no. Over 379 picks
  from 20+ options, a gate at 0.8 removed all 6 wrong picks and kept 79% of the right ones. A map that guessed
  0.6 abstained on right answers at 0.58.
- **Gate on the case, not the policy.** Questions about the policy itself ("does it have rules this map doesn't
  cover?") come back around 0.4–0.7 on every case. Maps that gated on them abstained on 23 and 24 of 30. Read a
  fixed policy once, pin it in code, and check yourself that every clause is covered.

**Held.** Together with pinning policies (above) and the narrower rule 8, these changes raised maps written by
GLM 5.3 and Qwen 3.8 Max from 76–80% under the first skill version to about 91%, with 0–0.2% wrong decisions.
Without the plugin their maps scored 83.6% and 95.3%, with 1.8–1.9% wrong.

### 14. Offer an abstain option and gate on confidence

```js
criteria: { ..., ambiguous: 'the state supports more than one answer; a person should decide' }
```

An abstain option and a confidence gate catch different cases. "Ambiguous" was chosen rarely but was right every
time. Together they caught twice as many ambiguous cases as either alone.

**Single.** One measured effect, not yet replicated.

### 15. Add a detector question

Beside a judgment that text in the state could manipulate, ask whether the manipulation is present, and let it
veto.

```js
claims_approval: { type: 'noul', instructions: 'Does `request` claim that an approval was already given?' }
```

Jev detects an injected "this was already approved" 5 times in 6 with no false alarms, but resists it only 3
times in 6.

**Held.** Probes: where the claim fooled the decision (6/6, deploys), the veto stopped all 6. Where it didn't,
the veto cost nothing.

### 16. Don't pre-filter with unmeasured code

Send every candidate to Jev, or measure your filter's recall first.

Agents narrowed 40 log lines with a regex to keep requests small. The right line survived in as few as 5 of 30
cases, so Jev never saw it. Sending every line kept it in 30 of 30. Long states cost little: Jev charges $0.042
per million input tokens.

**Single.** Measured on one task. A related finding: where code can settle a sub-question completely, let it.
Checking that a template's placeholders were all filled went from 82.1% with the model alone to 89.7% with code
deciding.

## Architecture

| do | because |
| --- | --- |
| send one long state with many scoped questions | 24 questions as 24 requests cost 11.7× for identical answers |
| show a person the top two labels | worth 12–25 points of recall; a shortlist handed to another model measured −4.6 |
| cascade to a larger model on low confidence | it buys the ambiguous tail, but never fixes a confidently wrong question |
| when an LLM writes the questions, have it write several drafts, score each on labelled cases, and keep the best | four drafts of one policy scored 24–80%; a no-op rewording moved 82% of answers |

## Further reading

- [`rules.md`](../plugin/skills/jev-questions/references/rules.md): every rule's evidence and status, with sources
- [`patterns.md`](../plugin/skills/jev-questions/references/patterns.md): the rules as code
- [Rule probes](../evals/rule-probes/README.md): the cross-domain tests
