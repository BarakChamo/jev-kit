#!/bin/bash
# Resume the second held-out round after the gateway ran out of credit (2026-09-26 16:32 UTC).
# 1. writes every GLM 5.3 / Qwen 3.8 Max map that is still missing (v3 skill, as the rest of round 2)
# 2. grades every API-authored map that has no result yet
set -e
cd "$(dirname "$0")"
export NODE_USE_ENV_PROXY=1 NODE_NO_WARNINGS=1
OUT=${OUT:-/tmp/heldout2-api}; mkdir -p $OUT
for m in zai/glm-5.3 alibaba/qwen3.8-max-0902; do for t in sla-breach refund-eligibility access-request clause-locator culprit; do for a in plugin base; do for r in 1 2 3; do
  d=maps-api/$t-$a-$r-$(echo $m | tr '/.' '__'); [ -f $d/map.mjs ] || echo "$t $a $m $r $OUT"; done; done; done; done > $OUT/jobs.txt
echo "$(wc -l < $OUT/jobs.txt) maps to write"
# round 2 used the skill at the commit in SKILL_VERSION; the author reads it from git at that commit
export SKILL_REF=$(cat SKILL_VERSION)
xargs -P 10 -L 1 node --env-file=../../.env.local author.mjs < $OUT/jobs.txt || echo "some maps failed to write; they count as load failures"
for d in $OUT/*/; do n=$(basename $d); [ -f $d/map.mjs ] && mkdir -p maps-api/$n && cp $d/map.mjs $d/response.md $d/usage.json maps-api/$n/; done
CONCURRENCY=3 node --env-file=../../.env.local grade.mjs $(ls -d maps-api/*) --out results.api.json
# Claude Code maps written with skill v4 while the gateway was out of credit (maps-v4/SKILL_VERSION)
[ -d maps-v4 ] && CONCURRENCY=3 node --env-file=../../.env.local grade.mjs $(ls -d maps-v4/*/ | sed 's#/$##') --out results.v4.json
python3 summarise.py
