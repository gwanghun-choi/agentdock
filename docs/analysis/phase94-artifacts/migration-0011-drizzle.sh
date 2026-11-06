#!/usr/bin/env bash
# 일회용 DB m0011_lab2만 만들고 지운다. worktree의 임시 테스트 파일은 종료 시 지운다.
set -u
S=/tmp/claude-1000/-home-ChoiGwanghun-workspace-auto-agentdock/5c2b22dc-57d2-4ff1-8d78-983a093cb69b/scratchpad
W=$S/wt-phase93
T=$W/src/db/zz-expr.test.ts
OUT=$(mktemp -d "$S/lab2-XXXXXX")
U=postgres
pq() { timeout -k 5 60 docker exec -i agentdock-testdb psql -U "$U" -d m0011_lab2 -q "$@"; }
cleanup() { rm -f -- "$T"; docker exec agentdock-testdb psql -U "$U" -d postgres -qc "drop database if exists m0011_lab2 with (force)" >/dev/null 2>&1; echo "cleaned; evidence in $OUT"; }
trap cleanup EXIT
trap 'exit 130' INT TERM HUP
cd "$W" || exit 1
cat > "$T" <<EOF
import { writeFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import { it } from 'vitest';
import { packageTable as p } from './schema';
const dialect = new PgDialect();
it('x', () => {
  const db = drizzle.mock();
  const insert = db.insert(p).values([{ repositoryId: 1, type: 'skill', sourcePath: 'zz/new', name: 'n', slug: 's', meta: { a: 1 }, files: ['f'] } as never]);
  const q = dialect.sqlToQuery(sql\`\${insert.getSQL()} on conflict (repository_id, type, sha256(replace(source_path, '\\\\', '\\\\\\\\')::bytea)) do update set name = excluded.name, updated_at = now() returning id, type, source_path\`);
  writeFileSync('$OUT/stmt.json', JSON.stringify({ sql: q.sql, params: q.params }));
});
EOF
timeout -k 5 60 nice -n 10 bun run test -- src/db/zz-expr.test.ts --maxWorkers=1 2>&1 | grep -E 'Tests  |Error' | cut -c1-140
timeout -k 5 120 nice -n 10 bun run typecheck 2>&1 | tail -3 | cut -c1-160; echo "typecheck exit ${PIPESTATUS[0]}"
rm -f -- "$T"

docker exec agentdock-testdb psql -U "$U" -d postgres -qc "create database m0011_lab2"
pq -c "create extension pg_trgm" -c "create schema agentdock"
for f in "$W"/drizzle/0*.sql; do pq -v ON_ERROR_STOP=1 < "$f" >/dev/null || exit 1; done
pq -c "insert into agentdock.repository (id, github_node_id, full_name, owner, default_branch, stars, is_fork, scanned_at) overriding system value values (1,'L','l/r','l','main',1,false,now())" 2>&1 | head -2
pq -c "insert into agentdock.repository (github_node_id, full_name, owner, default_branch, stars, is_fork, scanned_at) values ('L2','l/r2','l','main',1,false,now())" 2>&1 | grep -v '^$' | head -1
RID=$(pq -tAc "select min(id) from agentdock.repository")
node -e '
const {sql,params}=JSON.parse(require("fs").readFileSync(process.argv[1]+"/stmt.json","utf8"));
const lit=v=>v===null?"null":"\x27"+String(typeof v==="object"?JSON.stringify(v):v).replace(/\x27/g,"\x27\x27")+"\x27";
let i=0; const types=params.map(()=>"unknown");
console.log("PREPARE s AS "+sql+";\nEXECUTE s("+params.map(p=>lit(p===1?process.argv[2]:p)).join(",")+");\nDEALLOCATE s;");
' "$OUT" "$RID" > "$OUT/stmt.sql"
echo "--- generated"; node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1]+"/stmt.json","utf8")).sql.slice(-200))' "$OUT"
run() { pq -f - < "$OUT/stmt.sql" 2>&1 | grep -E 'ERROR|zz/new' | cut -c1-120; }
FIND="insert into agentdock.capability_finding (package_version_id, detector_id, detector_version, category, signal, summary, source_path, start_line, end_line) select v.id,'d','1','network_request','url','s','a',1,1 from agentdock.package_version v limit 1 on conflict do nothing"
echo "--- 구 스키마 + 식 target (Deploy 순서상 발생하지 않음, Sync는 require-current가 막음)"; run
pq -c 'CREATE UNIQUE INDEX "package_identity_digest" ON "agentdock"."package" ("repository_id","type",(sha256(replace(source_path, '"'"'\'"'"', '"'"'\\'"'"')::bytea)));'
echo "--- 확장 상태 1회차(삽입)"; run
echo "--- 확장 상태 2회차(같은 id 갱신)"; run
pq -c 'ALTER TABLE "agentdock"."package" DROP CONSTRAINT "package_identity";'
echo "--- 수축 상태(갱신)"; run
echo "--- 행 수"; pq -tAc "select count(*) from agentdock.package"
