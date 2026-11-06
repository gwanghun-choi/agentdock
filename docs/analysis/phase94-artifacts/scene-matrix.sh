#!/usr/bin/env bash
# usage: scene-matrix.sh <label> <serverDir> <out.jsonl> [optin]
# Test database only. One server, the same order for every build.
L=$1; DIR=$2; OUT=$3; OPT=$4; U=http://127.0.0.1:3194; H=$(cd "$(dirname "$0")" && pwd)
export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1
(cd "$DIR" && PORT=3194 HOSTNAME=127.0.0.1 DATABASE_SCHEMA=agentdock DATABASE_URL=postgresql://agentdock_app@127.0.0.1:55432/agentdock_test exec node server.js >/dev/null 2>&1) & SRV=$!
for i in $(seq 100); do curl -s -o /dev/null --max-time 0.3 $U/ && break; sleep 0.2; done; curl -s -o /dev/null $U/
run() { "$@" 2>&1 | grep -v Skipping | cut -c1-600; }
for r in 1 2 3; do
  run taskset -c 0,1 node "$H/scene-compare.cjs" $U chromium software "$L" "$OUT" wide $OPT
  run node "$H/scene-compare.cjs" $U chromium software "$L" "$OUT" wide $OPT
  run node "$H/scene-compare.cjs" $U chromium gpu "$L" "$OUT" wide
done
run node "$H/scene-compare.cjs" $U chromium software "$L" "$OUT" phone
run node "$H/scene-compare.cjs" $U firefox default "$L" "$OUT" wide
run node "$H/scene-compare.cjs" $U webkit default "$L" "$OUT" wide
kill $SRV; wait $SRV 2>/dev/null
