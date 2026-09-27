# Held-out evaluation: does the plugin transfer to tasks it was not built on?

> **In short.** Three tasks the plugin was never built on, suites committed first, two agent models, 53 maps, no
> adapters.
> - **reply-exposure:** the plugin gained 8–13 points.
> - **alert-routing:** a tie at the ceiling.
> - **expense-review:** first *worse* on wrong decisions (13.8% against 0% on hard cases). Two rules came from it: read a
>   stated number exactly, and ask "does it include" rather than "is it a kind". After them, 1 wrong decision in 200
>   with the default model. With Sonnet, pooled to 7 maps per arm, the plugin makes 1.9% / 2.1% wrong decisions
>   against 0% / 1.4% (normal / hard), all cautious, at higher accuracy (98.1% / 97.9% against 94.7% / 90.7%).


The plugin's accuracy numbers so far come from three tasks it was then fixed on. This test uses
three new tasks whose suites were committed **before any agent wrote a map for them**
([`PREREGISTRATION.md`](PREREGISTRATION.md), with every result appended as it came in):

- `reply-exposure`: does a support draft expose another person's personal data?
- `alert-routing`: which team owns the affected service (a catalog lookup), and should it page now?
- `expense-review`: approve, needs approval, or reject, under a written policy with currency conversion.

Each task has 30 cases (`gen.mjs`) plus 20 adversarial cases (`gen-hard.mjs`). The adversarial cases
were written after the first results but before any map saw them. Gold is computed by rule. GLM 5.3
Flash relabelled all 150 cases from the rule text alone and agreed on 149. The one dispute
(`exposure-020`) is genuinely ambiguous and is kept as generated.

Both arms get the same prompt (`run.sh`), which specifies the map interface. Every map is therefore
graded by the plugin's own runner (`grade.mjs` → `jev-run`'s `runSuite` with `--map` semantics), with
**no adapters**. Agents: the session's default model, and Sonnet as a second model.

## Result

`wrong` is the share of cases decided wrongly. Abstentions count against accuracy, not as wrong.

| task | agent model | version | maps | accuracy | wrong | hard: accuracy | hard: wrong |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| reply-exposure | default | no plugin | 4 | 88.3% | 0.0% | 76.2% | 8.8% |
| reply-exposure | default | plugin | 4 | **96.7%** | 0.0% | **87.5%** | **3.8%** |
| reply-exposure | Sonnet | no plugin | 3 | 84.4% | 3.3% | 73.3% | 8.3% |
| reply-exposure | Sonnet | plugin | 3 | **97.8%** | 2.2% | **83.3%** | 6.7% |
| alert-routing | default | no plugin | 4 | 100% | 0% | 100% | 0% |
| alert-routing | default | plugin | 4 | 100% | 0% | 98.8% | 0% |
| alert-routing | Sonnet | no plugin | 3 | 100% | 0% | 100% | 0% |
| alert-routing | Sonnet | plugin | 3 | 100% | 0% | 100% | 0% |
| expense-review | default | no plugin | 4 | 94.2% | 0.0% | 86.2% | 0.0% |
| expense-review | default | plugin, as first tested | 4 | 98.3% | 1.7% | 85.0% | **13.8%** |
| expense-review | default | plugin, rule 5 refined | 4 | 86.7% | 4.2% | 86.2% | 6.2% |
| expense-review | default | **plugin, final** | 4 | **100%** | **0.0%** | **98.8%** | 1.2% |
| expense-review | Sonnet | no plugin | 3 | 92.2% | 0.0% | 93.3% | 1.7% |
| expense-review | Sonnet | plugin, rule 5 refined | 3 | 98.9% | 1.1% | 93.3% | 5.0% |
| expense-review | Sonnet | plugin, final | 3 | 96.7% | 3.3% | **96.7%** | 3.3% |

Per-map numbers: `summary.json`. Every Jev answer: `results.*.json`. Maps: `maps*/`.

## What it shows

- **The plugin transferred on reply-exposure, with both agent models.** It gained 8–13 points of
  accuracy on normal cases and 10–11 on adversarial ones. With the default model it also cut wrong
  decisions on the hard cases from 8.8% to 3.8%.
- **alert-routing is a tie at the ceiling.** Both arms get it right. A catalog lookup plus a
  two-clause rule is within any careful map's reach.
- **expense-review is where the plugin failed first, and where the fixes had to be earned.** As first
  tested it decided more cases but made more wrong ones, 13.8% on the hard cases against 0%. Two causes
  were measured, fixed in the skill, and re-tested against bars committed beforehand:
  1. **A stated number read as a band.** One map read "USD 75" as 70–75, then treated a $73.44
     dinner as "ambiguous, so over the limit". That caused 10 of its 20 hard cases to be wrong.
     Rule 5 now says to read a stated number exactly. The re-test failed its bar, for the next reason.
  2. **"Is it a kind" against "does it include".** Most remaining errors were "Dinner and a bottle of
     wine" approved. The maps asked whether the expense *is* a never-reimbursable kind. A direct probe:
     that wording was 10/12 and never decisive, while "does it include any alcohol or entertainment"
     was **12/12** at 0.93–0.98. With that in rule 3, the default model's maps reached **100% and
     98.8% with 1 wrong decision in 200**, which passed.
- **With Sonnet, the final expense skill is close but not better on wrong decisions** (3.3% against
  0–1.7%). All five of its wrong decisions lean cautious (needs approval instead of approve or reject),
  and four come from one map that misread the transport limit. The baseline maps abstain more instead.
- **Item 5, pooled to n = 7 per arm** (four more Sonnet runs per arm, `maps6/`, `results.item5*.json`):

  | Sonnet, expense-review | accuracy (normal / hard) | wrong (normal / hard) |
  | --- | ---: | ---: |
  | no plugin | 94.7% / 90.7% | 0.0% / 1.4% |
  | final plugin | **98.1% / 97.9%** | 1.9% / 2.1% |

  The gap in wrong decisions is small, and every one of them leans cautious. The pre-registered question
  was whether the plugin arm stays above the baseline on wrong decisions. It does, by 0.7–1.9 points, which is
  inside the noise at this n. The accuracy gain is larger.
- **Every plugin error that was traced leaned cautious.** Plugin maps decide more cases, and when they
  are wrong it is almost always toward review, which is the direction the skill tells them to fail.

## Infrastructure findings, now fixed in the plugin

- **Gateway 503s** on requests with several large choices (four questions of 82 options each), where
  the old retry gave up after about 7 seconds. `jev-run` now retries six times with backoff up to 16 s.
  It recovered all but one case.
- **A bare label** (`"approve"` instead of `{ decision: "approve" }`) made one map grade as all-abstain.
  `jev-run` now accepts a bare label when the gold has one field. No other map in either arm returned one.

## Limits

- 3–4 maps per cell, one author for the tasks and rules, and suites that proved easier than hoped.
  The ceiling on alert-routing means it cannot discriminate.
- The expense fixes were made on the held-out task itself, so the final expense row is no longer
  held out. reply-exposure and alert-routing were never used to change the skill.
- The Sonnet plugin rows before "final" used the skill as it stood when they ran, as labelled.
