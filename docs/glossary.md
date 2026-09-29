# Glossary

The words this kit uses, in plain terms.

## Jev and its API

| term | meaning |
| --- | --- |
| **Jev** | A model from TypeSafe that answers typed questions about data you send it. It returns probabilities, never text. |
| **System One model** | TypeSafe's name for this kind of model: fast, cheap, one pass, no deliberation (after Kahneman's "System 1"). Your code does the deliberate part. |
| **state** | The data a request is about: a string, or JSON with named fields. Your code builds it. |
| **question** | One typed question in a request. A request can carry many; they are answered together, independently. |
| **`noul`** | A yes/no question. The answer is `noul`, the probability of yes (0.03 means almost certainly no). |
| **`choice`** | Pick one of up to 255 named options. The answer names the pick and gives every option's probability. |
| **`score`** | A step on an ordered rubric (low, medium, high). The answer is a fractional position plus each step's probability. Fragile; prefer `choice`. |
| **`instructions`** / **`criteria`** | The question text, and what each option or answer means. Jev reads these. It ignores the question's key. |
| **`probabilities`** | Every option's probability. Act on this. |
| **`confidence`** | A separate scalar the API returns. It runs low; don't gate on it. |

## Maps and suites

| term | meaning |
| --- | --- |
| **map** | Your code for one decision: `buildState(input)`, `questions(input)` and `decide(answers, input)`. |
| **decision** | What `decide()` returns, such as `{ outcome: 'avoided' }`. |
| **abstain** | A decision of `"abstain"`: the map sends the case to a person (or a larger model) instead of deciding. |
| **suite** | A JSON file of labelled cases: inputs and the correct answers. About 30 is the minimum to measure anything. |
| **gold** | The correct answer for a case, written by a person or computed by rule. |
| **derive** | Compute a decision in code from Jev's answers, instead of asking Jev for it. |
| **premise** | A fact a question depends on. If it's missing from the state, Jev answers anyway, often confidently wrong. |

## Measuring

| term | meaning |
| --- | --- |
| **right / wrong** | A decision made that matches, or doesn't match, the gold. |
| **accuracy** | Right decisions over all cases. An abstention counts against it. |
| **wrong-decision rate** | Wrong decisions over all cases. The number that matters most when decisions are acted on. |
| **coverage** | The share of cases decided (not abstained). |
| **gate** / **threshold** | A minimum probability below which the map abstains. Fitted on labelled cases, never guessed. |
| **precision** | Among the cases a gate lets through, the share that are right. |
| **fitted** | Chosen from labelled cases to hit a target, such as 95% precision. `jev-audit` does it. |
| **held out** | Cases or tasks not used to write or tune the thing being tested. A result on held-out cases is the honest one. |
| **confidently wrong** | Wrong at 0.9 or more. The first thing to read: usually a question or label defect. |
| **calibration** | Whether answers given at 0.8 are right about 80% of the time. |
| **ECE** | Expected calibration error: the average gap between claimed and delivered accuracy. Lower is better. |
| **AUROC** | How well a probability ranks right answers above wrong ones: 1.0 perfectly, 0.5 no better than chance. A gate depends on this. |
| **top-2 recall** | How often the right answer is one of the two most likely. The value of showing a person two options. |
| **pad test** | Add unrelated text to the state and re-run. Answers that move reveal questions that don't name their field. |
| **decisiveness** | How far an answer is from a coin flip: 0 for 50/50, 1 for certain. Low decisiveness means a gate would abstain. |
| **diff** / **sign test** | Compare two runs case by case: which answers a change fixed and which it broke, and whether that split is more than chance. |
| **cascade** | Jev first, and a larger model only for the cases Jev is unsure about. |
| **comparator** | The LLM a result is compared against. Re-run it after changing a question: a clearer question helps it too. |

## The research

| term | meaning |
| --- | --- |
| **the study** | 57 hand-labelled decision suites (1,836 cases) run on Jev and LLMs. The rules came from it. Its write-up is in the private research repository; its findings are in [rules](rules.md) and [evaluations](evals.md). |
| **round** | One pre-registered evaluation of the skills, with its own tasks. |
| **pre-registration** | Hypotheses and pass bars written down before a run, so results can't move the goalposts. |
| **v3, v4.2, v4.3** | Versions of the skill text measured in the evaluations. The plugin's release number (0.3.0) is separate; the [changelog](../CHANGELOG.md) maps one to the other. |
| **authoring model** | The model that wrote a map: a Claude Code agent, or another vendor's model in one API call. |
| **one-shot author** | A model asked for the whole map in a single call, with no chance to run it. |
