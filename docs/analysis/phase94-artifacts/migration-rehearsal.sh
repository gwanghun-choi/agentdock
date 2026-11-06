#!/usr/bin/env bash
# Phase 94 Expand → Code → Contract → Rollback 리허설과 잠금 측정.
#
#   migration-rehearsal.sh --plan      만들 것과 검사 결과만 출력. 컨테이너를 만들지 않는다.
#   migration-rehearsal.sh --execute   실행. 출력은 실행 디렉터리의 rehearsal.log에 남는다.
#
# 격리: 이번 실행 전용 컨테이너 하나(tmpfs, 임의 포트, 127.0.0.1)에서만 돈다. 기존 agentdock-testdb에는
# 시작과 끝의 읽기 전용 지문 비교로만 접속한다. 정리는 그 컨테이너의 삭제뿐이므로 DB 삭제 문장이 없다.
# 파일은 mktemp로 만든 실행 디렉터리에만 쓰고 지우지 않는다. 저장소에는 쓰지 않는다.
# 기대와 다른 결과가 하나라도 나오면 즉시 멈춘다. psql과 bun에는 env -i로 이 파일이 정한 변수만 넘긴다.
# docker와 git은 접속 대상을 바꾸는 변수를 아래에서 지운 환경으로 돈다. 합격 여부는 로그 마지막 "판정:" 줄 하나다.
set -Eeuo pipefail
shopt -s inherit_errexit
umask 077
unset DATABASE_URL TEST_DATABASE_URL DATABASE_SCHEMA AGENTDOCK_APPROVED_MIGRATIONS AGENTDOCK_TARGET_FINGERPRINT \
  PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD PGSERVICE PGSERVICEFILE PGPASSFILE \
  DOCKER_HOST DOCKER_CONTEXT DOCKER_CONFIG GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE

readonly REPO=/home/ChoiGwanghun/workspace_auto/agentdock
readonly SCRATCH=/tmp/claude-1000/-home-ChoiGwanghun-workspace-auto-agentdock/5c2b22dc-57d2-4ff1-8d78-983a093cb69b/scratchpad
readonly A=$REPO/docs/analysis/phase94-artifacts
readonly OLD_REF=c1d4e7b
readonly IMAGE=postgres:17
readonly EXISTING_CONTAINER=agentdock-testdb
readonly T1=0011_path_digest_identity
readonly T2=0012_path_digest_contract

MODE=${1:-}
case "$MODE" in --plan | --execute) ;; *) echo "usage: $0 --plan | --execute" >&2; exit 64 ;; esac

RUN_ID=$(od -An -tx1 -N6 /dev/urandom | tr -d ' \n')
readonly RUN_ID
[[ $RUN_ID =~ ^[0-9a-f]{12}$ ]] || { echo "bad run id" >&2; exit 70; }
readonly CONTAINER=agentdock-m0012-$RUN_ID
readonly CLUSTER=$CONTAINER
readonly DB=m0012_lab_$RUN_ID
readonly DB_BOTH=m0012_both_$RUN_ID
readonly DB_LOCKS_A=m0012_locksa_$RUN_ID
readonly DB_LOCKS_B=m0012_locksb_$RUN_ID
BUN=$(command -v bun)
PSQL=$(command -v psql)
readonly BUN PSQL
readonly CHILD_PATH=$(dirname "$BUN"):/usr/bin:/bin
RUN_DIR=
PORT=
CID=
OWN_PIDS=()
CURRENT_STOP=
COMPLETED=
BASELINE_REPO=
BASELINE_EXISTING=

# redirect 안에서 불려도 이유가 로그에 남도록 로그 파일에 직접 쓴다.
die() {
  echo "ABORT: $*" >&2
  if [[ -n $RUN_DIR ]]; then echo "ABORT: $*" >>"$RUN_DIR/rehearsal.log"; fi
  exit 70
}

# ---- 접속 대상 검사. 접속하기 전에 호출한다. ----
# 역할은 앱 역할 또는 컨테이너 superuser, 비밀번호와 query string 없음, 호스트는 127.0.0.1, 포트는 이번 컨테이너의
# 포트이고 기존 포트가 아니어야 하며, DB는 이번 실행 이름 또는 그 컨테이너의 postgres(관리용)여야 한다.
assert_lab_url() {
  local url=$1 re
  re="^postgresql://(agentdock_app|postgres)@127\.0\.0\.1:([0-9]+)/([a-z0-9_]+)\$"
  [[ $url =~ $re ]] || die "URL 형식 거부"
  local role=${BASH_REMATCH[1]} port=${BASH_REMATCH[2]} name=${BASH_REMATCH[3]}
  [[ -n $PORT && $port == "$PORT" ]] || die "포트 거부: $port"
  [[ $port != 5432 && $port != 55432 ]] || die "기존 DB 포트 거부: $port"
  if [[ $name == postgres ]]; then
    [[ $role == postgres ]] || die "관리 DB는 superuser만"
  else
    [[ $name =~ ^m0012_[a-z]+_${RUN_ID}$ ]] || die "DB 이름 거부: $name"
  fi
}
lab_url() { printf 'postgresql://%s@127.0.0.1:%s/%s' "$1" "$PORT" "$2"; }

run_psql() { # role db args...
  local url
  url=$(lab_url "$1" "$2"); shift 2
  assert_lab_url "$url"
  env -i PATH="$CHILD_PATH" HOME="$RUN_DIR/home" LANG=C.UTF-8 "$PSQL" "$url" -X -q -A -t -v ON_ERROR_STOP=1 "$@"
}
# 접속한 서버가 이번 컨테이너이고 DB가 이번 실행 것인지 서버에 묻는다. 쓰기 전에 호출한다.
assert_identity() { # db
  local got
  got=$(run_psql postgres "$1" -c "select current_setting('cluster_name')||'/'||current_database()")
  [[ $got == "$CLUSTER/$1" ]] || die "서버 정체 불일치: $got"
  if [[ $1 != postgres ]]; then
    got=$(run_psql postgres "$1" -c "select shobj_description(oid,'pg_database') from pg_database where datname=current_database()")
    [[ $got == "rehearsal $RUN_ID" ]] || die "이번 실행이 만든 DB가 아님: $1"
  fi
}
su_sql() { local db=$1; shift; assert_identity "$db"; run_psql postgres "$db" "$@"; }
app_sql() { local db=$1; shift; assert_identity "$db"; run_psql agentdock_app "$db" "$@"; }

