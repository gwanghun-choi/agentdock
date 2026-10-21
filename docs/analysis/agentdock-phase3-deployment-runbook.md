# AgentDock Phase 2·3 운영 반영 Runbook

> 작성 2026-10-21, 기준 HEAD `77e7184` + 미커밋 변경 70개 항목.
> 이 문서는 **실행 절차**다. 아래 명령은 모두 운영자가 직접 실행한다. 작성 시점에는
> 운영 Neon 변경, 운영 Sync, Vercel 배포, commit/push를 하나도 하지 않았다.
> 배경: [phase3 운영 안정성](agentdock-phase3-operations-and-test-safety.md),
> [phase2 개선](agentdock-phase2-improvements.md), 일반 절차는 [VERCEL_DEPLOY.md](../../VERCEL_DEPLOY.md).

## 0. 한눈에 보기

```
① 복구 지점 → ② 이력 확인(8행) → ③ 0008 적용 → ④ 컬럼·이력 검증(9행)
→ ⑤ commit/push → ⑥ CI(check + database) → ⑦ Vercel Production → ⑧ 첫 Sync → ⑨ 정합성·검색
```

순서를 지켜야 하는 이유는 하나다. **새 sync 코드는 `repository.checked_at` / `check_failures`를
읽고 쓰므로**, 0008이 없는 DB에서 sync를 돌리면 repository insert·refresh 정렬이 실패한다.

| 조합 | 결과 | 근거 |
|---|---|---|
| 기존 코드 + 0008 적용 DB | 정상 | 0008은 컬럼 추가만 한다. 기존 컬럼만 지정하는 INSERT도 성공한다(`check_failures`=0, `checked_at`=NULL). 로컬 리허설 6단계 |
| 새 웹 코드 + 0008 미적용 DB | 정상(추정) | 웹 query는 컬럼을 명시해 select한다(`packages.ts` `repositorySummary`). 새 컬럼을 참조하는 곳은 `refresh.ts`, `jobs.ts`, `persist.ts`뿐이다 |
| 새 sync 코드 + 0008 미적용 DB | **실패** | `persist.ts`가 `checked_at`을 쓰고 `.returning()`을 호출하며, `refresh.ts`가 그 컬럼으로 정렬한다 |

Sync는 push로 시작되지 않는다(`sync.yml`의 트리거는 `schedule` `0 6,18 * * *` UTC와 `workflow_dispatch`뿐이다).
대신 push 이후 처음 돌아가는 예약 실행부터 develop HEAD의 새 코드로 실행된다. 그래서 **0008을 push보다 먼저** 적용한다.

## 1. 사전 조건

- [ ] 로컬 `~/workspace_auto/agentdock`, 브랜치 `develop`, 계정은 `gwanghun-choi` / `choi_huni@naver.com`이다.
  ```bash
  # 실행 위치: ~/workspace_auto/agentdock
  git branch --show-current && git config user.name && git config user.email && git log --oneline -1
  ```
- [ ] 로컬 검증이 green이다(2절).
- [ ] `psql`과 `bun` 1.3.x가 설치돼 있다.
- [ ] Neon의 `agentdock_app` **direct** 연결 문자열(호스트에 `-pooler`가 없는 것)을 준비했다. 파일이나 history에 남기지 않는다.
- [ ] GitHub Actions secret `DATABASE_URL`, `AGENTDOCK_GITHUB_TOKEN`이 등록돼 있다(Settings → Secrets → Actions에서 **이름만** 확인한다).
- [ ] 지금 Sync run이 돌고 있지 않다(3절 ③). 다음 예약은 06:00 / 18:00 UTC(15:00 / 03:00 KST)다. 그 시각에서 30분 이상 떨어진 때에 작업한다.

## 2. 안전 확인 (로컬, 운영 자원 미사용)

