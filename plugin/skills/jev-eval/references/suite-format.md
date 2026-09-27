# Suite format

Two shapes, one per way of running:

| mode | each case has | the suite has | graded |
| --- | --- | --- | --- |
| **field-level** (`jev-run suite.json`) | `state`, `gold` per question | `questions` | each question's answer |
| **whole-map** (`jev-run suite.json --map map.mjs`) | `input`, `gold` per *decision field* | no `questions` | the map's `decide()` output |

## Field-level

One JSON file per suite. `jev-run` sends every case's `state` with the same `questions` map.

```json
{
  "name": "support-triage",
  "description": "optional, for people",
  "questions": {
    "department": {
      "type": "choice",
      "instructions": "Which team should handle the customer message in the state?",
      "criteria": { "billing": "charges, invoices, refunds", "technical": "bugs, errors, how-to", "account": "login, access, profile", "shipping": "delivery, returns, damage" }
    },
    "refund": {
      "type": "noul",
      "instructions": "Is the customer asking for money back in this message?",
      "criteria": { "true": "the message asks for a refund, credit or chargeback", "false": "no such request, even if one might be warranted" }
    },
    "urgency": {
      "type": "score",
      "instructions": "How urgent is the customer message in the state?",
      "criteria": ["low: a question or request with no time pressure", "medium: something is wrong but work continues", "high: blocked, losing money, or a security concern"]
    }
  },
  "cases": [
    {
      "id": "triage-001",
      "state": "I was charged twice for the same order last Tuesday. Can someone look into it?",
      "gold": { "department": "billing", "urgency": "medium", "refund": "yes" },
      "tags": ["clean"],
      "notes": "why this case exists: what it probes"
    }
  ]
}
```

## Whole-map

The map builds the state and questions itself, so a case carries only the raw `input` and the gold
*decision*:

```json
{
  "name": "renewal-notice",
  "cases": [
    { "id": "notice-001",
      "input": { "contract_text": "…", "email_text": "…", "received_date": "2026-01-02" },
      "gold": { "outcome": "avoided" } }
  ]
}
```

- `decide()` returns `{ outcome: "avoided" }`. A bare `"avoided"` also works when there's one field.
- `"abstain"` counts as not decided: it lowers coverage, not the wrong-decision count.
- An array gold (`"culprit_lines": [33, 34]`) means any of those is right. An array prediction is graded
  on its first item.
- Full example: `examples/renewal-notice.json` with `examples/renewal-notice.map.mjs`.

## Gold labels (field-level)

| primitive | gold is | graded as |
| --- | --- | --- |
| `noul` | `"yes"` or `"no"` | `noul > 0.5` → yes |
| `choice` | an option name | the returned `choice` |
| `score` | a level *name* | the level at `round(score)`, named by the text before the first colon of its criterion (`"high: ..."` → `high`), else the whole criterion |
| derived | any label | whatever your `--derive` module returns in `predicted`, with its `confidence` |

A question with no gold on any case is answered but never graded. A gold key with no question and no
derived value is ignored.

## Result rows (what jev-audit reads)

```json
{ "suite": "support-triage", "arm": "jev", "caseId": "triage-001", "tags": [], "gold": { ... },
  "raw": { "department": { "type": "choice", "choice": "billing", "confidence": 0.97, "probabilities": { ... } } },
  "predicted": { "priority_queue": "yes" }, "confidence": { "priority_queue": 0.91 },
  "latencyMs": 540, "inputTokens": 212, "listCostUsd": 0.0000089, "servedBy": "typesafe-ai/jev-..." }
```

To audit a comparator (an LLM), write rows with the same `caseId` and `gold` and its labels in
`predicted`. `jev-audit diff` compares any two files of such rows. Calibration and gates need
`raw` answers or a `confidence`.

## Writing the cases

- **~30 per suite minimum**, more for any field whose gap you intend to claim.
- **Half hard**: pairs where the same surface input has opposite correct answers because of context
  held elsewhere in the state.
- **Label from the rubric as written.** When the confidently-wrong queue shows a label answering a
  different question from the one the criterion states, fix the criterion or the label, whichever is
  wrong, and say which in `notes`.
- **Keep an adversarial set separately**, built after the first run to defeat the current questions.
  Report it as its own suite: it cuts coverage more than accuracy, and you want to see that.
