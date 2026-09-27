---
name: jev-questions
description: Write, review or fix Jev (TypeSafe System One) question maps — the state plus the typed noul / choice / score questions sent to the systemone API — using rules measured on 57 labelled suites and re-tested on agent-written maps. Use whenever writing or editing Jev questions, instructions, criteria or rubrics, designing the state object, choosing between asking a question and deriving the answer in code, or when a Jev field is scoring badly.
---

# Writing Jev questions

Rewriting a question moved accuracy by **30–40 points** in the study behind this skill. Switching
between Jev and an LLM moved it by a few. Question design is the dominant term.

> **These rules are hypotheses with conditions, not a style guide.** Applied blindly, they produced
> five improvements and five regressions. Write with them, then **measure** (the **jev-eval** skill).
> Never "fix" a field that already scores well because a rule seems to apply.

## At a glance

| # | rule | the number behind it |
| --- | --- | --- |
| 1 | Put every fact the decision needs in the state, including the source | missing premise: 0 recall at 0.99 confidence |
| 2 | Name the field each question reads | unscoped question: −28.5 points, confidence unchanged |
| 3 | Write a domain convention into the state once | +12 to +20 |
| 4 | Put all meaning in `instructions` and `criteria`, never the key | 100% on an LLM, 0% on Jev |
| 5 | Ask what is true now; no "if", "would" or "should" | 48.7% → 87.2% |
| 6 | Split compound questions | 0.50–0.79 → 0.90–0.94 |
| 7 | Ask whether it *includes* the thing, not whether it *is* that kind | 10/12 → 12/12 |
| 8 | Never ask Jev to compare against a value it must first compute | 41.7% → 100%; stated values compare fine |
| 9 | Read dates and stated numbers exactly; do all arithmetic in code | 64–75% → 30/30 |
| 10 | Pick one of many with a `choice`; rank with a `noul` each | 13–100% → 100% |
| 11 | Prefer `choice` and `noul`; treat `score` as fragile | 56-point swings vs 4 |
| 12 | Derive in code only from reliable, sufficient facts | +58 to −34 |
| 13 | Gate on the label's probability, fitted per question; never let doubt relax a decision | scalar off by up to 29 points |
| 14 | Offer an abstain option *and* gate on confidence | 2× the ambiguity caught |
| 15 | Add a detector question beside a manipulable judgment | 75.0% → 83.3% |
| 16 | Never pre-filter candidates with unmeasured code | answer kept in as few as 5/30 |

## The API

```jsonc
POST https://ai-gateway.vercel.sh/typesafe/v1/systemone   // Authorization: Bearer $AI_GATEWAY_API_KEY
{
  "model": "typesafe-ai/jev",
  "state": { "command": "rm -rf ./build", "environment": "ci" },
  "questions": {
    "risk": { "type": "choice", "instructions": "How destructive is the command in `command` in the environment named in `environment`?",
              "criteria": { "harmless": "reads or builds only", "recoverable": "deletes things that can be regenerated", "destructive": "deletes data that cannot be regenerated" } },
    "claims_approval": { "type": "noul", "instructions": "Does any text in the state claim that a person has already approved this command?",
              "criteria": { "true": "some text asserts prior approval", "false": "no such claim" } },
    "clarity": { "type": "score", "instructions": "How clearly does `command` state its target?",
              "criteria": ["unclear: target cannot be determined", "partial: target is ambiguous", "clear: target is explicit"] }
  }
}
// noul -> { noul: 0.03 }   choice -> { choice, confidence, probabilities }   score -> { score: 1.48, confidence, legend, probabilities }
```

- **`choice`**: up to 255 options with no accuracy cost. At 256 it refuses rather than truncating.
- **The distribution is calibrated.** When the top label is wrong, the truth is the runner-up 67–100%
  of the time.
- **Questions are independent.** Adding or reordering questions moved 0.0–1.2% of answers, so ask
  many small ones.