```bash
# 실행 위치: ~/workspace_auto/agentdock
# 로컬 일회용 테스트 DB (README Testing 절). 이미 있으면 생략.
docker run -d --name agentdock-testdb -e POSTGRES_DB=agentdock_test \
  -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:55432:5432 postgres:17
export TEST_DATABASE_URL=postgres://agentdock_app@127.0.0.1:55432/agentdock_test
unset DATABASE_URL
bun run db:test:bootstrap && bun run db:test:setup && bun run db:test:migrations

CI=1 bun run ci                       # boundaries + lint + typecheck + test. CI=1이면 live GitHub 테스트는 skip
DATABASE_URL=postgresql://build:build@127.0.0.1:9/build bun --no-env-file run build
git status --porcelain next-env.d.ts  # 출력이 없어야 한다
```

기대 결과: `check-boundaries: OK`, `No fixes applied.`, tsc exit 0, `1211 passed | 3 skipped`, build exit 0.
skip 3건은 모두 의도된 것이다. pg_trgm이 없는 환경 전용 케이스, trust DB에서의 wrong-password, `CI=1`일 때의 live permalink다.

Secret이 들어가지 않았는지 확인한다(출력은 비밀번호를 가린 형태다).

```bash
{ git diff; git ls-files --others --exclude-standard | xargs cat; } \
  | grep -oE "postgres(ql)?://[^:/@ ]+:[^@ ]+@[^/ ]+" | sed -E 's#(://[^:]+:)[^@]+@#\1***@#' | sort -u
```

여기에 나오는 Neon 호스트는 `ep-x…`, `ep-cool-name-a1b2c3…`뿐이어야 한다. 둘 다 `src/db/testDatabase.test.ts`와 `src/env.test.ts`의 테스트용 sentinel이다.

## 3. Migration 0008 적용

### ① 복구 지점

Neon Console → Project → **Branches → Create branch**. 부모는 production branch, 이름은 `pre-0008-YYYYMMDD`로 한다.
copy-on-write라서 비용이 거의 없고, 이후 비교와 복구에 쓸 수 있다.
Console의 restore window(PITR 보존 기간)도 함께 확인한다. 보존 기간은 플랜마다 다르므로 직접 본 값을 적어 둔다.

- [ ] branch 생성 완료 / restore window: ______

branch를 만들지 못했으면 **여기서 멈춘다**.

### ② 연결 준비와 적용 이력 확인

```bash
# 실행 위치: ~/workspace_auto/agentdock
read -rs DATABASE_URL && export DATABASE_URL   # agentdock_app DIRECT 문자열을 붙여넣는다. 화면과 history에 남지 않는다
export DATABASE_SCHEMA=agentdock                # export한 값이 .env보다 우선한다(Bun은 기존 변수를 덮어쓰지 않는다)

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At <<'SQL'
select current_user, current_schema();
select count(*), max(created_at) from agentdock.__drizzle_migrations;
select count(*) from information_schema.columns
 where table_schema='agentdock' and table_name='repository' and column_name in ('checked_at','check_failures');
SQL
```

| 결과 | 판단 |
|---|---|
| `agentdock_app|agentdock`, `8|1786511031974`, `0` | 정상. ③으로 진행한다 |
| `9|1792545594506`, `2` | 이미 적용됐다. ④로 간다 |
| 그 밖의 값(행 수 ≠ 8, max가 다름, 컬럼이 1개) | **멈춘다.** 운영 DB가 이 저장소의 이력과 다르다. migrate는 빠진 migration을 전부 적용하려 하므로, 원인을 먼저 확인한다 |

### ③ 적용

진행 중인 Sync가 없는지 확인한다. 0008의 `ALTER TABLE`은 ACCESS EXCLUSIVE lock을 짧게 잡는다.
repository를 읽는 열린 transaction이 있으면 그것이 끝날 때까지 기다린다(로컬 측정: 6초짜리 reader 뒤에서 5초 대기). 대기하는 동안에는 그 뒤로 오는 웹 query도 함께 막힌다.

```bash
gh run list --workflow=sync.yml --limit 3      # in_progress가 없어야 한다
psql "$DATABASE_URL" -At -c "select pid, state, now()-xact_start from pg_stat_activity
  where datname=current_database() and xact_start is not null and pid<>pg_backend_pid() order by 3 desc limit 5;"
```

```bash
bun run db:migrate
```

