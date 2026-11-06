#!/usr/bin/env bash
# Phase 94 전체 검사. 작업 트리(Expand)와 작업 트리+contract-0012.patch(Contract) 각각을, 복사본과 전용 컨테이너에서 돌린다.
#
#   phase94-verify.sh --execute
#
# 기존 agentdock_test에는 지문 비교로만 접속한다. 테스트 가드는 127.0.0.1:55432/agentdock_test만 받으므로, 일회용 복사본의
# src/db/testDatabase.ts에서만 포트를 전용 컨테이너의 포트로 바꾼다. 포트를 단언하는 두 테스트는 원본 가드로 따로 돈다.
# 삭제는 이번 실행의 컨테이너뿐이고 파일은 지우지 않는다. 자식은 env -i, 복사본에는 ignore된 파일이 없다. 실패하면 즉시 멈춘다.
set -Eeuo pipefail
shopt -s inherit_errexit
umask 077
unset DATABASE_URL TEST_DATABASE_URL DATABASE_SCHEMA PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD PGSERVICE PGSERVICEFILE PGPASSFILE \
  DOCKER_HOST DOCKER_CONTEXT DOCKER_CONFIG GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE

readonly REPO=/home/ChoiGwanghun/workspace_auto/agentdock
readonly SCRATCH=/tmp/claude-1000/-home-ChoiGwanghun-workspace-auto-agentdock/5c2b22dc-57d2-4ff1-8d78-983a093cb69b/scratchpad
readonly A=$REPO/docs/analysis/phase94-artifacts
readonly EXISTING_CONTAINER=agentdock-testdb
readonly IMAGE=postgres:17
[[ ${1:-} == --execute ]] || { echo "usage: $0 --execute" >&2; exit 64; }

RUN_ID=$(od -An -tx1 -N6 /dev/urandom | tr -d ' \n')
readonly RUN_ID
BUN=$(command -v bun)
NODE=$(command -v node)
PSQL=$(command -v psql)
readonly BUN NODE PSQL
readonly CHILD_PATH=$(dirname "$BUN"):$(dirname "$NODE"):/usr/bin:/bin
readonly BROWSERS=$HOME/.cache/ms-playwright
RUN_DIR=$(mktemp -d "$SCRATCH/verify-XXXXXX")
[[ $RUN_DIR == "$SCRATCH"/verify-* ]] || { echo "실행 디렉터리" >&2; exit 70; }
readonly RUN_DIR
mkdir "$RUN_DIR/home" "$RUN_DIR/out"
readonly LOG=$RUN_DIR/verify.log
echo "$LOG"
exec >"$LOG" 2>&1

CID=
PORT=
CONTAINER=
COMPLETED=
BASELINE_REPO=
BASELINE_EXISTING=
STEP=0
die() { echo "ABORT: $*" >&2; echo "ABORT: $*" >>"$LOG"; exit 70; }

