# Rule probes: do the rules hold beyond the task they were found on?

> **In short.** For 10 of the skill's rules, the same items were asked two ways, the rule's
> recommended wording and the one it warns against, across three domains each, with truth set by
> construction. Subject: Jev (`typesafe-ai/jev`) only.
> - **Held in every domain (7 rules):** 1, 4, 5, 7, 9, 10, 15.
> - **Held under its condition (rule 2):** naming the field mattered in the two domains where the state held other material.
> - **Only partly supported (rule 6):** the warned wording tied on accuracy, and lost decisiveness in one domain.
> - **Narrowed (rule 8):** comparing two *stated* values is reliable; comparing against a value that must first
>   be *computed* is not.

## Method

- `probes.mjs`: rules 2, 4, 5, 6, 7, 8, 9, 10.
- `probes-rule8.mjs`: rule 8, hardened.
- `probes-more.mjs`: rules 1 and 15.
- **Items:** 12 per domain, generated with truth by construction. Fictional facts are used where priors
  could answer (rule 1).
- **Metrics:**
  - **accuracy:** the share of items the wording got right;
  - **decisiveness:** mean of the least confident answer per item (for a `noul`, |p − 0.5| × 2; for a
    `choice`, the chosen option's probability). Low decisiveness means a gate would abstain.
- **Models:** Jev only. No LLM is involved.

## Results

| rule | domain | warned wording | recommended wording |
| --- | --- | ---: | ---: |
| **1** premise in the state | product specs | 6/12 (0.90) | **12/12** (0.92) |
| | company policy | 6/12 (0.85) | **12/12** (0.85) |
| | fictional history | 6/12 (0.82) | **12/12** (0.89) |
| **2** name the field (padding with trigger content) | privilege | 12/12 (0.76) | 12/12 (0.90) |
| | personal data | 6/12 (0.97) | **12/12** (0.85) |
| | profanity | 6/12 (0.74) | **12/12** (0.91) |
| **4** the key carries no meaning | refunds, deploys, security | 12/12 each | 12/12 each (identical answers) |
| **5** present fact, not counterfactual | CI retry | 11/12 (0.35) | **12/12** (0.98) |
| | card payments | 6/12 (0.56) | **12/12** (0.92) |
| | webhooks | 12/12 (0.42) | 12/12 (0.93) |
| **6** split compound questions | notice method | 12/12 (0.95) | 12/12 (0.97) |
| | file format | 12/12 (0.97) | 12/12 (0.97) |
| | delivery signature | 12/12 (**0.56**) | 12/12 (0.91) |
| **7** "includes", not "is a kind" | allergens | 6/12 (0.69) | **12/12** (0.85) |
| | hazmat shipping | 6/12 (0.82) | **12/12** (0.86) |
| | content policy | 10/12 (0.66) | **12/12** (0.90) |
| **8** compare in code: simple stated values | baggage, age limit, budget | 12/12 each (0.95–0.97) | 12/12 each (1.00) |
| **8** hardened | unit conversion (g vs kg) | 12/12 (0.95) | 12/12 (1.00) |
| | 3,000 tokens apart | 12/12 (0.96) | 12/12 (1.00) |
| | **computed limit** ("the greater of $500 or 2%") | **9/12 (0.25)** | **12/12** (0.87) |
| | **mixed periods** (months vs days) | 11/12 (**0.57**) | **12/12** (0.99) |
| **9** dates as choices | invoice | 8/12 (0.21) | **12/12** (1.00) |
| | warranty | 12/12 (0.42) | 12/12 (1.00) |
| | library | 9/12 (0.56) | **12/12** (1.00) |
| **10** pick one with a `choice` | FAQ passage | **2/12** (0.92) | **12/12** (1.00) |
| | email thread | **1/12** (0.92) | **12/12** (1.00) |
| | config | **2/12** (0.89) | **12/12** (1.00) |
| **15** detector veto | access | 12/12 (fooled 0/6) | 12/12 (fooled 0/6) |
| | refunds | 12/12 (fooled 0/6) | 12/12 (fooled 0/6) |
| | deploys | 6/12 (**fooled 6/6**) | **12/12** (fooled 0/6) |

Decisiveness is in brackets. Raw per-probe results: `results.json`, `results-rule8.json`, `results-more.json`.

## What changed in the rules

| rule | before | after these probes |
| --- | --- | --- |
| 1 | held | **held in three more domains**; the failure is confident (0.82–0.90), exactly as warned |
| 2 | conditional | **held in three domains**; "this document" failed in two of them when the state held other material |
| 5 | conditional | **held**; even where the counterfactual was right, it was indecisive (0.35–0.56), so a gate would abstain |
| 6 | single | **narrowed**: a compound question is fine when the requirement is simple; it loses decisiveness when meeting it takes reasoning |
| 7 | held | **held in three more domains** (6/12 → 12/12 twice) |
| 8 | "never ask Jev to compare" | **narrowed**: two stated values compare reliably, even across units or 3,000 tokens; a value that must be *computed* (a rule-derived limit, a period in other units, a deadline) must be read and compared in code |
| 9 | held | **held**; the direct question was also barely decisive (0.21–0.56) |
| 10 | held | **held, strongly**: a `noul` per item picked the right one 1–2 times in 12, a `choice` 12 in 12 |
| 15 | single | **held**: where the attack worked (6/6 fooled), the veto stopped all of it; where it did not, the veto cost nothing |