기대 출력: `agentdock: applied 1 of 9 migration(s).`
`scripts/migrate.mjs`는 statement와 이력 insert를 **한 transaction**에서 실행한다. 실패하면 아무것도 바뀌지 않는다.
30초 넘게 출력이 없으면 lock 대기다. Ctrl-C로 끊고(transaction은 롤백된다) 위의 `pg_stat_activity`를 다시 본 뒤 재시도한다.

### ④ 검증

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At <<'SQL'
select column_name, data_type, is_nullable, coalesce(column_default,'<none>')
  from information_schema.columns
 where table_schema='agentdock' and table_name='repository'
   and column_name in ('checked_at','check_failures') order by 1;
select count(*), max(created_at) from agentdock.__drizzle_migrations;
select count(*) total, count(checked_at) checked, count(*) filter (where check_failures<>0) failing
  from agentdock.repository;
SQL
bun run db:migrate          # 다시 실행: "already up to date (9 migration(s) on disk)."
unset DATABASE_URL DATABASE_SCHEMA
```

기대 결과:
```
check_failures|integer|NO|0
checked_at|timestamp with time zone|YES|<none>
9|1792545594506
<N>|0|0
```

`checked`가 0인 것이 정상이다. backfill은 없고, refresh는 `coalesce(checked_at, scanned_at)`을 쓰므로 기존 행의 순서가 그대로 유지된다.
하나라도 다르면 **push하지 않는다.** 6절을 본다.

## 4. Commit / Push (사용자 직접)

중간 commit이 green인지는 검증하지 않았다. GitHub `push` 이벤트의 CI와 Vercel은 **push된 HEAD만** 빌드한다.
따라서 아래 commit을 **한 번의 push로** 올리면 운영에는 최종 상태만 반영된다. commit을 하나로 합쳐도 무방하다.
아래 7개 commit은 변경 70개 항목을 모두 덮는다(누락 0건 확인). 이 Runbook 자체는 마지막 `docs/analysis`에 포함된다.

```bash
# 실행 위치: ~/workspace_auto/agentdock
git add vitest.config.ts bunfig.toml tsconfig.json .env.example src/db/testDatabase.ts src/db/testDatabase.test.ts src/db/testPreload.ts src/env.ts src/env.test.ts src/db/client.test.ts scripts/migrate.mjs scripts/test-reset.mjs
git commit -m "test(db): run database suites only against the local disposable PostgreSQL, never a .env or shell DATABASE_URL"

git add .github/workflows/ci.yml scripts/sql/bootstrap-test-database.sql package.json src/db/migrations.test.ts
git commit -m "ci: run the database suites and the reviewed migrations against a PostgreSQL 17 service container"

git add src/analyze src/ingest/persist.ts src/ingest/persist.test.ts src/ingest/pipeline.ts src/ingest/types.ts src/ingest/reanalyze.ts src/ingest/reanalyze.test.ts src/github/scan.ts src/github/scan.test.ts src/db/schema.ts drizzle src/db/queries/jobs.ts src/corpus/refresh.ts src/corpus/refresh.test.ts src/corpus/caps.ts 'src/app/r/[owner]/[repo]/[...path]/page.tsx'
git commit -m "fix(ingest): per-type inventories, partial re-reads, and a checked_at/check_failures backoff so unreadable stored repositories stop heading every refresh"

git add src/ingest/worker.ts src/ingest/worker.test.ts src/github/client.ts src/github/client.test.ts src/github/search.ts src/corpus src/db/queries/syncState.ts scripts/corpus-sync.mjs src/app/page.tsx .github/workflows/sync.yml
git commit -m "feat(sync): token-aware budget, fair resumable topic sweep with a shard failure cap, rate-limit-aware drain, stage isolation and sync:last_attempt"

git add src/db/queries/search.ts src/db/queries/search.test.ts src/app/artifacts/page.tsx
git commit -m "feat(search): claim absence only where observed, prefix/path/any-word matching, one search mode per request"

git add src/components 'src/app/jobs/[id]/page.tsx' 'src/app/r/[owner]/[repo]/page.tsx'
git commit -m "fix(ui): status-aware job polling, frontmatter only after a key line, accurate queued and filter copy"

git add README.md README.en.md DEPLOY.md docs/analysis
git commit -m "docs: record phase 2 and phase 3 changes, test database setup and the migrate-before-push order"