new_db() { # name
  [[ $1 =~ ^m0012_[a-z]+_${RUN_ID}$ ]] || die "DB 이름 거부: $1"
  # IF NOT EXISTS 없음: 이미 있으면 실패해야 한다.
  run_psql postgres postgres -c "create database $1" -c "comment on database $1 is 'rehearsal $RUN_ID'"
  assert_identity "$1"
  run_psql postgres "$1" -c "create extension pg_trgm schema public" \
    -c "create schema agentdock authorization agentdock_app"
  echo "  생성: DB $1 (컨테이너 $CONTAINER)"
}

# ---- 코드 판 실행 ----
child_env() { # db
  printf '%s\0' PATH="$CHILD_PATH" HOME="$RUN_DIR/home" LANG=C.UTF-8 REHEARSAL_RUN_ID="$RUN_ID" REHEARSAL_PORT="$PORT" \
    REHEARSAL_DB="$1" DATABASE_SCHEMA=agentdock DATABASE_URL="$(lab_url agentdock_app "$1")"
}
in_code() { # 코드 판, db, 명령...
  local dir=$RUN_DIR/code/$1 db=$2; shift 2
  [[ -f $dir/scripts/migrate.mjs ]] || die "코드 판 없음: $dir"
  assert_lab_url "$(lab_url agentdock_app "$db")"
  assert_identity "$db"
  local -a vars=()
  mapfile -d '' -t vars < <(child_env "$db")
  (cd "$dir" && exec env -i "${vars[@]}" AGENTDOCK_APPROVED_MIGRATIONS="${APPROVE:-}" timeout -k 5 "${CHILD_TIMEOUT:-120}" "$@")
}
mig() { local code=$1 db=$2; shift 2; in_code "$code" "$db" "$BUN" --no-env-file scripts/migrate.mjs "$@"; }
drv() { local code=$1 db=$2; shift 2; in_code "$code" "$db" "$BUN" --no-env-file scripts/zz-driver.ts "$@"; }

# ---- 기대 검사. 실제 종료 코드를 잡아 비교하고, 다르면 멈춘다. ----
STEP=0
expect() { # 기대 코드, 명령...
  local want=$1 rc=0 out
  shift
  STEP=$((STEP + 1))
  out=$RUN_DIR/out/$STEP.txt
  "$@" >"$out" 2>&1 || rc=$?
  cut -c1-200 "$out" | sed 's/^/    /'
  echo "    [exit $rc, 기대 $want]"
  [[ $rc == "$want" ]] || die "단계 $STEP 종료 코드 $rc, 기대 $want: $*"
  LAST=$out
}
has() { grep -qF -- "$1" "$LAST" || die "단계 $STEP 출력에 없음: $1"; }
has_re() { grep -qE -- "$1" "$LAST" || die "단계 $STEP 출력에 없음: $1"; }
assert_write() { # pre54000 | all | 42P10-new | 42P10-old
  case "$1" in
    pre54000 | all)
      has '"idType":"number","new":6,"findings":6'
      has '"new":0,"versions":0,"unchanged":6'
      has '"sameId":true,"updated":true,"findingsOnNewVersion":1'
      has_re '재분석: ok \{"findings":[1-9]'
      if [[ $1 == all ]]; then has '"same":true,"newVersions":0'; else has '4,000자 경로: FAIL 54000'; fi
      ;;
    42P10-new | 42P10-old)
      has '새 저장소·행+finding: FAIL 42P10'
      has '재수집(같은 내용): FAIL 42P10'
      has '기존 행 UPSERT 충돌(내용 변경): FAIL 42P10'
      has '4,000자 경로: FAIL 42P10'
      has '재분석: FAIL 42P10'
      ;;
    *) die "모르는 기대: $1" ;;
  esac
  has_re '읽기\(목록·검색·상세\): ok \{"list":[1-9][0-9]*,"found":[1-9][0-9]*,"detail":1\}'
}
assert_race() { has '동시 삽입 40건: {"ok":40} 행 20'; }
SEED_PRINT=
seed_print() {
  su_sql "$DB" -c "select md5(string_agg(p.id||'|'||p.repository_id||'|'||p.type||'|'||p.source_path||'|'||p.name||'|'||p.slug||'|'||p.meta::text||'|'||v.id||'|'||v.content_hash, ',' order by p.id, v.id)), count(*) from agentdock.package p join agentdock.repository r on r.id=p.repository_id join agentdock.package_version v on v.package_id=p.id where r.github_node_id like 'SEED%'" \
    -c "select md5(string_agg(f.id||'|'||f.source_path||'|'||f.summary, ',' order by f.id)), count(*) from agentdock.capability_finding f join agentdock.package_version v on v.id=f.package_version_id join agentdock.package p on p.id=v.package_id join agentdock.repository r on r.id=p.repository_id where r.github_node_id like 'SEED%'"
}
state() { # 인덱스 수·기록 수 기대값, 기존 행 지문 불변
  local got history print
  got=$(su_sql "$DB" -c "select coalesce(string_agg(indexname, ',' order by indexname),'') from pg_indexes where schemaname='agentdock' and indexname like '%identity%'")
  history=$(su_sql "$DB" -c 'select count(*) from agentdock.__drizzle_migrations')
  print=$(seed_print)
  echo "    상태: $got | history=$history | 기존 행 지문 ${print//$'\n'/ }"
  [[ $got == "$1" ]] || die "인덱스 상태 불일치, 기대 $1"
  [[ $history == "$2" ]] || die "history 불일치, 기대 $2"
  [[ -z $SEED_PRINT || $print == "$SEED_PRINT" ]] || die "기존 행이 바뀌었다"
  SEED_PRINT=$print
}
readonly I_OLD=capability_finding_identity,package_identity
readonly I_BOTH=capability_finding_identity,capability_finding_identity_digest,package_identity,package_identity_digest
readonly I_NEW=capability_finding_identity_digest,package_identity_digest