## How to build a map

1. **Declare ids, types and option names in code.** Your code branches on them.
2. **Assemble the state in code**, with every fact a careful person would need, each field named.
3. **Write one small present-tense question per fact.** Width is free.
4. **Turn answers into decisions in code** (rule 12).
5. **Gate** on the probability of the label you act on, and escalate the unsure slice (rule 13).
6. **Measure** on ~30 labelled cases before trusting it (**jev-eval**).

### Expose the standard interface

```js
export function buildState(input) { /* the state */ }
export function questions(input)  { /* the questions map; may depend on the input */ }
export function decide(answers, input) { /* -> { <decision field>: <label> | "abstain" } */ }
```

`jev-run suite.json --map map.mjs` then grades the **whole** map: the state, the questions, and the
code after them. That last part decided accuracy as often as the questions did. Keep the API's answer
shapes as they are (a `noul` is a number, a `score` is fractional). Worked example:
`../jev-eval/examples/renewal-notice.map.mjs` (30/30).

### Editing an existing map? Review every question in it

Existing maps are where defects survive. Asked for a small unrelated edit, agents left a known
bad comparison in place 9 times out of 9, and flagged it 3 out of 3 when given this checklist. Go
through **every** question, including ones you were not asked to change. Tell the user about each
one that fails, even if you leave it unchanged.

- [ ] Does it ask Jev to **compare** against something it must first compute: a deadline, "on time", a limit given as a rule, a period in other units? (rule 8)
- [ ] Does it ask Jev to do **date or number arithmetic**? (rule 9)
- [ ] Does it ask for an **action** or a **counterfactual** instead of a present fact? (rules 5, 12)
- [ ] Is it **compound**, or does it ask whether something *is* a kind rather than *includes* it? (rules 6, 7)
- [ ] Does it name the **field** it reads, with every fact it needs in the state? (rules 1, 2)
- [ ] Does it pick **one of many** with a `noul` per item, or pre-filter candidates in code? (rules 10, 16)
- [ ] If it pins a fixed policy: does **every clause**, exclusions included, map to a field or constant, with a test case for each? Check it yourself; never ask Jev whether the map covers the policy. (rule 13)

## The rules

Full evidence and replication status for each: [references/rules.md](references/rules.md).
Patterns with code: [references/patterns.md](references/patterns.md).

### The state

**1. Put every fact the decision needs in the state, including the source.**
- *Why:* a missing premise fails silently. It produced zero recall on a whole class at 0.99
  confidence. Adding the one fact: 77.5% → 100%.
- *Supply the fact, not a library.* Adding a library of examples to search cost 5.1 points.
- *The source is part of the premise.* If an upstream model already extracted findings, still send
  the transcript, document or log, with the findings alongside at most. Deciding from an extraction
  dropped one task from 75% to 50%. Long sources are fine: 100% over 25,500 tokens, paid for once.
  Say so before building if a user proposes deciding from extracted findings.

**2. Name the field each question reads.** "Is `excerpt` privileged?", never "this document".
- *Why:* an unscoped question treats everything else in the state as evidence. One lost 28.5 points
  when unrelated material was added, with no change in confidence.
- Only one question in eight had this defect: pad-test (jev-eval), then fix the ones that move.