snapshot_repo() {
  (
    cd "$REPO" || exit 1
    export GIT_OPTIONAL_LOCKS=0
    git rev-parse HEAD || exit 1
    git status --porcelain=v1 | sha256sum || exit 1
    git diff --binary HEAD | sha256sum || exit 1
    git ls-files -o --exclude-standard -z | sort -z | xargs -0 sha256sum | sha256sum || exit 1
    echo complete
  )
}
snapshot_existing() {
  docker inspect "$EXISTING_CONTAINER" --format '{{.Id}} {{.State.StartedAt}}' || return 1
  docker exec "$EXISTING_CONTAINER" psql -U postgres -d agentdock_test -X -q -A -t -v ON_ERROR_STOP=1 \
    -c 'set default_transaction_read_only = on' \
    -c "select string_agg(oid||':'||datname, ',' order by datname) from pg_database" \
    -c "select md5(string_agg(schemaname||indexdef, ',' order by schemaname, indexname)) from pg_indexes where schemaname in ('agentdock','agentdock_test')" \
    -c "select md5(string_agg(table_schema||table_name||column_name||udt_name, ',' order by table_schema, table_name, column_name)) from information_schema.columns where table_schema in ('agentdock','agentdock_test')" \
    -c "select t.schemaname||'.'||t.tablename||' '||(xpath('/row/h/text()', query_to_xml(format('select count(*)||%L||coalesce(md5(string_agg(x::text, %L order by x::text)),%L) as h from %I.%I x', ':', ',', '', t.schemaname, t.tablename), false, true, '')))[1]::text from pg_tables t where t.schemaname in ('agentdock','agentdock_test') order by 1" \
    -c "select 'existing-db-complete'" || return 1
  echo complete
}
remove_container() {
  [[ -n $CID ]] || return 0
  local name label
  name=$(docker inspect "$CID" --format '{{.Name}}' 2>/dev/null) || name=
  label=$(docker inspect "$CID" --format '{{index .Config.Labels "agentdock.verify"}}' 2>/dev/null) || label=
  echo "  삭제 대상 컨테이너: id=$CID name=$name label=$label"
  [[ $name == "/$CONTAINER" && $label == "$RUN_ID" ]] || { echo "  이름·라벨 불일치: 삭제하지 않음"; return 1; }
  docker rm -f -v "$CID" >/dev/null || return 1
  echo "  삭제 완료"
  CID=
}
cleanup() {
  local rc=$?
  trap - EXIT INT TERM HUP ERR
  set +e
  exec >>"$LOG" 2>&1
  echo; echo "=== 정리"
  remove_container || rc=71
  local now
  now=$(snapshot_repo)
  if [[ $now == "$BASELINE_REPO" ]]; then echo "  저장소 지문: 실행 전과 같음"; else echo "  저장소 지문: 달라짐"; rc=71; fi
  find "$REPO" -xdev -type f -newer "$RUN_DIR/start.stamp" -not -path "$REPO/.git/*" >"$RUN_DIR/changed-files.txt"
  if [[ -s $RUN_DIR/changed-files.txt ]]; then echo "  실행 중 수정된 저장소 파일: $RUN_DIR/changed-files.txt"; rc=71; else echo "  저장소 전체(ignore 포함) 실행 중 수정된 파일: 0"; fi
  now=$(snapshot_existing)
  if [[ $now == "$BASELINE_EXISTING" ]]; then echo "  agentdock_test 지문: 실행 전과 같음"; else echo "  agentdock_test 지문: 달라짐"; rc=71; fi
  if [[ $rc == 0 && $COMPLETED == 1 ]]; then echo "판정: 전체 통과"; else echo "판정: 실패 (종료 코드 $rc)"; fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP
trap 'echo "오류: 줄 $LINENO, 종료 코드 $?" >&2' ERR

: >"$RUN_DIR/start.stamp"
sleep 1
BASELINE_REPO=$(snapshot_repo)
[[ $BASELINE_REPO == *complete ]] || die "저장소 지문"
BASELINE_EXISTING=$(snapshot_existing)
[[ $BASELINE_EXISTING == *existing-db-complete* && $BASELINE_EXISTING == *complete ]] || die "기존 DB 지문"
echo "실행 ID $RUN_ID, $(date -u '+%FT%TZ')"
(cd "$REPO" && git apply --check "$A/contract-0012.patch") || die "패치"

new_container() { # 상태 이름
  CONTAINER=agentdock-verify-$1-$RUN_ID
  CID=$(docker run -d --pull never --name "$CONTAINER" --label "agentdock.verify=$RUN_ID" \
    -p 127.0.0.1::5432 --memory 3g --cpus 2 --tmpfs /var/lib/postgresql/data:rw,size=2g \
    -e POSTGRES_DB=agentdock_test -e POSTGRES_HOST_AUTH_METHOD=trust "$IMAGE" -c "cluster_name=$CONTAINER")
  [[ $CID =~ ^[0-9a-f]{64}$ ]] || die "컨테이너 id"
  local binding
  binding=$(docker port "$CID" 5432/tcp)
  [[ $binding =~ ^127\.0\.0\.1:([0-9]+)$ ]] || die "포트 바인딩 거부: $binding"
  PORT=${BASH_REMATCH[1]}
  [[ $PORT != 5432 && $PORT != 55432 ]] || die "기존 포트와 같음"
  local i
  for i in {1..120}; do
    if lab_psql postgres -c 'select 1' >/dev/null 2>&1; then break; fi
    sleep 0.5
  done
  local who
  who=$(lab_psql postgres -c "select current_setting('cluster_name')||'/'||current_database()")
  [[ $who == "$CONTAINER/agentdock_test" ]] || die "서버 정체 불일치: $who"
  echo "  컨테이너 ${CID:0:12} $CONTAINER, 127.0.0.1:$PORT"
}
lab_psql() { # 역할 psql인자
  local role=$1
  shift
  [[ $PORT =~ ^[0-9]+$ && $PORT != 55432 && $PORT != 5432 ]] || die "포트 거부"
  env -i PATH="$CHILD_PATH" HOME="$RUN_DIR/home" LANG=C.UTF-8 "$PSQL" "postgresql://$role@127.0.0.1:$PORT/agentdock_test" -X -q -A -t -v ON_ERROR_STOP=1 "$@"
}
run() { # 코드디렉터리 이름 명령...
  local dir=$1 name=$2 rc=0 t0 t1
  shift 2
  STEP=$((STEP + 1))
  local out=$RUN_DIR/out/$STEP.txt
  t0=$(date +%s)
  (cd "$dir" && exec env -i PATH="$CHILD_PATH" HOME="$RUN_DIR/home" LANG=C.UTF-8 NEXT_TELEMETRY_DISABLED=1 ${EXTRA_ENV:-} "$@") >"$out" 2>&1 || rc=$?
  t1=$(date +%s)
  echo "  [$((t1 - t0))s] $name: exit $rc ($out)"
  LAST=$out
  [[ $rc == 0 ]] || { tail -40 "$out" | cut -c1-200; die "$name 실패"; }
}
build_copy() { # 이름 → 복사본 경로를 DIR에
  DIR=$RUN_DIR/$1
  mkdir "$DIR"
  (cd "$REPO" && git ls-files -co --exclude-standard -z) | { grep -zv '^docs/images/' || true; } |
    rsync -a --from0 --files-from=- "$REPO/" "$DIR/"
}
patch_guard() { # 복사본의 가드 포트만 전용 컨테이너로
  local f=$1/src/db/testDatabase.ts
  [[ $f == "$RUN_DIR"/* ]] || die "복사본 밖의 파일"
  grep -q "port: '55432'," "$f" || die "가드 형식"
  sed -i "s/port: '55432',/port: '$PORT',/" "$f"
}
counts() { sed -E 's/\x1b\[[0-9;]*m//g' "$LAST" | grep -E 'Test Files |Tests  ' | sed 's/^ */    /' | cut -c1-100; }

suite() { # 상태이름 복사본
  local state=$1 dir=$2 test_url
  echo; echo "=== $state"
  new_container "$state"
  test_url=postgresql://agentdock_app@127.0.0.1:$PORT/agentdock_test
  lab_psql postgres -f "$dir/scripts/sql/bootstrap-agentdock.sql" >/dev/null
  lab_psql postgres -c 'create extension if not exists pg_trgm schema public'
  patch_guard "$dir"
  local T="TEST_DATABASE_URL=$test_url"
  EXTRA_ENV="DATABASE_URL=postgresql://build:build@127.0.0.1:9/build" run "$dir" 'build (VERCEL=1)' env VERCEL=1 "$BUN" run build
  EXTRA_ENV="DATABASE_URL=postgresql://build:build@127.0.0.1:9/build" run "$dir" 'build (standalone)' "$BUN" run build
  run "$dir" check:boundaries "$BUN" run check:boundaries; tail -1 "$LAST" | sed 's/^/    /'
  run "$dir" lint "$BUN" run lint; tail -1 "$LAST" | sed 's/^/    /'
  run "$dir" typecheck "$BUN" run typecheck
  EXTRA_ENV="$T" run "$dir" db:test:setup "$BUN" run db:test:setup
  EXTRA_ENV="$T" run "$dir" 'db:test:migrations(0000~)' "$BUN" run db:test:migrations; tail -1 "$LAST" | sed 's/^/    /'
  # 포트를 단언하는 두 파일만 빼고 전부. 나머지 파일이 skip되지 않게 CI처럼 DB를 요구한다.
  EXTRA_ENV="$T REQUIRE_TEST_DATABASE=1" run "$dir" 'unit (DB 포함)' nice -n 10 "$BUN" run test --maxWorkers=4 --exclude src/db/testDatabase.test.ts --exclude src/env.test.ts; counts
  EXTRA_ENV="$T" run "$dir" search:eval nice -n 10 "$BUN" run search:eval; counts
  EXTRA_ENV="$T" run "$dir" e2e:seed "$BUN" run e2e:seed
  EXTRA_ENV="$T CI=1 PLAYWRIGHT_BROWSERS_PATH=$BROWSERS" run "$dir" 'E2E (Chromium)' nice -n 10 "$BUN" run test:e2e
  sed -E 's/\x1b\[[0-9;]*m//g' "$LAST" | grep -E '^ *[0-9]+ (passed|failed|flaky|skipped)' | sed 's/^ */    /' | cut -c1-100
  ! sed -E 's/\x1b\[[0-9;]*m//g' "$LAST" | grep -qE '^ *[0-9]+ (failed|flaky)' || die "E2E 실패 또는 flaky"
  # 원본 가드로, DB 없이.
  cp "$REPO/src/db/testDatabase.ts" "$dir/src/db/testDatabase.ts"
  run "$dir" '원본 가드 테스트 2개' nice -n 10 "$BUN" run test src/db/testDatabase.test.ts src/env.test.ts; counts
}

echo; echo "=== Expand 상태 복사본 (node_modules는 next 빌드 때문에 복사)"
build_copy expand
EXPAND=$DIR
cp -a "$REPO/node_modules" "$EXPAND/node_modules"
suite expand "$EXPAND"

echo; echo "=== 회귀 테스트가 실제로 잡는지 (같은 컨테이너, 복사본의 복사본에서 코드를 일부러 망가뜨린다)"
patch_guard "$EXPAND"
build_copy mutate
MUT=$DIR
ln -s "$EXPAND/node_modules" "$MUT/node_modules"
cp "$EXPAND/src/db/testDatabase.ts" "$MUT/src/db/testDatabase.ts"
T="TEST_DATABASE_URL=postgresql://agentdock_app@127.0.0.1:$PORT/agentdock_test"
mutant() { # 이름 sed식 기대문구
  local f=$MUT/src/ingest/persist.ts rc=0
  cp "$REPO/src/ingest/persist.ts" "$f"
  sed -i "$2" "$f"
  ! cmp -s "$REPO/src/ingest/persist.ts" "$f" || die "변이 적용 안 됨: $1"
  STEP=$((STEP + 1))
  local out=$RUN_DIR/out/$STEP.txt
  (cd "$MUT" && exec env -i PATH="$CHILD_PATH" HOME="$RUN_DIR/home" LANG=C.UTF-8 "$T" REQUIRE_TEST_DATABASE=1 "$BUN" run test src/ingest/persist.test.ts --maxWorkers=1) >"$out" 2>&1 || rc=$?
  [[ $rc != 0 ]] || die "변이 '$1'을 테스트가 잡지 못함"
  grep -qF -- "$3" "$out" || die "변이 '$1': 기대한 테스트가 실패하지 않음"
  echo "  변이 '$1': 테스트 실패로 잡힘 ($(grep -cE '^ *FAIL ' "$out")건), 예: $3"
}
mutant 'finding의 conflict target 삭제' 's/ on conflict \${findingIdentity} do nothing//' 'keeps two findings of one version apart by line, and collapses a true duplicate'
mutant 'bigint를 문자열 그대로 키로 사용' 's/idOf.set(key(r.type, r.source_path), packageIdOf(r.id))/idOf.set(key(r.type, r.source_path), r.id as never)/' 'keys findings by a package id that tx.execute returned as a string'
mutant '안전 범위 검사 제거' 's/if (!Number.isSafeInteger(id)) throw .*$//' 'stops the transaction at'

echo; echo "=== 구 코드 복귀 상태: 0011과 schema.ts는 두고 persist·reanalyze·persist.test만 c1d4e7b로"
build_copy revert
REV=$DIR
ln -s "$EXPAND/node_modules" "$REV/node_modules"
cp "$EXPAND/src/db/testDatabase.ts" "$REV/src/db/testDatabase.ts"
for f in src/ingest/persist.ts src/ingest/reanalyze.ts src/ingest/persist.test.ts; do
  (cd "$REPO" && git show "c1d4e7b:$f") >"$REV/$f"
done
run "$REV" 'revert: typecheck' "$BUN" run typecheck
EXTRA_ENV="$T REQUIRE_TEST_DATABASE=1" run "$REV" 'revert: unit (DB 포함)' nice -n 10 "$BUN" run test --maxWorkers=4 --exclude src/db/testDatabase.test.ts --exclude src/env.test.ts; counts
remove_container

echo; echo "=== Contract 상태 복사본"
build_copy contract
CONTRACT=$DIR
(cd "$CONTRACT" && git apply --whitespace=nowarn "$A/contract-0012.patch")
cp -a "$EXPAND/node_modules" "$CONTRACT/node_modules"
suite contract "$CONTRACT"
remove_container

COMPLETED=1
