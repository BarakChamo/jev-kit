#!/bin/bash
# usage: run.sh <task> <arm> <rep>
S=$(dirname "$0"); REPO=${REPO:?set REPO to the directory containing plugin/}; task=$1; arm=$2; rep=$3
dir=${OUT:-$S/runs}/$task-$arm-$rep; rm -rf $dir; mkdir -p $dir; cd $dir
API='Jev (TypeSafe System One) API: POST https://ai-gateway.vercel.sh/typesafe/v1/systemone with JSON {"model":"typesafe-ai/jev","state":<any JSON>,"questions":{<id>:<question>}}. Question types: {"type":"noul","instructions":"...","criteria":{"true":"...","false":"..."}} returns a probability; {"type":"choice","instructions":"...","criteria":{"<option>":"<description>"}} returns choice, confidence and probabilities; {"type":"score","instructions":"...","criteria":["<lowest level>","...","<highest level>"]} returns an ordered level. All questions are answered in one parallel pass.'
case $task in
  notice) T='We ingest customer contracts (full text) and cancellation emails (text plus the date received). We need to decide, for each cancellation, whether the customer gave enough notice under their contract to avoid automatic renewal. Build this decision on Jev.';;
  retry)  T='Our CI system has thousands of failed jobs a day. For each failed job we have the last 200 log lines and job metadata (repo, branch, runner, attempt number). We want to automatically decide whether to retry the job. Build this decision on Jev.';;
  contra) T='Our RAG assistant answers questions from our product FAQ. For every retrieved passage we want to flag passages that contradict the correct answer before they reach the generator. We maintain a verified answer key for every FAQ question. Build this screen on Jev.';;
  contra2) T='Our RAG assistant answers customer questions about our product. Some retrieved passages are stale and state things that are no longer true. Before passages reach the generator, flag any passage that is wrong. For context: our support team keeps the canonical current answer for each FAQ question in the CMS, and every user question is first matched to an FAQ entry. Build this screen on Jev.';;
  cheapest) T='Our e-commerce operations team handles order exceptions (late delivery, damaged item, wrong item, customer dispute). For each exception they pick the cheapest resolution among: refund, replacement, partial credit, investigate, or ignore, trading off item value, shipping cost, customer lifetime value, the cost of investigation and fraud risk. We have the order record and the customer message. Automate this choice on Jev.';;
  culprit) T='When a CI job fails, we want to automatically point developers at the single log line that caused the failure, out of the last 200 lines. We have thousands of failures a day. Build this on Jev.';;
  fanout) T='For each vendor contract we receive (30 to 80 pages of text) we need 25 fields for our contract database: governing law, auto-renewal, renewal notice period, liability cap present, liability cap amount band, indemnity scope, data processing terms present, termination for convenience, payment terms band, and so on. We process about 40,000 contracts a year. Build the extraction on Jev.';;
  compile) T='Our trust and safety policy is a 12-page document that the policy team edits about once a month. We want Jev to check every user post against it (millions of posts a day). Use an LLM to turn the policy document into the Jev questions, so the policy team never has to write questions themselves.';;
  handoff) T='We already run an LLM that reads each coding-agent session transcript (often 20,000+ tokens) and extracts a structured list of findings: commands run, files changed, tests edited, errors hit. We now want Jev to decide, per session, whether the agent completed the task safely, completed it unsafely, or failed. Build the decision on Jev.';;
esac
P="$T

$API

Write the Jev request as questions.json (an example state plus the questions map) and any logic that runs on the answers as decide.ts. Keep it concise. Do not call the API."
if [ "$arm" = plugin ]; then
  timeout 600 claude -p --plugin-dir $REPO/plugin --permission-mode acceptEdits "$P" > transcript.txt 2>&1
else
  timeout 600 claude -p --permission-mode acceptEdits "$P" > transcript.txt 2>&1
fi
echo "done $task $arm $rep $?"
