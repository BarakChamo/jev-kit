#!/bin/bash
# usage: make-adapter.sh <map-dir> <task>
# Asks an agent to write <map-dir>/adapter.ts: pure plumbing between a canonical case and the map's own
# questions.json + decide.ts. It must not change either file, and must not add judgment of its own.
set -e
dir=$1; task=$2; here=$(cd "$(dirname "$0")" && pwd)
case $task in
  notice) GOLD='{ outcome: "avoided" | "not_avoided" | "not_applicable" | "abstain" }  — "abstain" for any needs-review / escalate / uncertain result';;
  retry)  GOLD='{ retry: "yes" | "no" | "abstain" }  — "abstain" for escalate / needs-review / unknown';;
  culprit) GOLD='{ culprit_lines: number[] }  — the ranked candidate line indices (0-based into input.log_lines) the map would show, best first; empty if it abstains. If the map returns one line, return [that]. If it returns a shortlist, return the shortlist in order.';;
esac
sample=$(node -e "const c=require('$here/$task.cases.json')[0]; delete c.gold; delete c.facts; console.log(JSON.stringify(c,null,1).slice(0,3000))")
cd "$dir"
timeout 900 claude -p --permission-mode acceptEdits "In this directory, questions.json is a Jev request (an example state plus a questions map) and decide.ts is logic that runs on Jev's answers. Write adapter.ts, and change nothing else.

adapter.ts must export:
  buildState(input): the state object for questions.json's questions, built from a canonical case input (shape below). Use the same field names and structure as the example state in questions.json; fill every field from the input by plain transformation (copying, renaming, date arithmetic, splitting lines). Do not judge or classify anything; if the map's state needs a value the input does not contain, use the example state's value or leave it empty.
  questions(input): the questions map to send. Usually questions.json's questions verbatim; if decide.ts or questions.json builds questions per case (for example one question per candidate line), build them the same way, reusing its own builder functions if it exports them.
  decide(input, answers): import and call decide.ts's own decision function with the answers (answers is { [questionId]: noul | choice | score answer } exactly as the API returns: noul {type,noul}, choice {type,choice,confidence,probabilities}, score {type,score,confidence,legend,probabilities}). Add any missing convenience fields decide.ts expects (for example a probability field on a noul, or a level name on a score, derived mechanically from the API answer). Map its result to exactly: $GOLD

Canonical case input (first case of the suite; gold omitted):
$sample

Keep it short. Do not call any API. Make sure 'npx tsx -e \"import(\\'./adapter.ts\\')\"' would load without syntax errors." > adapter-transcript.txt 2>&1
ls adapter.ts