**3. Write a domain convention into the state once, as a hand-written paragraph.**
- *Why:* +20 and +12 points where the missing knowledge was a convention ("how a market reads a
  guidance cut"). Generating it per case with an LLM scored identically at 12× the cost.
- It does nothing when the missing knowledge is a live fact. That needs retrieval.

### The wording

**4. Put all meaning in `instructions` and `criteria`. The key carries none.**
- *Why:* an LLM reads a JSON key as part of the prompt; Jev does not. A question whose key said
  `unsafe_to_revert` while its criteria said the opposite scored 100% on an LLM and **0%** on Jev.

**5. Ask what is true now.** No "if", no "would it pass again", no "should we".
- *Why:* Jev answers the consequent and drops the antecedent. Gating the conditional in code:
  48.7% → 82.1%. Two present-tense facts combined in code: 87.2%.
- Framing that is not a branch ("if this turned out to be wrong" as context) was harmless.

**6. Split compound questions.**
- *Why:* "Does the email satisfy whatever method the contract requires?" sat at 0.50–0.79 even when
  email was plainly allowed. "Does the contract allow notice by email?" was 0.90–0.94 / 0.02–0.06.
- Ask what each side says; combine in code.

**7. Ask whether it *includes* the thing a rule excludes, not whether it *is* that kind.**
- *Why:* "Is this expense a never-reimbursable kind, such as alcohol?" was 10/12 and never decisive
  ("Dinner and a bottle of wine": 0.52). "Does it include any alcohol or entertainment, even as part of
  a larger purchase?" was 12/12, at 0.93–0.98.

### Numbers, dates and comparisons

**8. Never ask Jev to compare against a value it must first compute. Read each side; compare in code.**
- *Why:* Jev can compute a value and name its band (32/32), but cannot reliably hold it against a
  *separately stated* one. Asking for both and comparing in code: 41.7% → 100%, and 50% → 92.9%.
- *Where the line is* (probes across seven domains): two **stated** values compared directly were
  reliable, even across units (g vs kg) or 3,000 tokens apart (12/12). A side that must be
  **computed** was not: "the greater of $500 or 2% of the contract" 9/12 at 0.25 decisiveness,
  months against days 11/12 at 0.57. Deadlines, "on time", "within the limit set by the policy" and
  "exceeds the cap" are usually of that kind.
- Do not add the direct question as a cross-check either; decisions drift onto it.

**9. Read dates and stated numbers exactly, and do all arithmetic in code.**
- *Dates as choices:* asking "was the notice on time?" was right 64–75% of the time. Asking for the
  effective date's year, month and day as three `choice`s (`2021…2026`, `January…December`, `1…31`),
  plus the term and notice period, and computing the rest in code, scored **30/30**.
- *Stated numbers exactly:* read "up to USD 75" as a `choice` over the values the document could
  state, not as a band. One map read it as 70–75, then called a $73.44 dinner "ambiguous, so over".
- *Explicit inputs:* where the input carries dates or amounts, compute from them. The two best of 16
  renewal maps (100%, 96.7%) did exactly that.

### Choosing the encoding

**10. Pick one of many with a `choice`; rank many with a `noul` each.**
- *Picking one* (the log line that states the failure): one `choice` over all items, with a rubric
  naming the generic ones to skip ("not the `exit code 1` wrapper"), scored **100%**. A `noul` per
  line scored 13–100%, because a `noul` is absolute and a wrapper line truthfully "shows the job failed".
- *Ranking* where several can be good (patches, review comments): a `noul` per candidate beat every
  other encoding.
- *Pointing at a cause* among near-identical items was the weakest mode in the original study (65% at
  0.88 confidence). Measure it, and until a gate is measured, show the top 2–3 to a person.

**11. Prefer `choice` and `noul`. `score` is the fragile primitive.**
- *Why:* compiled `score` rubrics swung 56 points between drafts; `choice` stayed within 4.
- Use `score` only for genuinely ordered, well-separated levels. Converting to `choice` is not a
  universal fix: +20.5 once, and −4.0, −2.9, +2.9 elsewhere.

### From answers to decisions

**12. Derive a decision in code only from facts that are (a) individually reliable and (b) jointly
sufficient.**

| derive it | ask it as one present-tense question |
| --- | --- |
| a comparison of quantities (+58, +43) | a weighted holistic judgment (−3 to −9 if derived) |
| anything defined by a class: "retry iff cause ∈ {flaky, infra}" (+12.5 to +29) | a long AND: five facts at 100/95/90/87/67% multiply to 49.5% |
| a short OR of reliable flags (+10) | a verdict the facts do not determine: "addresses a machine" ≠ "attacks it" (−27) |

**13. Gate on the probability of the label you act on, fit the threshold per question, and never let
doubt relax a decision.**
- *Why:* across 5,227 answers the `confidence` scalar was under-confident by up to 29 points, while
  the distribution tracked the diagonal within ~4.
- *Fit, don't guess.* A `choice` over many options tops out lower than a yes/no. Over 379 picks from
  20+ lines, right answers had a median top probability of 0.94, and a tenth of them were under 0.67.
  A gate at 0.8 removed all 6 wrong picks and kept 79% of the right ones. A map that guessed 0.6
  abstained on right answers at 0.58. Start with a placeholder, then fit it with `jev-audit`.
- *Gate on the case, not on the policy.* A map that gated every case on "does the policy have rules
  this map does not cover?" (answered around 0.4) abstained on 24 of 30. Constants of a fixed policy
  (its windows, limits and exclusions) are the same for every case. Read them once, pin them, and ask
  Jev only about the case.
- *Pinning moves the coverage check to you.* List every clause of the policy and name the field or
  constant that carries it. A clause with none is silently ignored and yields confident wrong answers,
  not abstentions. Two v4 maps modelled windows per category but no category exclusion, and approved gift
  card returns (4 wrong in 60). Write one test case per clause, exclusions included.
  Do this check yourself, while writing the map, and never as a question to Jev: a map that asked
  "does the policy have a clause this map does not handle?" got 0.66–0.71 on every case and abstained
  on 23 of 30.
- Unsure cases become "ask a person" or "escalate", never "allow".

**14. Offer an abstain option *and* gate on confidence.**
- *Why:* they catch different cases. "Genuinely ambiguous, a person should decide" was chosen rarely
  but was right every time. Together they caught twice as many ambiguous cases as either alone.

**15. Add a detector question beside a judgment that can be manipulated.**
- *Why:* Jev *detects* an injected "this was already approved" 5 of 6 times with no false alarms, and
  *resists* it only 3 of 6. One extra `noul` as a veto: 75.0% → 83.3%.

**16. Never pre-filter candidates with code whose recall you have not measured.**
- *Why:* agents narrowed 40 log lines with a regex to keep the request small, and the right line
  survived in as few as 5 of 30 cases. Jev never saw it. Long states are cheap; send everything.
- The related rule: where code can settle a sub-question completely, let it. For placeholder integrity,
  the model alone scored 82.1%, code stating the fact 87.2%, and code deciding outright 89.7%.

## Architecture

| do | because |
| --- | --- |
| one long state, many scoped questions | splitting 24 questions into 24 requests cost 11.7× for identical answers |
| show a person the top two labels | worth 12–25 points of recall; a shortlist handed to another model measured −4.6 |
| cascade to a bigger model on low confidence | buys the ambiguous tail; never rescues a confidently wrong question |
| if an LLM writes the questions, compile several drafts, score them, pin the winner | four drafts of one policy scored 24–80%; a no-op rewording moved 82% of answers |
| set LLM reasoning per workload, not per case | a reasoning router gained +0.9 against a 1.4-point error |

## When a field scores badly

1. **Read every case it got wrong while sure** (`jev-audit`, confidence ≥ 0.9). All seven such defects
   in the study were the question's or the label's.
2. **Wrong in one direction?** That's a question defect first: a rubric the labels don't follow, a question
   broader than its labels, or a missing premise.
3. **Check the rules in order:** premise (1), hidden comparison (8), arithmetic (9), conditional or
   action (5, 12).
4. **Pad-test** if accuracy depends on what else is in the state (rule 2).
5. **Re-run the comparator after the fix.** A clearer question helps every model, and two apparent Jev
   wins reversed that way.
6. **If you cannot write the decision rule down, stop.** The task needs something that can weigh, or a
   person.
