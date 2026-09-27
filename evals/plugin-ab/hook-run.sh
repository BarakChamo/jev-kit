#!/bin/bash
# usage: hook-run.sh <task> <arm> <rep>   arm: plugin | nohook | base
# Needs REPO (dir containing plugin/), NOHOOK (a copy of plugin/ without hooks/), FIXTURE (for task=edit), OUT.
task=$1; arm=$2; rep=$3
dir=$OUT/$task-$arm-$rep; rm -rf $dir; mkdir -p $dir; cd $dir
case $task in
  edit)
    cp $FIXTURE/questions.json $FIXTURE/decide.ts .
    P='This directory holds our Jev (TypeSafe System One) integration that decides whether a customer cancellation gave enough notice to avoid a contract auto-renewal: questions.json (the request) and decide.ts (logic on the answers). Add one question that checks whether the cancellation email was sent from an address the contract lists as an authorised contact, and wire it into decide.ts. Keep the change minimal. Do not call the API.';;
  notice)
    P="$(sed -n "/notice) T='/s/.*notice) T='\(.*\)';;/\1/p" $REPO/results/experiments/plugin-ab/run.sh)

$(sed -n "s/^API='\(.*\)'$/\1/p" $REPO/results/experiments/plugin-ab/run.sh)

Write the Jev request as questions.json (an example state plus the questions map) and any logic that runs on the answers as decide.ts. Keep it concise. Do not call the API.";;
esac
case $arm in
  plugin) timeout 600 claude -p --plugin-dir $REPO/plugin --permission-mode acceptEdits "$P" > transcript.txt 2>&1;;
  nohook) timeout 600 claude -p --plugin-dir $NOHOOK --permission-mode acceptEdits "$P" > transcript.txt 2>&1;;
  base)   timeout 600 claude -p --permission-mode acceptEdits "$P" > transcript.txt 2>&1;;
esac
echo "done $task $arm $rep $?"