PARITY=
parity_is() { # 직전 출력의 지문이 판 사이에 같은지
  local got
  got=$(grep -oE '저장 결과 지문: [0-9a-f]+' "$LAST" | awk '{print $NF}')
  [[ -n $got ]] || die "지문 없음"
  [[ -z $PARITY || $got == "$PARITY" ]] || die "저장 결과가 판 사이에 다르다: $got, 기준 $PARITY"
  PARITY=$got
}

hold() { # db sleep초 lock문: 트랜잭션을 잡고 있는 세션을 띄우고, 잠금을 잡을 때까지 기다린다. HOLD_PID에 pid.
  local db=$1 secs=$2 stmt=$3
  assert_identity "$db"
  run_psql postgres "$db" -c begin -c "$stmt" -c "select pg_sleep($secs)" -c commit >/dev/null &
  HOLD_PID=$!
  OWN_PIDS+=("$HOLD_PID")
  local i
  for i in {1..50}; do
    [[ $(run_psql postgres "$db" -c "select count(*) from pg_stat_activity where datname=current_database() and query like 'select pg_sleep%' and state='active'") == 1 ]] && return 0
    sleep 0.1
  done
  die "잠금 세션이 시작되지 않음"
}

# ---- 기존 환경의 지문. 읽기만 한다. ----
# set -e에 기대지 않는다: 조건문 안에서 불려도 실패가 지문에 "complete" 없음으로 드러나야 한다.
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
  # 모든 DB의 oid, 두 스키마의 구조, 모든 테이블의 행 내용 해시. 읽기 전용 트랜잭션.
  docker exec "$EXISTING_CONTAINER" psql -U postgres -d agentdock_test -X -q -A -t -v ON_ERROR_STOP=1 \
    -c 'set default_transaction_read_only = on' \
    -c "select string_agg(oid||':'||datname, ',' order by datname) from pg_database" \
    -c "select md5(string_agg(schemaname||indexdef, ',' order by schemaname, indexname)) from pg_indexes where schemaname in ('agentdock','agentdock_test')" \
    -c "select md5(string_agg(table_schema||table_name||column_name||udt_name, ',' order by table_schema, table_name, column_name)) from information_schema.columns where table_schema in ('agentdock','agentdock_test')" \
    -c "select t.schemaname||'.'||t.tablename||' '||(xpath('/row/h/text()', query_to_xml(format('select count(*)||%L||coalesce(md5(string_agg(x::text, %L order by x::text)),%L) as h from %I.%I x', ':', ',', '', t.schemaname, t.tablename), false, true, '')))[1]::text from pg_tables t where t.schemaname in ('agentdock','agentdock_test') order by 1" \
    -c "select 'existing-db-complete'" || return 1
  docker ps --format '{{.ID}} {{.Names}}' | { grep -vF "$CONTAINER" || true; } | sort || return 1
  echo complete
}
assert_snapshot() { # 지문이 끝까지 만들어졌는지
  [[ $1 == *complete ]] || die "지문 수집 실패"
}

# ---- 정리: 이번 실행이 만든 프로세스와 컨테이너만. ----
cleanup() {
  local rc=$?
  trap - EXIT INT TERM HUP ERR
  set +e
  # expect의 redirect 안에서 멈췄어도 정리 내역은 로그로 간다.
  if [[ -n $RUN_DIR ]]; then exec >>"$RUN_DIR/rehearsal.log" 2>&1; fi
  echo; echo "=== 정리"
  if [[ -n $CURRENT_STOP ]]; then : >"$CURRENT_STOP"; fi
  local p
  for p in "${OWN_PIDS[@]:-}"; do
    [[ -n $p ]] || continue
    if kill -0 "$p" 2>/dev/null; then echo "  자식 프로세스 대기: $p"; fi
  done
  # docker run이 만든 뒤 실패해 id를 못 받은 경우까지, 정확한 이름과 라벨로 찾는다.
  if [[ -z $CID && -n $RUN_DIR ]]; then
    CID=$(docker ps -aq --no-trunc --filter "name=^/${CONTAINER}\$" --filter "label=agentdock.rehearsal=$RUN_ID")
  fi
  if [[ -n $CID ]]; then
    local name label
    name=$(docker inspect "$CID" --format '{{.Name}}' 2>/dev/null)
    label=$(docker inspect "$CID" --format '{{index .Config.Labels "agentdock.rehearsal"}}' 2>/dev/null)
    echo "  삭제 대상 컨테이너: id=$CID name=$name label=$label"
    if [[ $name == "/$CONTAINER" && $label == "$RUN_ID" ]]; then
      docker rm -f -v "$CID" >/dev/null && echo "  삭제 완료(이 안의 DB 포함)" || { echo "  삭제 실패, 수동 확인 필요"; rc=71; }
    else
      echo "  이름·라벨 불일치: 삭제하지 않음"; rc=71
    fi
  fi
  for p in "${OWN_PIDS[@]:-}"; do [[ -n $p ]] && wait "$p" 2>/dev/null; done
  local now
  if [[ -n $BASELINE_REPO ]]; then
    now=$(snapshot_repo)
    if [[ $now == "$BASELINE_REPO" ]]; then echo "  저장소 지문(HEAD, 추적, 미추적): 실행 전과 같음"; else echo "  저장소 지문: 달라짐"; rc=71; fi
    # ignore된 파일과 node_modules까지. 내용은 읽지 않고 수정 시각만 본다.
    find "$REPO" -xdev -type f -newer "$RUN_DIR/start.stamp" -not -path "$REPO/.git/*" >"$RUN_DIR/changed-files.txt"
    if [[ -s $RUN_DIR/changed-files.txt ]]; then
      echo "  실행 중 수정된 저장소 파일 $(wc -l <"$RUN_DIR/changed-files.txt")개: $RUN_DIR/changed-files.txt"; rc=71
    else
      echo "  저장소 전체(ignore 포함) 실행 중 수정된 파일: 0"
    fi
  fi
  if [[ -n $BASELINE_EXISTING ]]; then
    now=$(snapshot_existing)
    if [[ $now == "$BASELINE_EXISTING" ]]; then echo "  agentdock_test·기존 컨테이너 지문(DB oid, 구조, 행 내용): 실행 전과 같음"; else echo "  agentdock_test·기존 컨테이너 지문: 달라짐"; rc=71; fi
  fi
  echo "  실행 디렉터리(지우지 않음): $RUN_DIR"
  if [[ $rc == 0 && $COMPLETED == 1 ]]; then echo "판정: 전체 통과"; else echo "판정: 실패 (종료 코드 $rc, 완주 ${COMPLETED:-아니오})"; fi
  exit "$rc"
}