git status --porcelain          # 출력이 없어야 한다
git push origin develop
```

## 5. 배포 후 관측

### ⑥ GitHub Actions CI

```bash
gh run list --workflow=ci.yml --branch develop --limit 1
gh run watch <run-id>
```

- [ ] `check` job green (build → `bun run ci`)
- [ ] `database` job green (`db:test:bootstrap` → `db:test:setup` → `db:test:migrations` → `bun run test`, **원격에서 처음 실행됨**)

CI가 red여도 Vercel 배포는 따로 진행된다. 6절 "CI red"를 본다.

### ⑦ Vercel Production

Vercel Dashboard → Deployments에서 push한 sha의 Production 배포가 **Ready**인지 확인한다.
작성 시점에 Production Branch 설정은 직접 확인하지 않았다. 2026-10-19 기록에 따르면 develop push(`28639ec`)가 Production 배포를 만들었다. 이번에 확인한 sha: ______

배포 직후에 확인하는 smoke URL은 아래와 같다. 모두 200이어야 하고, 2xx/3xx가 아닌 응답이 하나라도 있으면 6절로 간다.

```bash
B=https://agentdock-delta.vercel.app
for p in / "/artifacts?q=skill" "/artifacts?type=skill" "/artifacts?type=mcp_server" \
         "/artifacts?cap=no_network" "/artifacts?cap=no_scripts" "/artifacts?q=agent&page=2"; do
  curl -s -o /dev/null -w "%{http_code} %{time_total}s  $p\n" "$B$p"
done
```

화면에서 확인할 것:
- [ ] 홈 하단에 `last sync without errors <UTC 시각>`이 보인다(첫 성공 Sync 전에는 이전 값).
- [ ] `/artifacts`에서 검색 결과와 이전/다음 링크(`rel=prev/next`)가 동작하고, Capability 체크박스가 유지된다.
- [ ] Skill 1개, Plugin 1개, MCP Server 1개의 상세 페이지(`/r/<owner>/<repo>` → 파일 링크)가 200이고, source 링크가 commit sha를 가리킨다.

### ⑧ 첫 Sync

다음 예약을 기다리거나, 관찰할 수 있을 때 수동으로 실행한다. 수동 실행도 GitHub API 예산을 정상 실행과 똑같이 쓴다.

```bash
gh workflow run Sync --ref develop     # 선택. 예약을 기다려도 된다
gh run list --workflow=sync.yml --limit 1
gh run view <run-id> --log > sync-run.log      # 로그에는 secret이 마스킹돼 있지만 커밋하지 않는다
grep -E "stage=|corpus-sync:" sync-run.log | head -60
sed -n '/AgentDock scheduled sync/,/re-checks of stored repos/p' sync-run.log
```

로그의 summary 블록(`AgentDock scheduled sync`)에서 볼 항목:

| 줄 | 정상 범위 | 멈춤 신호 |
|---|---|---|
| exit code | 0 | 1이면 `stage=<name> FAILED` 줄로 실패한 단계를 찾는다 |
| `Rate limited, deferred` | 0 또는 소수 | 다수 + `Drain stopped by` rate limit이면 예산 문제다 |
| `Other failures` / `of which retry next run` | 소수 | 전부가 재시도 대상이 아니면 로그 원인을 확인한다 |
| `Stored repos failing checks` | 처음에는 `0 (before this drain)` | 실행마다 계속 늘면 404 정책을 검토한다 |
| `Jobs still queued` | 다음 실행에서 줄어든다 | 실행마다 늘면 drain 상한·예산을 검토한다 |
| `Drain stopped by` | `its cap or an empty queue` 또는 deadline | rate limit이 반복된다 |
| `GitHub core requests left` / `spent` | token 사용 시 `of 5000` | `unauthenticated`이면 secret 누락이다 |
| `Discovered this run` | 각 source별 `seed(s) written` | `FAILED, see above` |
| topic shard | `dropped` 이름이 있으면 확인 | 같은 shard가 매번 버려진다 |

### ⑨ 데이터 정합성 (읽기 전용 SQL, 운영자 실행)

```bash
read -rs DATABASE_URL && export DATABASE_URL
psql "$DATABASE_URL" -At <<'SQL'
select key, updated_at, value from agentdock.schema_meta where key in ('sync:last_success','sync:last_attempt');
select status, count(*) from agentdock.ingest_job group by 1 order by 1;
select check_failures, count(*) from agentdock.repository group by 1 order by 1;
select count(*) filter (where checked_at is not null) checked,
       count(*) filter (where checked_at > scanned_at) checked_after_read
  from agentdock.repository;
