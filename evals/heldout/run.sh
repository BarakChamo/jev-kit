#!/bin/bash
# usage: run.sh <task> <arm: plugin|base> <rep> [model]
# Needs REPO (dir containing plugin/) and OUT. The agent writes map.mjs to the standard interface, so
# it is graded by `jev-run <suite> --map map.mjs` with no adapter.
task=$1; arm=$2; rep=$3; model=${4:-}
here=$(cd "$(dirname "$0")" && pwd)
dir=$OUT/$task-$arm-$rep${model:+-$model}; rm -rf $dir; mkdir -p $dir; cd $dir
case $task in
  reply-exposure) T='Our support agents draft replies to customers. Before a draft is sent, decide whether it exposes personal data (a name, email address, phone number or order id) of anyone other than the customer it is addressed to. The company'"'"'s own contact addresses and support staff first names are not personal data. We send millions of replies a month. Build this check on Jev.'; OUTLBL='{ exposes_other_person: "yes" | "no" | "abstain" }';;
  alert-routing) T='Our monitoring fires thousands of alerts a day. For each alert, decide which team owns the affected service (from our service catalog) and whether to page that team now. Policy: page now if the alert'"'"'s severity is critical, or if it is high and the affected service is tier 1; otherwise open a ticket. Alerts sometimes mention other services as context; those are not the affected service. Build this on Jev.'; OUTLBL='{ team: "<owner_team from the catalog>" | "abstain", page_now: "yes" | "no" | "abstain" }';;
  expense-review) T='Employees submit expense lines. For each line decide: approve, needs_approval (manager must approve), or reject, under our written travel and expense policy (limits in USD; convert foreign currency at the rates provided). We process hundreds of thousands of lines a month. Build this on Jev.'; OUTLBL='{ decision: "approve" | "needs_approval" | "reject" | "abstain" }';;
esac
sample=$(node -e "const c=require('$here/$task.json').cases[0]; console.log(JSON.stringify(c.input,null,1).slice(0,2500))")
API='Jev (TypeSafe System One) API: POST https://ai-gateway.vercel.sh/typesafe/v1/systemone with JSON {"model":"typesafe-ai/jev","state":<any JSON>,"questions":{<id>:<question>}}. Question types: {"type":"noul","instructions":"...","criteria":{"true":"...","false":"..."}} returns {"type":"noul","noul":<probability 0..1>}; {"type":"choice","instructions":"...","criteria":{"<option>":"<description>"}} returns {"type":"choice","choice":"<option>","confidence":<0..1>,"probabilities":{"<option>":<p>}}; {"type":"score","instructions":"...","criteria":["<lowest level>","...","<highest level>"]} returns {"type":"score","score":<fractional level index>,"confidence":<0..1>,"legend":{"0":"<level text>"},"probabilities":{"0":<p>}}. All questions are answered in one parallel pass.'
P="$T

$API

Each case arrives as an input object shaped like this example:
$sample

Write map.mjs (plain JavaScript ES module, no dependencies) exporting:
  buildState(input)       -> the Jev state for this case
  questions(input)        -> the Jev questions map for this case
  decide(answers, input)  -> $OUTLBL
answers is the API's answers object for your questions. Return \"abstain\" for any case you would send to a person rather than decide. Keep it concise. Do not call the API."
flags=(-p --permission-mode acceptEdits)
[ -n "$model" ] && flags+=(--model "$model")
[ "$arm" = plugin ] && flags+=(--plugin-dir "$REPO/plugin")
timeout 900 claude "${flags[@]}" "$P" > transcript.txt 2>&1
# some agents write to their own scratchpad instead of the working directory
[ -f map.mjs ] || { f=$(ls -t /tmp/claude-0/*/*/scratchpad/map.mjs 2>/dev/null | head -1); :; }
echo "done $task $arm $rep ${model:-default} $?"
