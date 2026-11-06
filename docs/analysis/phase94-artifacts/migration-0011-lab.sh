#!/usr/bin/env bash
# 로컬 agentdock-testdb 컨테이너의 일회용 DB에서만 실행한다. 운영 접속 없음, agentdock_test 쓰기 없음(읽기 dump만).
# 만든 DB는 m0011_lab* 뿐이고 종료·실패·중단 시 그것들만 지운다.
set -u
S=/tmp/claude-1000/-home-ChoiGwanghun-workspace-auto-agentdock/5c2b22dc-57d2-4ff1-8d78-983a093cb69b/scratchpad
REPO=/home/ChoiGwanghun/workspace_auto/agentdock
A=$REPO/docs/analysis/phase94-artifacts
OLD_MIG=$S/wt-phase93/drizzle
OUT=$(mktemp -d "$S/lab-XXXXXX")
exec > >(tee "$OUT/lab.log") 2>&1
U=$(docker exec agentdock-testdb sh -c 'psql -U postgres -tAc "select 1" >/dev/null 2>&1 && echo postgres || echo agentdock')
pq() { local db=$1; shift; timeout -k 5 300 docker exec -i agentdock-testdb psql -U "$U" -d "$db" -v ON_ERROR_STOP=1 -q "$@"; }
pqsoft() { local db=$1; shift; timeout -k 5 120 docker exec -i agentdock-testdb psql -U "$U" -d "$db" -q "$@"; }
dropall() { for d in m0011_lab m0011_lab_r m0011_lab_e; do docker exec agentdock-testdb psql -U "$U" -d postgres -qc "drop database if exists $d with (force)" >/dev/null 2>&1; done; }
cleanup() { [ -n "${POLL:-}" ] && kill "$POLL" 2>/dev/null; dropall; echo "cleaned; evidence in $OUT"; }
trap cleanup EXIT
trap 'exit 130' INT TERM HUP
dropall
now() { date +%s%3N; }

# 읽기 폴러: 100ms 간격 단일 클라이언트. 두 테이블을 각각 읽고 가장 느린 값을 본다.
poll_start() { # $1 db, $2 file
  ( : > "$2"; while :; do t=$(now); timeout -k 2 120 docker exec agentdock-testdb psql -U "$U" -d "$1" -qAtc "select id from agentdock.package order by id desc limit 1; select id from agentdock.capability_finding order by id desc limit 1" >/dev/null 2>&1; echo $(( $(now)-t )) >> "$2"; sleep 0.1; done ) &
  POLL=$!
}
poll_stop() { kill "$POLL" 2>/dev/null; wait "$POLL" 2>/dev/null; POLL=; sort -n "$1" | awk '{a[NR]=$1} END{printf "reads n=%d median=%dms max=%dms\n",NR,a[int((NR+1)/2)],a[NR]}'; }
digest="sha256(replace(source_path, '\\', '\\\\')::bytea)"

echo "=== 1. 구 스키마(0000~0010) + 합성 데이터"
docker exec agentdock-testdb psql -U "$U" -d postgres -qc "create database m0011_lab" || exit 1
pq m0011_lab -c "create extension pg_trgm" -c "create schema agentdock" || exit 1
for f in "$OLD_MIG"/0*.sql; do pq m0011_lab < "$f" >/dev/null || { echo "apply failed $f"; exit 1; }; done
timeout -k 5 120 docker exec agentdock-testdb pg_dump -U "$U" -d agentdock_test --data-only --column-inserts -t agentdock.repository -t agentdock.package | pq m0011_lab >/dev/null || exit 1
pq m0011_lab < "$A/synth-load.sql" | tail -1
pq m0011_lab < "$A/synth-findings.sql"
pq m0011_lab -tAc "select 'pg '||current_setting('server_version'), (select count(*) from agentdock.package) pkg, (select count(*) from agentdock.capability_finding) finding, pg_size_pretty(pg_total_relation_size('agentdock.package')) pkgsize, pg_size_pretty(pg_total_relation_size('agentdock.capability_finding')) findingsize"
FP="select md5(string_agg(id||'|'||repository_id||'|'||type||'|'||source_path||'|'||name, ',' order by id)) from agentdock.package"
FF="select md5(string_agg(id||'|'||package_version_id||'|'||source_path||'|'||summary, ',' order by id)) from agentdock.capability_finding"
hash() { pq "$1" -tAc "$FP"; pq "$1" -tAc "$FF"; }
echo "before hash:"; hash m0011_lab
pq postgres -c "create database m0011_lab_r template m0011_lab" -c "create database m0011_lab_e template m0011_lab"