select count(*) filter (where analyzed_at is null) unanalyzed, count(*) total from agentdock.package_version;
SQL
unset DATABASE_URL
```

- `sync:last_attempt.ok = true`이고 `failedStages = []`이다.
- `checked`가 0보다 크다. 이번 실행에서 refresh 또는 drain이 해당 repository를 다뤘다는 뜻이다.
- `check_failures`가 1 이상인 행은 404, too_large, 재시도 소진 대상이다. 다음 확인 시점은 `stale × 2^min(n,4)` 뒤로 밀린다(backoff).
  이 값은 두 번째 Sync 이후에 `failing checks` 숫자로 확인할 수 있다.
- `unanalyzed`는 Phase 2에서 남은 조건이다(`reanalyze` 대상 규모). 이 값을 기록한다.

## 6. 실패 시 중단 조건과 복구

| 단계 | 증상 | 조치 |
|---|---|---|
| ① | branch를 만들 수 없음 | 중단한다 |
| ② | 이력이 8행이 아니거나 컬럼 일부만 있음 | 중단한다. 운영 이력을 조사하고, 이 Runbook을 쓰지 않는다 |
| ③ | migrate가 오류로 실패 | transaction이 롤백돼 변경이 없다. 오류를 확인하고 ②부터 다시 한다 |
| ③ | 출력이 없이 대기 | Ctrl-C로 끊는다(롤백). 열린 transaction이나 진행 중인 Sync가 끝나면 재시도한다 |
| ④ | 컬럼·이력 불일치 | push하지 않는다. 아래 "DB 롤백"을 판단한다 |
| ⑥ | CI red | Vercel은 이미 배포 중일 수 있다(웹은 0008과 무관). **다음 예약 Sync 전에** `git revert` commit을 push하거나 `gh workflow disable Sync`로 Sync를 멈춘다. 원인을 수정한 뒤 `gh workflow enable Sync` |
| ⑦ | Vercel build 실패 | Vercel은 실패한 build를 승격하지 않으므로 이전 Production이 계속 서비스된다. 로그를 확인한다(2026-10-19의 원인 미상 실패 기록 있음). Sync는 Vercel과 독립적이라 예정대로 돈다 |
| ⑦ | 배포됐지만 smoke URL 실패 | Dashboard에서 이전 Production 배포를 Instant Rollback/Promote한다. 0008은 이전 코드와 호환되므로 DB는 그대로 둔다 |
| ⑧ | Sync exit 1 | `stage=… FAILED` 줄로 단계를 찾는다. 같은 단계가 2회 연속 실패하면 Sync를 disable하고 `git revert`한다. Sync는 단계마다 격리돼 있어서 한 단계가 실패해도 나머지 단계는 실행된다 |
| ⑨ | `queued`가 실행마다 증가, rate limit 반복 | token secret과 예산을 확인한다. 상한값(`src/corpus/caps.ts`) 조정은 별도 변경으로 진행한다 |

### 코드 롤백

```bash
# 실행 위치: ~/workspace_auto/agentdock  (reset·rebase 금지, revert만 사용)
git revert --no-edit <첫 commit>^..<마지막 commit>
git push origin develop
```

### DB 롤백 (거의 필요 없음)

이전 코드는 0008이 적용된 DB에서도 정상 동작한다(리허설 6단계). 그러므로 코드를 롤백할 때 DB는 **그대로 두는 것이 기본**이다.
컬럼 자체를 지워야 할 때만, **새 코드가 더는 실행되지 않는 것을 확인한 뒤** 아래를 실행한다.
로컬에서 롤백한 뒤 다시 적용되는 것까지 확인했다(리허설 8단계).

```sql
BEGIN;
ALTER TABLE "agentdock"."repository" DROP COLUMN "check_failures";
ALTER TABLE "agentdock"."repository" DROP COLUMN "checked_at";
DELETE FROM "agentdock"."__drizzle_migrations" WHERE created_at = 1792545594506;
COMMIT;
```

`checked_at` / `check_failures` 값은 다시 만들 수 없지만, 다음 refresh가 다시 채운다. 데이터 전체가 손상됐으면 ①의 Neon branch로 복구한다.

## 7. 로컬 리허설 기록 (2026-10-21)

대상은 로컬 컨테이너 `agentdock-testdb`(postgres 17.11, 127.0.0.1:55432, `agentdock_test` DB의 `agentdock` schema)다. 실행 스크립트는 `scripts/migrate.mjs --test-database`이고, 0000–0007만 담은 폴더로 먼저 적용했다.

| 단계 | 결과 |
|---|---|
| 0007 상태 + 기존 형식 행 2개(`scanned_at` 있음/없음) | `applied 8 of 8` |
| 0008 적용 | `applied 1 of 9`, relfilenode 17577 → 17577(**table rewrite 없음**) |
| 컬럼 | `check_failures integer NOT NULL DEFAULT 0`, `checked_at timestamptz NULL` |
| 기존 행 | `checked_at` NULL, `check_failures` 0 |
| 이력 | 9행, max `1792545594506` |
| 재실행 | `already up to date (9 migration(s) on disk)` |
| 기존 코드 형식 INSERT | 성공, 기본값 적용 |
| raw SQL 재실행 | `column "checked_at" … already exists`로 실패(무변경) |
| 롤백 SQL → 재적용 | 컬럼 0개, 이력 8행 → `applied 1 of 9`, 9행 |
| 열린 reader(6초) 뒤에서 migrate | 5초 대기 후 적용 |

journal 연속성: idx 0–8, tag와 파일명 일치, `when`은 단조 증가(0007 `1786511031974` < 0008 `1792545594506`).
migrate는 `created_at`이 마지막 이력보다 큰 migration만 적용하므로, 운영(8행)에는 0008 하나만 적용된다.

## 8. 남은 위험

| 위험 | 영향 | 대응 |
|---|---|---|
| 운영 이력이 8행인지 확인하지 않음 | 다르면 예상하지 못한 migration이 적용됨 | ② 판단표에 따라 멈춤 |
| CI `database` job이 원격에서 처음 실행됨 | red 가능(로컬 컨테이너로 재현했을 때는 green) | ⑥, 6절 |
| Vercel Production Branch 설정 미확인 | push가 Production을 만들지 않을 수 있음 | ⑦에서 sha 확인 |
| 2026-10-19 Vercel 원인 미상 실패 기록 | build 실패 시 이전 버전이 계속 서비스됨 | ⑦ 로그 |
| 첫 Sync 지표(R7 상한, 예산)를 운영에서 측정하지 않음 | drain 정지·queued 누적 | ⑧ 표, 두 번째 Sync까지 관찰 |
| 오래 404인 repository를 delist하지 않음(정책 미정) | 목록에 계속 남음. 재확인 간격은 최대 2^4배 | 정책 결정 필요 |
| `analyzed_at IS NULL` 규모 미측정(Phase 2) | 분석 안 된 version 수 | ⑨ 기록 |
| 중간 commit green 미검증 | bisect 시 red commit 가능 | 한 번에 push(4절) |

## 9. 실행 체크리스트

- [ ] 2절 로컬 green
- [ ] ① Neon branch `pre-0008-…`
- [ ] ② 8행 / 컬럼 0
- [ ] ③ `applied 1 of 9`
- [ ] ④ 컬럼 2개, 9행, 재실행 up to date
- [ ] ⑤ 7 commit, 한 번에 push
- [ ] ⑥ CI check + database green
- [ ] ⑦ Vercel Ready, smoke 200
- [ ] ⑧ 첫 Sync exit 0, summary 기록
- [ ] ⑨ `sync:last_attempt.ok`, `checked` > 0, `unanalyzed` 기록
- [ ] 두 번째 Sync: `failing checks`, `Jobs still queued` 추이
