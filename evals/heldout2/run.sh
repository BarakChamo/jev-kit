#!/bin/bash
# Claude Code author: run.sh <task> <arm: plugin|base> <rep> [model]   (needs REPO and OUT)
task=$1; arm=$2; rep=$3; model=${4:-}
here=$(cd "$(dirname "$0")" && pwd)
dir=$OUT/$task-$arm-$rep-claude${model:+-$model}; rm -rf $dir; mkdir -p $dir; cd $dir
P="$(node $here/prompt.mjs $task)"
flags=(-p --permission-mode acceptEdits)
[ -n "$model" ] && flags+=(--model "$model")
[ "$arm" = plugin ] && flags+=(--plugin-dir "$REPO/plugin")
timeout 1200 claude "${flags[@]}" "$P" > transcript.txt 2>&1
if [ ! -f map.mjs ]; then f=$(ls -t /tmp/claude-0/*$(basename $dir)*/*/scratchpad/map.mjs 2>/dev/null | head -1); [ -n "$f" ] && cp "$f" map.mjs; fi
echo "done $task $arm $rep claude${model:+-$model} $([ -f map.mjs ] && echo ok || echo NO-MAP)"