# ---- 시작 전 공통 검사 ----
self_test() {
  local u
  PORT=56000
  for u in \
    'postgresql://agentdock_app@ep-x.neon.tech:5432/neondb' \
    'postgresql://agentdock_app@127.0.0.1:55432/agentdock_test' \
    'postgresql://agentdock_app@127.0.0.1:5432/agentdock' \
    'postgresql://agentdock_app@127.0.0.1:56000/agentdock_test' \
    'postgresql://agentdock_app@127.0.0.1:56000/agentdock' \
    'postgresql://agentdock_app@127.0.0.1:56000/postgres' \
    'postgresql://agentdock_app@127.0.0.1:56001/m0012_lab_'"$RUN_ID" \
    'postgresql://agentdock_app@127.0.0.1:56000/m0012_lab_000000000000' \
    'postgresql://agentdock_app@localhost:56000/m0012_lab_'"$RUN_ID" \
    'postgresql://agentdock_app:pw@127.0.0.1:56000/m0012_lab_'"$RUN_ID" \
    'postgresql://agentdock_app@127.0.0.1:56000/m0012_lab_'"$RUN_ID"'?host=ep-x.neon.tech'; do
    if (RUN_DIR=; assert_lab_url "$u") 2>/dev/null; then die "검사 실패: 거부해야 할 URL 통과: ${u%%@*}@…"; fi
  done
  (assert_lab_url "postgresql://agentdock_app@127.0.0.1:56000/m0012_lab_$RUN_ID") || die "이번 실행 URL을 거부함"
  PORT=
  echo "  URL 검사: 거부 11건, 허용 1건 통과"
}
preflight() {
  [[ $(realpath "$REPO") == "$REPO" && -d $REPO/.git ]] || die "저장소 경로"
  [[ $(cd "$REPO" && git rev-parse --verify "$OLD_REF^{commit}" | cut -c1-7) == "$OLD_REF" ]] || die "기준 커밋"
  local f
  for f in "$A/contract-0012.patch" "$A/rollback-0012.sql" "$A/rehearsal-driver.ts.txt" "$A/rehearsal-sampler.ts.txt" "$A/synth-load.sql" "$A/synth-findings.sql"; do
    [[ -f $f ]] || die "없음: $f"
  done
  (cd "$REPO" && git apply --check "$A/contract-0012.patch") || die "패치가 작업 트리에 맞지 않음"
  docker image inspect "$IMAGE" >/dev/null || die "이미지 없음(받지 않는다)"
  local avail
  avail=$(awk '/^MemAvailable:/ {print int($2/1048576)}' /proc/meminfo)
  ((avail >= 6)) || die "가용 메모리 ${avail}GiB, 6GiB 필요"
  [[ -z $(docker ps -aq --filter "name=^/${CONTAINER}\$") ]] || die "같은 이름의 컨테이너가 있음"
  [[ -n $(docker ps -q --filter "name=^/${EXISTING_CONTAINER}\$") ]] || die "지문 비교할 기존 컨테이너 없음"
  self_test
}

if [[ $MODE == --plan ]]; then
  preflight
  cat <<EOF
계획 (아무것도 만들지 않았다)
  실행 ID          $RUN_ID
  만들 컨테이너    $CONTAINER, 이미지 $IMAGE(받지 않음), 127.0.0.1 임의 포트, tmpfs 3500m, cpu 2, 메모리 4g
  만들 DB          $DB, $DB_BOTH, $DB_LOCKS_A, $DB_LOCKS_B (모두 그 컨테이너 안)
  만들 파일        $SCRATCH/rehearsal-XXXXXX 아래만. 지우지 않음
  삭제 대상        위 컨테이너 하나. id·이름·라벨을 검증하고 출력한 뒤 docker rm -f -v
  지우지 않음      저장소 파일, $EXISTING_CONTAINER, agentdock_test, 다른 컨테이너, 다른 프로세스, 운영 DB
  읽기만 함        저장소(git), $EXISTING_CONTAINER 지문(시작·끝 비교), 패치·SQL·합성 데이터 파일
  운영 접속 경로   없음. 자식 환경은 env -i, bun은 --no-env-file, URL은 이 파일이 조립
EOF
  exit 0
fi

