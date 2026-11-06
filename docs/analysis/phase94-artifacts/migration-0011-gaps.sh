#!/usr/bin/env bash
# 일회용 DB m0011_lab3만 만들고 지운다. 운영 접속 없음.
set -u
S=/tmp/claude-1000/-home-ChoiGwanghun-workspace-auto-agentdock/5c2b22dc-57d2-4ff1-8d78-983a093cb69b/scratchpad
W=$S/wt-phase93
pq() { timeout -k 5 60 docker exec -i agentdock-testdb psql -U postgres -d m0011_lab3 -q -tA "$@"; }
cleanup() { docker exec agentdock-testdb psql -U postgres -d postgres -qc "drop database if exists m0011_lab3 with (force)" >/dev/null 2>&1; echo cleaned; }
trap cleanup EXIT
trap 'exit 130' INT TERM HUP
docker exec agentdock-testdb psql -U postgres -d postgres -qc "create database m0011_lab3" || exit 1
pq -c "create extension pg_trgm" -c "create schema agentdock"
for f in "$W"/drizzle/0*.sql; do pq -v ON_ERROR_STOP=1 < "$f" >/dev/null || exit 1; done
pq -c "select 'id types', (select data_type from information_schema.columns where table_schema='agentdock' and table_name='package' and column_name='id'), (select data_type from information_schema.columns where table_schema='agentdock' and table_name='package_version' and column_name='id')"
pq -c "insert into agentdock.repository (github_node_id, full_name, owner, default_branch, stars, is_fork, scanned_at) values ('L','l/r','l','main',1,false,now())"
pq -c "insert into agentdock.package (repository_id,type,source_path,name,slug) select id,'skill','a/SKILL.md','n','s' from agentdock.repository"
pq -c "insert into agentdock.package_version (package_id, commit_sha, content_hash, parse_status, ingested_at) select id,'c','h','ok',now() from agentdock.package"
D="sha256(replace(source_path, '\\', '\\\\')::bytea)"
UP="insert into agentdock.package (repository_id,type,source_path,name,slug) select id,'skill','a/SKILL.md','n2','s' from agentdock.repository on conflict (repository_id,type,$D) do update set name=excluded.name returning id"
OLDUP="insert into agentdock.package (repository_id,type,source_path,name,slug) select id,'skill','a/SKILL.md','n3','s' from agentdock.repository on conflict (repository_id,type,source_path) do update set name=excluded.name returning id"
F() { echo "insert into agentdock.capability_finding (package_version_id, detector_id, detector_version, category, signal, summary, source_path, start_line, end_line, commit_sha) select v.id,'d','1','network_request','url','$1','a/SKILL.md',$2,$2,'c' from agentdock.package_version v on conflict do nothing returning id"; }
state() {
  echo "=== $1"
  echo "pkg rows $(pq -c 'select count(*) from agentdock.package') id=$(pq -c 'select min(id) from agentdock.package')"
  echo "upsert 식 target: $(pq -c "$UP" 2>&1 | grep -E 'ERROR|^[0-9]' | head -1 | cut -c1-90)"
  echo "upsert 구 target: $(pq -c "$OLDUP" 2>&1 | grep -E 'ERROR|^[0-9]' | head -1 | cut -c1-90)"
  echo "finding 첫 삽입: [$(pq -c "$(F "s-$1" 1)" 2>&1 | grep -E 'ERROR|^[0-9]' | head -1 | cut -c1-70)]"
  echo "finding 재삽입(중복): [$(pq -c "$(F "s-$1" 1)" 2>&1 | grep -E 'ERROR|^[0-9]' | head -1 | cut -c1-70)]"
  echo "finding null start_line 2회: $(pq -c "$(F "n-$1" null)" 2>&1 | head -1 | cut -c1-40) / $(pq -c "$(F "n-$1" null)" 2>&1 | head -1 | cut -c1-40)"
  echo "finding 긴 경로는 문장별 54000 여부: $(pq -c "insert into agentdock.capability_finding (package_version_id, detector_id, detector_version, category, signal, summary, source_path, start_line, end_line, commit_sha) select v.id,'d','1','network_request','url','long',(select string_agg(md5(g::text),'') from generate_series(1,130) g),1,1,'c' from agentdock.package_version v on conflict do nothing returning length(source_path)" 2>&1 | grep -E 'ERROR|^[0-9]' | head -1 | cut -c1-70)"
}
state 구스키마
pq -c "CREATE UNIQUE INDEX package_identity_digest ON agentdock.package (repository_id,type,($D))" -c "CREATE UNIQUE INDEX capability_finding_identity_digest ON agentdock.capability_finding (package_version_id,detector_id,category,($D),start_line,summary)"
state Expand
pq -c 'ALTER TABLE agentdock.package DROP CONSTRAINT package_identity' -c 'ALTER TABLE agentdock.capability_finding DROP CONSTRAINT capability_finding_identity'
pq -c "delete from agentdock.capability_finding where summary='long'"
state Contract
echo "=== 복원 전 긴 경로 제거 후: 구 제약만 복원, 식 인덱스·코드는 유지"
pq -c "delete from agentdock.capability_finding where summary='long'"
pq <<'SQL' 2>&1 | grep ERROR | cut -c1-90
begin;
set local lock_timeout='2s';
CREATE UNIQUE INDEX package_identity ON agentdock.package (repository_id,type,source_path);
ALTER TABLE agentdock.package ADD CONSTRAINT package_identity UNIQUE USING INDEX package_identity;
CREATE UNIQUE INDEX capability_finding_identity ON agentdock.capability_finding (package_version_id,detector_id,category,source_path,start_line,summary);
ALTER TABLE agentdock.capability_finding ADD CONSTRAINT capability_finding_identity UNIQUE USING INDEX capability_finding_identity;
commit;
SQL
state 복원
echo "constraints: $(pq -c "select string_agg(conname, ',') from pg_constraint where conrelid in ('agentdock.package'::regclass,'agentdock.capability_finding'::regclass) and contype='u'")"
echo "indexes: $(pq -c "select string_agg(indexname, ',') from pg_indexes where schemaname='agentdock' and indexname like '%digest%'")"
echo "=== 긴 경로가 남아 있으면 복원은 실패하고 그대로"
pq -c 'ALTER TABLE agentdock.package DROP CONSTRAINT package_identity' -c "insert into agentdock.package (repository_id,type,source_path,name,slug) select id,'skill',(select string_agg(md5(g::text),'') from generate_series(1,130) g),'l','l' from agentdock.repository"
pq <<'SQL' 2>&1 | grep ERROR | head -1 | cut -c1-100
begin;
CREATE UNIQUE INDEX package_identity ON agentdock.package (repository_id,type,source_path);
commit;
SQL
echo "rows 유지 $(pq -c 'select count(*) from agentdock.package'), 구 인덱스 $(pq -c "select count(*) from pg_indexes where indexname='package_identity'")"
echo finished
