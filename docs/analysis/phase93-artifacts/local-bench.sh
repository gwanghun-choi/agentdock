#!/usr/bin/env bash
# usage: local-bench.sh <label> <serverDir> <outDir> [warmRuns=20] [coldRuns=5]
# The same machine, data and requests for every build. DB: test PostgreSQL through
# latency-proxy.cjs. Warm: one server, repeated GETs. Cold: a new server process and
# a sleeping proxy (5,000 ms wake) for each request. No production endpoint here.
L=$1; DIR=$2; OUT=$3; W=${4:-20}; C=${5:-5}; PORT=3193; HERE=$(cd "$(dirname "$0")" && pwd)
f='ttfb=%{time_starttransfer} total=%{time_total} http=%{http_code} bytes=%{size_download}\n'
serve() { (cd "$DIR" && PORT=$PORT HOSTNAME=127.0.0.1 DATABASE_SCHEMA=agentdock DATABASE_URL=postgresql://agentdock_app@127.0.0.1:$1/agentdock_test exec node server.js >/dev/null 2>&1) & SRV=$!; for i in $(seq 100); do curl -s -o /dev/null --max-time 0.2 http://127.0.0.1:$PORT/favicon.ico && break; sleep 0.1; done; }
stop() { kill $SRV 2>/dev/null; wait $SRV 2>/dev/null; sleep 0.3; }
run() { curl -s -o /dev/null -H 'accept-encoding: gzip' -w "$f" "http://127.0.0.1:$PORT/"; }
node "$HERE/latency-proxy.cjs" 55400 0 & P0=$!
node "$HERE/latency-proxy.cjs" 55401 100 & P1=$!
node "$HERE/latency-proxy.cjs" 55402 100 5000 3000 & P2=$!
sleep 0.5
for cfg in "loopback 55400" "rtt100 55401"; do set -- $cfg
  serve $2; run >/dev/null; run >/dev/null
  for i in $(seq $W); do echo "$L warm $1 $(run)"; sleep 0.2; done >> "$OUT/local-ttfb.txt"
  stop
done
# The database asleep, the instance up: past postgres.js's 20 s idle_timeout, and past
# the proxy's idle, so the request reconnects through a 5,000 ms wake.
serve 55402; run >/dev/null
for i in $(seq $C); do
  sleep 24
  echo "$L cold-db rtt100+wake5000 $(run)" >> "$OUT/local-ttfb.txt"
done
stop
# A new instance and the database asleep: first byte counted from the process start,
# so a wait in instrumentation's register() is in it.
for i in $(seq $C); do
  sleep 4
  t0=$(date +%s.%N)
  (cd "$DIR" && PORT=$PORT HOSTNAME=127.0.0.1 DATABASE_SCHEMA=agentdock DATABASE_URL=postgresql://agentdock_app@127.0.0.1:55402/agentdock_test exec node server.js >/dev/null 2>&1) & SRV=$!
  r=$(curl -s -o /dev/null --retry 200 --retry-delay 0 --retry-connrefused --retry-max-time 40 -w '%{http_code} %{time_starttransfer} %{time_total}' "http://127.0.0.1:$PORT/")
  t1=$(date +%s.%N); set -- $r
  echo "$L cold-boot rtt100+wake5000 ttfb=$(python3 -c "print(round($t1-$t0-($3-$2),3))") total=$(python3 -c "print(round($t1-$t0,3))") http=$1" >> "$OUT/local-ttfb.txt"
  stop
done
kill $P0 $P1 $P2
