#!/usr/bin/env bash
# READ ONLY: GET requests to production. Usage: prod-baseline.sh <outDir>
OUT=${1:-.}; BASE=https://agentdock-delta.vercel.app
f='%{url_effective} %{http_code} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total} bytes=%{size_download}\n'
hit() { curl -s -o /dev/null -w "$f" -H 'accept-encoding: gzip' "$BASE$1"; }
date -u +"start %FT%TZ" > "$OUT/prod-warm.txt"
hit / >/dev/null   # wake it so "warm" is warm; not recorded
for p in / /artifacts /r/nobody/nothing; do for i in 1 2 3 4 5 6 7 8 9 10; do hit "$p" >> "$OUT/prod-warm.txt"; sleep 1; done; done
curl -sI "$BASE/" | grep -iE '^(x-agentdock-commit|x-vercel-id|cache-control)' >> "$OUT/prod-warm.txt"
node docs/analysis/phase91-artifacts/lcp.cjs "$OUT/prod-lcp.jsonl" "$BASE" desktop-warm,mobile-warm 5 > /dev/null 2>&1
: > "$OUT/prod-cold.txt"
for p in / /artifacts / /artifacts /; do
  sleep 510
  date -u +"# idle 8.5 min, %FT%TZ" >> "$OUT/prod-cold.txt"
  hit "$p" >> "$OUT/prod-cold.txt"; hit "$p" >> "$OUT/prod-cold.txt"; hit "$p" >> "$OUT/prod-cold.txt"
done