ID="select p.repository_id r, p.type t, p.source_path s from agentdock.package p order by id limit 1"
oldup() { echo "begin; insert into agentdock.package (repository_id,type,source_path,name,slug) select r,t,s,'x','x' from ($ID) q on conflict (repository_id,type,source_path) do update set name=excluded.name; rollback;" ; }
digup() { echo "begin; insert into agentdock.package (repository_id,type,source_path,name,slug) select r,t,s,'x','x' from ($ID) q on conflict (repository_id,type,source_path_digest) do update set name=excluded.name; rollback;" ; }
expup() { echo "begin; insert into agentdock.package (repository_id,type,source_path,name,slug) select r,t,s,'x','x' from ($ID) q on conflict (repository_id,type,$digest) do update set name=excluded.name returning id, name; rollback;" ; }
LONG="(select string_agg(md5(g::text),'') from generate_series(1,130) g)"
longup() { echo "begin; insert into agentdock.package (repository_id,type,source_path,name,slug) select r,t,$LONG,'x','x' from ($ID) q on conflict (repository_id,type,$digest) do update set name=excluded.name returning id, length(source_path); rollback;" ; }
try() { echo "--- $1"; shift; "$@" 2>&1 | grep -E 'INSERT|ERROR|^ *[0-9]+' | cut -c1-150 | head -3; }

echo; echo "=== 2. 현재 0011 (생성 열): 호환성"
echo "--- 신 코드(digest 열) + 구 스키마"; digup | pqsoft m0011_lab 2>&1 | grep -E 'ERROR|HINT' | cut -c1-150
echo "--- 구 코드 + 구 스키마"; oldup | pqsoft m0011_lab 2>&1 | grep -E 'ERROR' | cut -c1-150 || true; echo "(오류 없으면 정상)"
sed -n '/^ALTER/p' "$REPO/drizzle/0011_path_digest_identity.sql" | sed 's/--> statement-breakpoint//' > "$OUT/0011.sql"
poll_start m0011_lab_r "$OUT/reads-r.txt"; sleep 1
t=$(now); { echo "begin; set local lock_timeout='15s';"; cat "$OUT/0011.sql"; echo "commit;"; } | pq m0011_lab_r; echo "apply 0011 wall=$(( $(now)-t ))ms exit=$?"
sleep 1; poll_stop "$OUT/reads-r.txt"
echo "--- 구 코드 + 신 스키마"; oldup | pqsoft m0011_lab_r 2>&1 | grep -E 'ERROR' | cut -c1-150
echo "--- 신 코드 + 신 스키마"; digup | pqsoft m0011_lab_r 2>&1 | grep -E 'ERROR' | cut -c1-150; echo "(오류 없으면 정상)"
hash m0011_lab_r

echo; echo "=== 3. Expand: 식 unique index만 추가(재작성 없음, 잠금 SHARE)"
cat > "$OUT/expand.sql" <<EOF
CREATE UNIQUE INDEX "package_identity_digest" ON "agentdock"."package" ("repository_id","type",($digest));
CREATE UNIQUE INDEX "capability_finding_identity_digest" ON "agentdock"."capability_finding" ("package_version_id","detector_id","category",($digest),"start_line","summary");
EOF
poll_start m0011_lab_e "$OUT/reads-e.txt"; sleep 1
t=$(now); { echo "begin; set local lock_timeout='15s';"; cat "$OUT/expand.sql"; echo "commit;"; } | pq m0011_lab_e; echo "apply expand wall=$(( $(now)-t ))ms"
sleep 1; poll_stop "$OUT/reads-e.txt"
echo "--- 확장 상태: 구 코드"; oldup | pqsoft m0011_lab_e 2>&1 | grep -E 'ERROR' | cut -c1-150; echo "(오류 없으면 정상)"
echo "--- 확장 상태: 신 코드(식 target), 기존 행 충돌"; expup | pqsoft m0011_lab_e 2>&1 | grep -E 'ERROR|^ *[0-9]+' | cut -c1-120
echo "--- 확장 상태: 긴 경로(4160자 비압축) - 구 제약이 남아 있어 54000이 정상"; longup | pqsoft m0011_lab_e 2>&1 | grep -E 'ERROR|^ *[0-9]+' | cut -c1-110
echo "--- 확장 중 진행 중 쓰기: 빌드 전 쓰기 tx 3초 보유, 그동안 expand를 재실행(rollback)"
( echo "begin; update agentdock.package set name=name where id=(select min(id) from agentdock.package); select pg_sleep(3); commit;" | pqsoft m0011_lab >/dev/null ) &
sleep 0.5; t=$(now); { echo "begin; set local lock_timeout='15s';"; sed 's/_digest"/_digest2"/' "$OUT/expand.sql"; echo "rollback;"; } | pqsoft m0011_lab; echo "write-held expand wall=$(( $(now)-t ))ms (쓰기 끝날 때까지 대기 후 진행)"; wait $!
hash m0011_lab_e

