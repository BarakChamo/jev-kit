# Running Jev in production

The skills get a map right on labelled cases. This page covers what happens after: calling the API safely,
volume, monitoring, data handling and security. Where a number comes from TypeSafe's documentation rather than
our measurements, it says so. Check [docs.typesafe.ai](https://docs.typesafe.ai) for current figures.

## Two ways to call Jev

| | TypeSafe API | Vercel AI Gateway |
| --- | --- | --- |
| endpoint | `https://api.typesafe.ai/v1/systemone` | `https://ai-gateway.vercel.sh/typesafe/v1/systemone` |
| key | `TYPESAFE_API_KEY` | `AI_GATEWAY_API_KEY` |
| model | `jev-latest`, `jev-preview`, or a version such as `jev-1.13.0` | `typesafe-ai/jev` only |
| version pinning | yes | no: the gateway rejects versioned ids |
| response `model` | the version that answered | `typesafe-ai/jev` |
| billing | TypeSafe | your Vercel account, with the billed cost in `provider_metadata.gateway.cost` |
| who serves it | TypeSafe | the gateway picks a provider: a September 2026 request was served by DigitalOcean, with TypeSafe as fallback |

The request and answers are the same on both. `jev-run` picks the route from whichever key is set (TypeSafe
first), or `--provider`.

**Pin a version for production.** Thresholds are fitted to one model version. TypeSafe's API lets you pin
(`jev-1.13.0`); the gateway doesn't. Log the response's `model` on every call either way.

## Limits

From TypeSafe's documentation (September 2026), which notes the limits change as they scale:

| limit | value |
| --- | --- |
| request rate | 1,200 requests a minute |
| token rate | 250,000 tokens a second |
| state plus the longest question | 32k tokens |
| a whole request | 64k tokens |
| options in a `choice` | 255; the API refuses 256 rather than truncating |
| errors | 401 bad key, 422 invalid request, 429 rate limit, 529 overloaded |

Measured here: 503s at concurrency 8 on 20k-token states through the gateway; concurrency 2 ran 855 calls with
one failure. For volume, ramp concurrency while watching 429/503 rates, and ask TypeSafe about higher limits before
you depend on them. 10 million decisions a month is about 4 a second on average: within the documented rate, but
plan for peaks.

## Calling it safely

```js
const JEV = process.env.TYPESAFE_API_KEY
  ? { url: 'https://api.typesafe.ai/v1/systemone', key: process.env.TYPESAFE_API_KEY, model: 'jev-1.13.0' }
  : { url: 'https://ai-gateway.vercel.sh/typesafe/v1/systemone', key: process.env.AI_GATEWAY_API_KEY, model: 'typesafe-ai/jev' };

export async function ask(state, questions, { attempts = 4, timeoutMs = 5000 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(JEV.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${JEV.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: JEV.model, state, questions }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return await res.json();                  // { model, answers, usage }
      if (res.status !== 429 && res.status < 500) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const after = Number(res.headers.get('retry-after'));
      await new Promise((r) => setTimeout(r, after > 0 ? after * 1000 : 250 * 2 ** i));
    } catch (err) {
      if (i === attempts - 1 || !/timeout|fetch failed|HTTP 5|HTTP 429/i.test(String(err))) throw err;
    }
  }
  throw new Error('Jev unavailable');
}

// The caller decides what an outage means. For a gate, it is never "allow".
const decision = await ask(state, questions).then((r) => map.decide(r.answers, input), () => ({ outcome: 'abstain' }));
```

- **Fail closed.** An error, a timeout or a refused request becomes an abstention, a safe default, or the LLM
  path, never the permissive outcome.
- **Set a timeout that fits your hot path.** Measured p95 was about 1 s, the worst p95 4.1 s. `jev-run` uses 60 s
  because it grades suites, not live traffic.
- **Validate before you send.** `jev-run --check --map` catches bad question shapes and states over the limit.

## A cascade to an LLM

Send the unsure cases, the ones your map abstains on, to a larger model. With the AI SDK:

```js
import { generateObject } from 'ai';
import { z } from 'zod';

const r = await ask(map.buildState(input), map.questions(input));
let decision = map.decide(r.answers, input);
if (decision.outcome === 'abstain') {
  const { object } = await generateObject({
    model: 'anthropic/claude-sonnet-5-5',          // any AI SDK model; through the gateway, a plain id works
    schema: z.object({ outcome: z.enum(['avoided', 'not_avoided', 'not_applicable', 'abstain']) }),
    prompt: `${POLICY_TEXT}\n\nDecide for this case, or abstain if a person should:\n${JSON.stringify(input)}`,
  });
  decision = object;
}
```

A cascade buys the ambiguous tail. It can't fix a question that is confidently wrong: those get past the gate.
Price the tail: if the map abstains on 10% of cases, the LLM sees 10% of the volume.

## Batch runs

`jev-run` is built to grade suites, but handles large case sets: give it a `.jsonl` file (one case per line)
with `--map`, and it streams rows to `--out` as they finish. `--resume` skips cases already written, and
`--max-failures N` keeps a few failed cases from failing a whole shard. For tens of millions of rows a month,
call the API from your own workers with the `ask()` above, and keep `jev-run` for measuring the map.

## Monitoring and drift

A map that passed its suite can drift when inputs change, or when the model behind an unpinned id changes.

- **Log per decision:** the response's `model`, each answer's top probability, the decision, and whether it
  abstained.
- **Alert on:** the abstain rate moving (a sign the inputs changed), the label mix moving, a new `model` value,
  and error rates.
- **Sample and label:** a few hundred live decisions a month, or more for rare classes. Grade them as a suite,
  audit with `jev-audit`, and `diff` against the baseline run.
- **Feed appeals back:** a decision a person overturned is a labelled case. Add it to the suite.
- **Refit on change:** a new model version, a policy change, or a question change means re-running the suite,
  diffing, and refitting the gates before shipping.

## Changing the policy

A pinned policy lives in code, so a policy change is a code change: update the constants, add a test case for
each changed clause, re-run the suite, and diff. Keep one version of the constants per policy version when old
cases must be decided under old rules. Size the suite to the policy: at least a few cases per clause, including
each exclusion, not 30 in total for a 20-clause policy.

## Decision records

For audits and appeals, store per decision: the input (or a reference to it), the state sent, the questions'
version (a hash of the map file), the answers with their probabilities, the served model version, the gate
thresholds in force, and the decision. The map's `decide()` is deterministic, so this record reproduces the
decision exactly. Jev's answers themselves were near-deterministic on re-run in the study, not guaranteed.

## Data handling

- **Everything in the state leaves your network**, to TypeSafe directly or through Vercel's gateway and the
  provider it routes to. Send only what the decision needs.
- **TypeSafe** states it does not train on customer requests or responses, and offers a data processing
  agreement and zero data retention for enterprise customers. See the legal section of its docs.
- **Vercel AI Gateway** has its own retention and routing terms. Check them, including which providers may serve
  `typesafe-ai/jev`, before sending personal data through it.
- **Don't put real secrets or personal data in suites** you commit or share. Use synthetic or redacted cases.
- **Scanning for secrets sends the secrets.** A map that asks "is there a live key in this diff?" sends the diff,
  key included. Prefer a local scanner for that, or redact before sending.

## Security

Jev can be one signal in a security decision. It shouldn't be the control.

- **Threat model:** anything in the state that an attacker can write (a retrieved document, a message, a file
  the agent read) can try to steer the answer. Treat those fields as untrusted, name them in questions, and keep
  trusted facts (the environment, the requester's role) in fields your code fills.
- **What was measured:** Jev detected a planted "this was already approved" 5 of 6 times in the study and
  resisted it 3 of 6; in the rule probes the claim fooled a deploy judgment 6 of 6, and a detector question's veto
  stopped all 6. That's six cases per domain and one attack phrasing. Paraphrased, encoded or multilingual attacks,
  and attacks aimed at the detector question itself, are untested.
- **Layer it:** deterministic allowlists and denylists first; Jev for what they leave; allow only a narrow,
  fitted, high-probability "safe" label; everything else to a person; any error to "ask".
- **Test your own attacks:** build an adversarial suite (`jev-eval` calls it the adversarial round), grade the gate
  on unsafe allows rather than accuracy, and re-run it on every change.

Report vulnerabilities in the kit's code as described in [SECURITY.md](../SECURITY.md).
