# For decision-makers

A one-page view for product, operations and finance leads. No code.

## What it is

**Jev** is a model from TypeSafe that answers narrow questions about a piece of data: yes or no, which of these
categories, how severe. It doesn't write text. That makes it much cheaper and faster than a chat model, and a fit
for decisions made thousands of times a day: routing tickets, screening requests, checking documents against a
policy.

**jev-kit** helps the engineers (or coding agents) who build those decisions. It teaches them how to phrase the
questions, which matters more than anything else here, and gives them tools to test the result on examples with
known answers before anything goes live.

## What to expect

| | Jev | a cheap chat model | a frontier chat model |
| --- | --- | --- | --- |
| accuracy on decisions it suits | about the same, +5 points on average | baseline | about the same as Jev |
| cost per decision | $0.00002–0.0001 at list price | 3–10× more on short inputs | 200–600× more |
| time per decision | 0.25–0.6 s | ~3 s | several seconds |

Measured in a study of 57 decision tasks in 2026. The reason to choose Jev is cost and speed at volume, not
accuracy.

**Worked cost example:** 40,000 support tickets a day, about 1,300 tokens (a page of text) each, is about **$66 a
month** at list price. Plan with a 10× margin ($655): prices for new models move.

## How it handles uncertain cases

Every decision can end three ways:

- **Right**: the decision is correct.
- **Wrong**: the decision is acted on, and it's incorrect. This is the number to watch.
- **Sent to a person** ("abstain"): the system isn't sure enough, so a person decides.

The kit teaches that an unsure case always goes to a person, and never becomes an approval. You choose the
trade-off: a stricter threshold means fewer wrong decisions and more cases for your team. Decide what each kind
of mistake costs you (a wrongly approved claim versus an unnecessary review) and set the target from that.

Some mistakes are made confidently, and no threshold catches those. That's why every decision needs testing on
real examples first, and why decisions where one mistake is catastrophic need a person in the loop regardless.

## What the kit changed, measured

Engineers' AI agents wrote decision code with and without the kit, and it was graded on examples with known
answers:

| decision | wrong decisions without the kit | with it |
| --- | ---: | ---: |
| did a support ticket breach its SLA? | 15.6% | 1.1% |
| is this purchase request approved, escalated or rejected? (hard, 5 outcomes) | 9.0% | 0.2–0.5% |
| which log line explains a failed build? | 13.3% | 0% |

Part of each improvement comes from the system sending more cases to a person. The detailed results show both
numbers side by side.

## Good fits and poor fits

**Good fits:** high volume; a fixed set of outcomes; the information needed is in the case itself; a person or a
fallback exists for unsure cases. Ticket routing, document checks against a written policy, screening forms,
tagging content.

**Poor fits:** decisions nobody can write a rule for; anything that needs outside knowledge not in the case;
fraud or security decisions where the main job is resisting people trying to trick it (Jev can be one signal
there, not the control); generating text.

## Before going live

1. **Label examples.** About 30 cases with the right answer, more for rare outcomes and a few for every clause of
   the policy. Someone who knows the policy should label them.
2. **Test on them.** The kit's tools report right, wrong and sent-to-a-person, and pick the threshold.
3. **Shadow mode.** Run beside the current process, log what it would have decided, and compare, before it acts
   on anything.
4. **Keep checking.** Sample live decisions each month, have them labelled, and re-test. Re-test whenever the
   policy, the questions or the model version change.

## Data and compliance

Case data is sent to TypeSafe, directly or through Vercel's AI Gateway. TypeSafe states it doesn't train on
customer data, and offers a data processing agreement and zero data retention for enterprise customers. Check
both vendors' terms before sending personal data. Each decision can be logged with the answers and thresholds
behind it, which reproduces it exactly for an audit or appeal. Details: [production](production.md).

## Caveats

- One person wrote the test cases and labels in the research behind the kit; an AI model checked them, no second
  person has.
- Most comparisons used 2 to 12 attempts per arm: treat the results as consistent directions, not precise figures.
- Prices and speeds were measured in September 2026.
