# Contributing

Thanks for looking. Issues and pull requests are welcome here.

## How this repository works

This repository is a published copy. The kit is developed in a private research repository alongside the study
and the raw material it can't publish, and a CI job exports it here. A pull request here is read, and if accepted
it is applied upstream and arrives in the next publish, credited to you in the commit and the changelog. Don't
be surprised when your PR is closed as "applied upstream" rather than merged.

## Setup

```bash
npm install
npm test          # the audit library's tests
npm run check     # offline checks: bundles, examples, recorded results; no API key
npm run build     # rebuild the jev-audit bundles after changing audit/src
```

Node 18 or later. Live runs need `TYPESAFE_API_KEY` or `AI_GATEWAY_API_KEY`.

## Changing a tool

- `jev-run` is `plugin/skills/jev-eval/scripts/jev-run.mjs`: one file, no dependencies. Keep it that way.
- `jev-audit` is `audit/src`. Edit there, then `npm run build`; never edit the bundles.
- Add a check to `scripts/check.mjs` for any behaviour the README promises.

## Proposing a rule

A rule changes what agents write, so the bar is evidence. A proposal needs:

- [ ] **A measured failure.** Cases Jev got wrong, with the wording that failed, and the numbers.
- [ ] **A fix that held on a second task**, different from the one it came from.
- [ ] **A probe:** the recommended and the warned-against wording on 12 items in each of three domains, with the
      truth known by construction. `evals/rule-probes/probes.mjs` is the template.
- [ ] **A stated status:** held, conditional (say the condition), or single.
- [ ] **A pre-registration** of the pass bar, committed before the runs.

Open an issue with the "rule proposal" template first.

## Adding a suite

Suites follow [`suite-format.md`](plugin/skills/jev-eval/references/suite-format.md). A good one:
- has about 30 cases or more, half of them hard (the same surface, a different answer because of context);
- computes gold by rule where it can (see `renewal-notice.gen.mjs`), and says who labelled the rest;
- ships a generator when the cases are synthetic, so `npm run check` can regenerate it byte for byte;
- contains no real secrets or personal data.

Open an issue with the "new suite" template.

## Style

Docs are plain and short: say what happened, with the number. No marketing words. Code matches its
surroundings.