# ---- 실행 ----
RUN_DIR=$(mktemp -d "$SCRATCH/rehearsal-XXXXXX")
[[ $RUN_DIR == "$SCRATCH"/rehearsal-* ]] || die "실행 디렉터리"
mkdir "$RUN_DIR/home" "$RUN_DIR/out" "$RUN_DIR/code"
echo "$RUN_DIR/rehearsal.log"
exec >"$RUN_DIR/rehearsal.log" 2>&1
trap cleanup EXIT
trap 'exit 130' INT TERM HUP
trap 'echo "오류: 줄 $LINENO, 종료 코드 $?" >&2' ERR

date -u '+%FT%TZ'
echo "실행 ID $RUN_ID, 실행 디렉터리 $RUN_DIR"
preflight
: >"$RUN_DIR/start.stamp"
sleep 1 # 파일 시각 해상도와 겹치지 않게.
BASE_R=$(snapshot_repo)
assert_snapshot "$BASE_R"
BASE_E=$(snapshot_existing)
assert_snapshot "$BASE_E"
[[ $BASE_E == *existing-db-complete* ]] || die "기존 DB 지문 수집 실패"
BASELINE_REPO=$BASE_R
BASELINE_EXISTING=$BASE_E
echo "  시작 지문 기록(저장소, $EXISTING_CONTAINER)"

echo; echo "=== 0. 코드 판 준비 (실행 디렉터리 안에만)"
build_code() {
  local c=$RUN_DIR/code
  mkdir "$c/old" "$c/expand"
  (cd "$REPO" && git archive "$OLD_REF") | tar -x -C "$c/old"
  # 추적 파일과 ignore되지 않은 새 파일만. ignore된 비밀 파일은 목록에 없다. --delete 없음.
  (cd "$REPO" && git ls-files -co --exclude-standard -z) | { grep -zv '^docs/' || true; } |
    rsync -a --from0 --files-from=- "$REPO/" "$c/expand/"
  cp -a "$c/expand" "$c/contract"
  (cd "$c/contract" && git apply --whitespace=nowarn "$A/contract-0012.patch")
  cp -a "$c/expand" "$c/revert"
  cp -a "$c/contract" "$c/revert-contract"
  local d
  for d in revert revert-contract; do
    (cd "$REPO" && git show "$OLD_REF:src/ingest/persist.ts") >"$c/$d/src/ingest/persist.ts"
    (cd "$REPO" && git show "$OLD_REF:src/ingest/reanalyze.ts") >"$c/$d/src/ingest/reanalyze.ts"
  done
  for d in old expand contract revert revert-contract; do
    cp "$A/rehearsal-driver.ts.txt" "$c/$d/scripts/zz-driver.ts"
    cp "$A/rehearsal-sampler.ts.txt" "$c/$d/scripts/zz-sampler.ts"
    ln -s "$REPO/node_modules" "$c/$d/node_modules"
  done
  echo "  old=$OLD_REF, expand=작업 트리, contract=작업 트리+패치, revert=old의 persist·reanalyze+새 drizzle·schema"
  echo "  마이그레이션 수: old $(ls "$c/old/drizzle/"*.sql | wc -l), expand $(ls "$c/expand/drizzle/"*.sql | wc -l), contract $(ls "$c/contract/drizzle/"*.sql | wc -l)"
}
build_code

echo; echo "=== 0-1. 드라이버가 잘못된 대상을 접속 전에 거부하는지"
refuse() { # 접속 시도 전에 거부되어야 한다
  local rc=0 out=$RUN_DIR/out/refuse.txt
  (cd "$RUN_DIR/code/expand" && exec env -i PATH="$CHILD_PATH" HOME="$RUN_DIR/home" REHEARSAL_RUN_ID="$RUN_ID" REHEARSAL_PORT=56000 REHEARSAL_DB="m0012_lab_$RUN_ID" \
    DATABASE_URL="$1" timeout -k 5 20 "$BUN" --no-env-file scripts/zz-driver.ts probe) >"$out" 2>&1 || rc=$?
  [[ $rc != 0 ]] && grep -q 'refused: the URL' "$out" || die "드라이버가 거부하지 않음"
  rc=0
  (cd "$RUN_DIR/code/expand" && exec env -i PATH="$CHILD_PATH" HOME="$RUN_DIR/home" REHEARSAL_RUN_ID="$RUN_ID" REHEARSAL_PORT=56000 REHEARSAL_DB="m0012_lab_$RUN_ID" \
    DATABASE_URL="$1" timeout -k 5 20 "$BUN" --no-env-file scripts/zz-sampler.ts "$RUN_DIR/out/never" "$RUN_DIR/out/never.stop") >"$out" 2>&1 || rc=$?
  [[ $rc != 0 ]] && grep -q 'refused: the URL' "$out" || die "표본기가 거부하지 않음"
}
refuse 'postgresql://agentdock_app@ep-x.neon.tech:5432/neondb'
refuse 'postgresql://agentdock_app@127.0.0.1:55432/agentdock_test'
refuse 'postgresql://agentdock_app@127.0.0.1:56000/agentdock'
echo "  드라이버·표본기 각각 거부 3건 확인"

echo; echo "=== 0-2. 전용 컨테이너"
CID=$(docker run -d --pull never --name "$CONTAINER" --label "agentdock.rehearsal=$RUN_ID" \
  -p 127.0.0.1::5432 --memory 4g --cpus 2 --tmpfs /var/lib/postgresql/data:rw,size=3500m \
  -e POSTGRES_HOST_AUTH_METHOD=trust "$IMAGE" \
  -c "cluster_name=$CLUSTER" -c log_min_duration_statement=0 -c log_lock_waits=on -c deadlock_timeout=200ms \
  -c max_wal_size=256MB -c "log_line_prefix=%m %d ")