echo; echo "=== 4. Contract: 구 제약 삭제"
cat > "$OUT/contract.sql" <<'EOF'
ALTER TABLE "agentdock"."package" DROP CONSTRAINT "package_identity";
ALTER TABLE "agentdock"."capability_finding" DROP CONSTRAINT "capability_finding_identity";
EOF
echo "--- 읽기 tx 4초 보유 중 contract, lock_timeout 2초: 대기열이 읽기를 막는 범위"
( echo "begin; select count(*) from agentdock.package where id<10; select pg_sleep(4); commit;" | pqsoft m0011_lab_e >/dev/null ) &
H=$!; sleep 0.3; poll_start m0011_lab_e "$OUT/reads-q.txt"; sleep 0.3
t=$(now); { echo "begin; set local lock_timeout='2s';"; cat "$OUT/contract.sql"; echo "commit;"; } | pqsoft m0011_lab_e 2>&1 | grep -E 'ERROR' | cut -c1-100; echo "contract 실패까지 wall=$(( $(now)-t ))ms"
wait $H; poll_stop "$OUT/reads-q.txt"
echo "--- 방해 없는 contract"
poll_start m0011_lab_e "$OUT/reads-c.txt"; sleep 1
t=$(now); { echo "begin; set local lock_timeout='15s';"; cat "$OUT/contract.sql"; echo "commit;"; } | pq m0011_lab_e; echo "apply contract wall=$(( $(now)-t ))ms"
sleep 1; poll_stop "$OUT/reads-c.txt"
echo "--- 수축 후: 구 코드"; oldup | pqsoft m0011_lab_e 2>&1 | grep -E 'ERROR' | cut -c1-110
echo "--- 수축 후: 신 코드"; expup | pqsoft m0011_lab_e 2>&1 | grep -E 'ERROR|^ *[0-9]+' | cut -c1-110
echo "--- 수축 후: 긴 경로"; longup | pqsoft m0011_lab_e 2>&1 | grep -E 'ERROR|^ *[0-9]+' | cut -c1-110
hash m0011_lab_e

echo; echo "=== 5. 롤백"
RB='ALTER TABLE "agentdock"."package" ADD CONSTRAINT "package_identity" UNIQUE ("repository_id","type","source_path"); ALTER TABLE "agentdock"."capability_finding" ADD CONSTRAINT "capability_finding_identity" UNIQUE ("package_version_id","detector_id","category","source_path","start_line","summary");'
echo "--- 긴 경로가 저장된 뒤 구 제약 복원: 실패하고 아무것도 안 바뀌어야 함"
{ echo "begin; insert into agentdock.package (repository_id,type,source_path,name,slug) select r,t,$LONG,'x','x' from ($ID) q; savepoint s; $RB rollback;"; } | pqsoft m0011_lab_e 2>&1 | grep -E 'ERROR' | cut -c1-110
echo "--- 긴 경로 없음: 구 제약 복원 후 식 인덱스 삭제"
poll_start m0011_lab_e "$OUT/reads-b.txt"; sleep 1
t=$(now); { echo "begin; set local lock_timeout='15s'; $RB DROP INDEX agentdock.package_identity_digest; DROP INDEX agentdock.capability_finding_identity_digest; commit;"; } | pq m0011_lab_e; echo "rollback wall=$(( $(now)-t ))ms"
sleep 1; poll_stop "$OUT/reads-b.txt"
hash m0011_lab_e
echo "--- 롤백 후 구 코드"; oldup | pqsoft m0011_lab_e 2>&1 | grep -E 'ERROR' | cut -c1-110; echo "(오류 없으면 정상)"
echo finished