[[ $CID =~ ^[0-9a-f]{64}$ ]] || die "컨테이너 id"
BINDING=$(docker port "$CID" 5432/tcp)
[[ $BINDING =~ ^127\.0\.0\.1:([0-9]+)$ ]] || die "포트 바인딩 거부: $BINDING"
PORT=${BASH_REMATCH[1]}
[[ $PORT != 5432 && $PORT != 55432 ]] || die "기존 포트와 같음"
readonly PORT
export PORT
for _ in {1..120}; do
  if run_psql postgres postgres -c 'select 1' >/dev/null 2>&1; then break; fi
  sleep 0.5
done
assert_identity postgres
echo "  컨테이너 ${CID:0:12} $CONTAINER, 포트 127.0.0.1:$PORT, cluster_name=$CLUSTER"

run_psql postgres postgres -c "create role agentdock_app login nosuperuser nocreatedb nocreaterole nobypassrls noreplication" \
  -c "alter role agentdock_app set search_path = agentdock"
new_db "$DB"
echo "  pg $(su_sql "$DB" -c 'show server_version'), 적용 역할 agentdock_app"

echo; echo "=== 1. 구 스키마(0000~0010), 구 코드"
expect 0 mig old "$DB"
expect 0 drv old "$DB" old seed
state "$I_OLD" 11
expect 0 drv old "$DB" old write parity race; assert_write pre54000; parity_is; assert_race
state "$I_OLD" 11

echo; echo "=== 2. 신 코드 + 구 스키마 (배포 순서상 생기면 안 되는 칸)"
echo "  --- Sync 게이트"
expect 1 mig expand "$DB" --plan --require-current; has 'behind this checkout'
echo "  --- 게이트를 건너뛰고 직접 쓰면"
expect 0 drv expand "$DB" new-expand write; assert_write 42P10-old
state "$I_OLD" 11

echo; echo "=== 3. 0011과 0012를 한 번에 배포하면 (패치로 나눈 이유). 복제 DB"
assert_identity "$DB"
run_psql postgres postgres -c "create database $DB_BOTH template $DB" -c "comment on database $DB_BOTH is 'rehearsal $RUN_ID'"
echo "  생성: DB $DB_BOTH"
expect 2 mig contract "$DB_BOTH"; has 'needs approval'
APPROVE=$T1 expect 2 mig contract "$DB_BOTH"
[[ $(su_sql "$DB_BOTH" -c 'select count(*) from agentdock.__drizzle_migrations') == 11 ]] || die "승인 없이 적용됨"
echo "    history 11 그대로: 0011만 승인해도 아무것도 적용되지 않는다"
echo "  --- 교착 시험: Sync처럼 package를 쓰고 2초 뒤 capability_finding을 쓰는 트랜잭션 중에 Expand 적용. 둘 다 성공해야 함"
assert_identity "$DB_BOTH"
run_psql postgres "$DB_BOTH" -c begin -c "update agentdock.package set name = name where id = (select min(id) from agentdock.package)" -c 'select pg_sleep(2)' \
  -c "update agentdock.capability_finding set summary = summary where id = (select min(id) from agentdock.capability_finding)" -c commit >/dev/null &
H=$!; OWN_PIDS+=("$H")
for _ in {1..50}; do
  [[ $(run_psql postgres "$DB_BOTH" -c "select count(*) from pg_stat_activity where datname=current_database() and query like 'select pg_sleep%' and state='active'") == 1 ]] && break
  sleep 0.1
done
expect 0 mig expand "$DB_BOTH"; has 'applied 1 of 12'
wait "$H" || die "쓰기 트랜잭션이 실패했다(교착?)"
echo "    쓰기 트랜잭션과 Expand 모두 성공, 교착 없음"

echo; echo "=== 4. Expand 실패와 재시도"
expect 0 mig expand "$DB" --plan; has "$T1 — auto"
echo "  --- 실패 A: 쓰기 트랜잭션이 20초 잡음. 대기 상한 15초"
hold "$DB" 20 'lock table agentdock.capability_finding in row exclusive mode'
H=$HOLD_PID; t=$(date +%s%3N)
expect 1 mig expand "$DB"; has '55P03'
echo "    실패까지 $(( $(date +%s%3N) - t ))ms"
state "$I_OLD" 11
wait "$H" || die "잠금 세션 실패"
echo "  --- 실패 B: 두 번째 문장 실패(같은 이름의 객체). 첫 인덱스도 함께 롤백되어야 함"
su_sql "$DB" -c 'create table agentdock.capability_finding_identity_digest (x int)'
expect 1 mig expand "$DB"; has '42P07'
state "$I_OLD" 11
su_sql "$DB" -c 'drop table agentdock.capability_finding_identity_digest'
echo "  --- 재시도"
expect 0 mig expand "$DB"
state "$I_BOTH" 12
echo "  --- Deploy의 검증 단계"
expect 0 mig expand "$DB" --plan --require-current; has 'UP_TO_DATE'

echo; echo "=== 5. Expand 상태 매트릭스"
echo "  --- 신 코드 적용"
expect 0 drv expand "$DB" new-expand write parity race; assert_write pre54000; parity_is; assert_race; state "$I_BOTH" 12
echo "  --- 구 코드(진행 중이던 Sync가 끝까지 도는 경우)"
expect 0 drv old "$DB" old write parity; assert_write pre54000; parity_is; state "$I_BOTH" 12
echo "  --- 구 checkout으로 배포: 게이트가 막음"
expect 1 mig old "$DB" --plan --require-current; has 'does not have'
echo "  --- 구 코드 복귀(코드 커밋만 revert, 0011 유지)"
expect 0 mig revert "$DB" --plan --require-current; has 'UP_TO_DATE'
expect 0 drv revert "$DB" revert write parity; assert_write pre54000; parity_is; state "$I_BOTH" 12
echo "  --- 다시 신 코드"
expect 0 drv expand "$DB" new-expand write; assert_write pre54000

echo; echo "=== 6. Contract 게이트, 실패, 재시도"
echo "  --- Contract를 올린 직후, 승인 전 Sync 게이트"
expect 2 mig contract "$DB" --plan --require-current; has 'needs approval'
echo "  --- 승인 없이 적용"
expect 2 mig contract "$DB"; state "$I_BOTH" 12
echo "  --- 실패: 두 번째 문장의 테이블(capability_finding)을 읽기 트랜잭션이 6초 잡음. 대기 상한 2초. 첫 문장도 함께 롤백되어야 함"
hold "$DB" 6 'select count(*) from agentdock.capability_finding where id < 5'
H=$HOLD_PID; t=$(date +%s%3N)
APPROVE=$T2 expect 1 mig contract "$DB"; has '55P03'
echo "    실패까지 $(( $(date +%s%3N) - t ))ms"
state "$I_BOTH" 12
wait "$H" || die "잠금 세션 실패"
echo "  --- 재시도"
APPROVE=$T2 expect 0 mig contract "$DB"; state "$I_NEW" 13
expect 0 mig contract "$DB" --plan --require-current; has 'UP_TO_DATE'

echo; echo "=== 7. Contract 상태 매트릭스"
echo "  --- 신 코드: 긴 경로 저장"
expect 0 drv contract "$DB" new-contract write parity race; assert_write all; parity_is; assert_race; state "$I_NEW" 13
echo "  --- 구 코드 직접 쓰기 (금지된 칸)"
expect 0 drv old "$DB" old write; assert_write 42P10-old
echo "  --- 제약 복원 전에 코드만 되돌리면 (금지된 칸)"
expect 0 drv revert-contract "$DB" revert write; assert_write 42P10-old; state "$I_NEW" 13

echo; echo "=== 8. Contract 롤백"
rollback() { su_sql "$DB" -c "select 'rollback 대상 확인: '||current_database()"; run_psql agentdock_app "$DB" -f "$A/rollback-0012.sql"; }
echo "  --- 긴 경로가 저장된 상태: 실패하고 아무것도 바뀌지 않아야 함"
expect 3 rollback; has 'index row size'
state "$I_NEW" 13
echo "  --- 긴 경로 행 제거(사람의 결정) 후 복원. 실제 삭제 대상:"
su_sql "$DB" -c "select github_node_id, count(*) from agentdock.repository where github_node_id like 'L%' group by 1"
su_sql "$DB" -c "delete from agentdock.repository where github_node_id like 'L%'"
expect 0 rollback
state "$I_BOTH" 13
su_sql "$DB" -c "select conrelid::regclass, conname, contype from pg_constraint where conname like '%identity%' order by 2"
echo "  --- 복원 상태: 신 코드"
expect 0 drv contract "$DB" new-contract write; assert_write pre54000
echo "  --- 복원 상태: 구 코드 복귀(코드 revert, 0012 유지)"
expect 0 mig revert-contract "$DB" --plan --require-current; has 'UP_TO_DATE'
expect 0 drv revert-contract "$DB" revert write parity; assert_write pre54000; parity_is; state "$I_BOTH" 13
echo "  --- 다시 앞으로: 제약만 손으로 삭제"
su_sql "$DB" -c begin -c 'alter table agentdock.package drop constraint package_identity' \
  -c 'alter table agentdock.capability_finding drop constraint capability_finding_identity' -c commit
expect 0 drv contract "$DB" new-contract write parity; assert_write all; parity_is; state "$I_NEW" 13
echo "  시나리오 구간 끝 (최종 판정은 로그 마지막 줄)"

# ---- 잠금과 대기 측정 ----
summ() { # 표본파일 t0 t1 이름
  local f=$1 t0=$2 t1=$3 k
  for k in r w; do
    # 구간과 겹치는 요청 전부: 구간 직전에 시작해 잠금에 막힌 요청이 바로 재려는 값이다.
    [[ $(awk -v a="$t0" -v b="$t1" -v k="$k" '$2==k && $1<=b && $1+$3>=a {n++} END{print n+0}' "$f") -gt 0 ]] || die "$4: 표본 없음($k)"
    awk -v a="$t0" -v b="$t1" -v k="$k" '$2==k && $1<=b && $1+$3>=a {print $3}' "$f" | sort -n |
      awk -v n="$4" -v k="$k" '{v[NR]=$1} END{printf "    %s %s: n=%d p50=%dms max=%dms\n",n,(k=="r"?"읽기":"쓰기"),NR,v[int((NR+1)/2)],v[NR]}'
  done
  awk -v a="$t0" -v b="$t1" '$2=="l" && $1>=a && $1<=b {k=$3" "$4" granted="$5; if(!(k in s)) s[k]=$1; e[k]=$1} END{for(k in s) printf "    잠금 관찰(5ms 표본, 처음~마지막) %s: %dms\n",k,e[k]-s[k]}' "$f" | sort
}
measure() { # 이름 db 표본파일 명령...
  local name=$1 db=$2 f=$3 t0 t1
  shift 3
  sleep 2
  t0=$(date +%s%3N)
  "$@"
  t1=$(date +%s%3N)
  sleep 1
  echo "    $name 벽시계 $((t1 - t0))ms"
  summ "$f" "$t0" "$t1" "$name"
}
idx_is() { # db 기대
  [[ $(su_sql "$1" -c "select coalesce(string_agg(indexname, ',' order by indexname),'') from pg_indexes where schemaname='agentdock' and indexname like '%identity%'") == "$2" ]] || die "$1 인덱스 상태 불일치, 기대 $2"
}
locks_on() { # db 패키지수 finding수 finding배수
  local db=$1 pk=$2 fi=$3 mult=$4
  echo; echo "=== 9. 잠금 측정: 패키지 합성 $pk, finding $fi"
  new_db "$db"
  expect 0 mig old "$db"
  expect 0 drv old "$db" old seed
  sed "s/generate_series(1,45000)/generate_series(1,$pk)/" "$A/synth-load.sql" >"$RUN_DIR/synth-$db.sql"
  sed "s/generate_series(1,4) n/generate_series(1,$mult) n/; s/limit 200000/limit $fi/" "$A/synth-findings.sql" >"$RUN_DIR/findings-$db.sql"
  su_sql "$db" -f "$RUN_DIR/synth-$db.sql" >/dev/null
  su_sql "$db" -f "$RUN_DIR/findings-$db.sql" >/dev/null
  # 실행 계획용 큰 저장소 하나.
  su_sql "$db" -c "insert into agentdock.repository (github_node_id, full_name, owner, default_branch, stars, is_fork, scanned_at) values ('BIG','big/repo','big','main',1,false,now())" \
    -c "insert into agentdock.package (repository_id,type,source_path,name,slug) select r.id,'skill','big/'||g||'/SKILL.md','big'||g,'big'||g from agentdock.repository r, generate_series(1,5000) g where r.github_node_id='BIG'" \
    -c 'analyze agentdock.package' -c 'analyze agentdock.repository'
  # 합성 행 + seed 시나리오의 행. 합성 쪽이 limit을 다 채웠는지 본다.
  [[ $(su_sql "$db" -c "select count(*) from agentdock.capability_finding where detector_id='network' and summary like 'references %'") == "$fi" ]] || die "합성 finding 규모 불일치"
  su_sql "$db" -c "select '규모', (select count(*) from agentdock.package), (select count(*) from agentdock.package_version), (select count(*) from agentdock.capability_finding), pg_size_pretty(pg_total_relation_size('agentdock.package')), pg_size_pretty(pg_total_relation_size('agentdock.capability_finding'))"
  local sf=$RUN_DIR/samples-$db.txt stop=$RUN_DIR/stop-$db SP
  CURRENT_STOP=$stop
  local plan="explain (analyze, costs off, timing off, summary on) select p.id from agentdock.package p join agentdock.repository r on r.id=p.repository_id where p.delisted_at is null and lower(r.full_name)='big/repo' and p.source_path = any(array['big/2500/SKILL.md','big/2500/SKILL.md/SKILL.md'])"
  echo "  --- 상세 조회 계획, 구 스키마"; su_sql "$db" -c "$plan"
  CHILD_TIMEOUT=1200 in_code expand "$db" "$BUN" --no-env-file scripts/zz-sampler.ts "$sf" "$stop" &
  SP=$!; OWN_PIDS+=("$SP")
  sleep 1
  echo "  --- Expand (방해 없음)"
  measure Expand "$db" "$sf" expect 0 mig expand "$db"
  idx_is "$db" "$I_BOTH"
  echo "  --- 상세 조회 계획, Expand"; su_sql "$db" -c "$plan"
  local H
  echo "  --- Contract: 첫 문장의 테이블(package)을 읽기 트랜잭션이 6초 잡은 경우(상한 2초)"
  hold "$db" 6 'select count(*) from agentdock.package where id < 5'
  H=$HOLD_PID
  APPROVE=$T2 measure 'Contract-첫문장대기' "$db" "$sf" expect 1 mig contract "$db"; has '55P03'
  wait "$H" || die "잠금 세션 실패"
  echo "  --- Contract: 두 번째 문장의 테이블(capability_finding)을 잡은 경우. 첫 테이블의 ACCESS EXCLUSIVE를 쥔 채 기다리는 최악"
  hold "$db" 6 'select count(*) from agentdock.capability_finding where id < 5'
  H=$HOLD_PID
  APPROVE=$T2 measure 'Contract-둘째문장대기' "$db" "$sf" expect 1 mig contract "$db"; has '55P03'
  wait "$H" || die "잠금 세션 실패"
  idx_is "$db" "$I_BOTH"
  echo "  --- Contract (방해 없음)"
  APPROVE=$T2 measure Contract "$db" "$sf" expect 0 mig contract "$db"
  idx_is "$db" "$I_NEW"
  echo "  --- 상세 조회 계획, Contract"; su_sql "$db" -c "$plan"
  echo "  --- Contract 롤백"
  rb() { su_sql "$db" -c "select current_database()" >/dev/null; run_psql agentdock_app "$db" -f "$A/rollback-0012.sql"; }
  measure Rollback "$db" "$sf" expect 0 rb
  idx_is "$db" "$I_BOTH"
  : >"$stop"
  CURRENT_STOP=
  wait "$SP" || die "표본기 실패"
  echo "  --- 서버 로그의 문장 시간(이 DB)"
  # 문장이 여러 줄(앞머리 주석)일 수 있어, 로그 항목의 시간을 기억했다가 이어지는 줄에서 문장을 찾는다.
  docker logs "$CID" 2>&1 | awk -v db=" $db " '
    /^20/ { cur = 0; if (index($0, db) && match($0, /duration: [0-9.]+ ms/)) { ms = substr($0, RSTART + 10, RLENGTH - 10); cur = 1 } }
    cur && match($0, /(CREATE UNIQUE INDEX "[a-z_]+"|DROP CONSTRAINT "[a-z_]+"|ADD CONSTRAINT "[a-z_]+")/) { print "    " ms "  " substr($0, RSTART, RLENGTH) }' >"$RUN_DIR/ddl-$db.txt"
  cat "$RUN_DIR/ddl-$db.txt"
  [[ $(grep -c 'CREATE UNIQUE INDEX' "$RUN_DIR/ddl-$db.txt") -ge 2 && $(grep -c 'DROP CONSTRAINT' "$RUN_DIR/ddl-$db.txt") -ge 2 ]] || die "서버 로그에서 DDL 시간을 찾지 못함"
}
locks_on "$DB_LOCKS_A" 56671 200000 4
locks_on "$DB_LOCKS_B" 56671 1000000 20

COMPLETED=1
