# AgentDock Phase 3: 운영 안정성과 DB 테스트 안전성

> 기준: `develop` @ `77e7184`. Phase 2 변경 위에서 작업했고 **모두 미커밋**이다(2026-10-21).
> 운영 DB, 운영 Sync, Vercel, GitHub Secret은 건드리지 않았다. 검증은 모두 로컬의 일회용 PostgreSQL과 가짜 GitHub API로 했다.

## 0. 요약

| 과제 | 상태 | 핵심 |
|---|---|---|
| A. R27 운영 DB 접근 방지 | DONE | 테스트는 `TEST_DATABASE_URL`만 읽고, loopback·55432·`agentdock_test` 허용 목록을 통과해야 시작한다. 진입점 세 곳(vitest 메인, 각 worker, `bun test`)과 env 파싱, DB 스크립트에 모두 적용했다 |
| B. R26 CI PostgreSQL 통합 테스트 | DONE · 원격 미실행 | `ci.yml`에 `database` job(postgres:17 service, pg_trgm, 실제 migration, `REQUIRE_TEST_DATABASE`)을 추가했다. 로컬에서 같은 절차로 검증했다 |
| C. R1 잔여 refresh 정체 | DONE · 운영 미적용 | `repository.checked_at`·`check_failures`(migration 0008, additive)를 추가하고, refresh는 `coalesce(checked_at, scanned_at)` 순서로 정렬하며 실패가 이어질수록 backoff한다 |
| D. Sync 실패·재시도 | DONE | 429는 항상 rate limit으로 본다. HTTP-date 형식의 `retry-after`를 처리한다. rate limit을 받으면 drain을 멈춘다. shard가 3회 연속 실패하면 버린다. probe 실패는 topic을 멈추지 않는다. fan-out, refresh, drain도 stage로 격리한다 |
| E. 운영 관측성 | DONE | summary에 재시도, delist, 실패 중인 저장소, 남은 queue, drain 정지 사유를 추가했다. `schema_meta`의 `sync:last_attempt`는 실패한 실행도 기록한다 |

## 1. 변경 전 문제와 원인

### A. 테스트가 실제 DB에 닿을 수 있었다

- `vitest.config.ts`가 CI가 아닐 때 `process.loadEnvFile('.env')`를 실행했다. 그래서 셸에 `DATABASE_URL`이 없어도 `.env`의 운영 URL이 테스트로 들어갔다.
- Bun으로 실행하는 스크립트(`bun scripts/*.mjs`, `bun test`, `bunx --bun vitest`의 worker)는 시작할 때 `.env`를 스스로 읽는다. 측정 결과는 다음과 같다(2026-10-21).
  - `bun run <script>`는 Node 자식 프로세스에 `.env`를 넘기지 않는다.
  - Bun 자식 프로세스는 `.env`를 넘겨받는다.
- `db:test:migrate`와 `db:test:reset`은 `.env`의 `DATABASE_URL`을 그대로 썼다. 그래서 운영 DB의 `agentdock_test`가 대상이 될 수 있었다.
- README에는 "맨 `bun test`는 이 파일들에서 멈춘다"고 적혀 있었다. 실제로는 실행된다(`bun test src/ingest/retry.test.ts`가 31 pass).

**사고 기록**

| 일자 | 경로 | 결과 |
|---|---|---|
| 2026-10-21 (Phase 2 리뷰) | 리뷰 subagent가 `bunx vitest run`을 실행했고, config가 `.env`를 읽었다 | `.env` DB의 `agentdock_test`에 접속했다. 테이블이 없어 INSERT가 실패했고 쓰기는 없었다 |
| 2026-10-21 (Phase 3 검증 중) | 수정 1차 버전을 `bunx --bun vitest`로 검증했다. config(메인 프로세스)만 `DATABASE_URL`을 지웠고, Bun worker는 시작할 때 `.env`를 다시 읽었다 | `client.test.ts`의 "잘못된 비밀번호" 테스트가 `.env` 호스트(Neon으로 판정)에 **일부러 틀린 비밀번호로 접속을 시도**해 인증이 거부됐다. 다른 두 테스트는 env 가드에 막혀 접속하지 못했다. 데이터 읽기·쓰기는 없었다. 이 경로는 worker마다 격리를 다시 적용하는 `setupFiles`로 막았다 |

### B. CI가 DB suite를 하나도 돌리지 않았다

- `ci.yml`에는 데이터베이스가 없었다. `DATABASE_URL`이 없으면 DB suite 296개가 skip됐다.
- 검토된 `drizzle/` migration과 `schema.ts`가 같은 구조를 만드는지는 아무도 비교하지 않았다. 0007의 snapshot이 실제 SQL과 달랐던 사실도 이번에 drizzle-kit이 trgm index를 DROP/CREATE하려 하면서 드러났다.

### C. 실패하는 저장소가 refresh 맨 앞을 차지했다

- refresh는 `scanned_at asc nulls first` 순서로 정렬한다. `scanned_at`은 실제로 읽었을 때만 갱신되고 UI에는 "read on"으로 표시된다.
- 그래서 이미 저장된 저장소가 404(삭제·비공개), too_large, 409(빈 저장소, `unavailable`), 재시도 소진 상태가 되면 가장 오래된 `scanned_at`을 유지한 채 매 실행 refresh slot을 차지했다.
- 이런 저장소가 상한(토큰 없음 25, 토큰 있음 100) 이상 쌓이면 다른 저장소는 영영 재확인되지 않는다.

### D. Sync

- 429에 `retry-after`가 없고 quota가 남아 있으면 `unavailable`로 처리됐다. 그러면 job 재시도 3회를 다 쓴 뒤 실패로 끝났다.
- `retry-after`가 HTTP-date 형식이면 NaN이 되어 primary reset으로 fallback했다.
- secondary limit은 core 잔량을 줄이지 않는다. 그래서 drain이 job마다 요청을 하나씩 써서 같은 벽에 부딪혔다.
- 매번 실패하는 shard가 있으면 그 topic은 영구적으로 정체됐다. below-floor probe가 실패해도 topic 전체가 실패했다.
- fan-out, refresh, drain에서 DB 오류가 나면 summary 없이 종료됐다.
- annotation 메시지를 escape하지 않아서, 줄바꿈이 들어간 메시지가 workflow command를 끊을 수 있었다.

### E. 관측성

- `sync:last_success`는 실패한 실행에서는 기록되지 않는다. 그래서 "실패가 이어지는 중"인지 "실행 자체가 없는 중"인지 구분할 수 없었다.

## 2. 변경된 구조

### A. 테스트 DB 격리 (`src/db/testDatabase.ts`)

```
              TEST_DATABASE_URL ─▶ testDatabaseRejection() ─ null ─▶ DATABASE_URL (test only)
.env / shell DATABASE_URL ──X (always deleted)                └ reason ─▶ throw (URL never quoted)

진입점                              적용
vitest 메인 (vitest.config.ts)      isolateTestEnvironment: worker를 띄우기 전에 실패
vitest 각 worker (setupFiles)       같은 함수: Bun worker가 .env를 다시 읽어도 지움
bun test (bunfig.toml preload)      같은 함수
env.ts parseEnv                     DATABASE_SCHEMA=agentdock_test면 같은 허용 목록 (2차 방어)
scripts/migrate.mjs                 agentdock_test 또는 --test-database면 TEST_DATABASE_URL만
scripts/test-reset.mjs              TEST_DATABASE_URL만
```

허용 조건(전부 정확히 일치해야 함):
- 호스트: `127.0.0.1`, `localhost`, `[::1]` 중 하나이고 호스트는 하나만
- 포트: `55432`
- DB: `agentdock_test`
- query string 없음

추가 규칙:
- Neon 호스트(`neon.tech`, `.neon.`)는 그 이름을 짚어 거부한다.
- postgres.js가 multi-host로 해석할 수 있는 쉼표(인코딩된 것 포함)는 거부한다.
- `?search_path=` 같은 query string은 startup parameter로 전달되므로 거부한다.
- 오류 메시지에는 URL, 호스트, 비밀번호를 넣지 않는다(테스트로 확인).

`REQUIRE_TEST_DATABASE=1`이면 URL이 없을 때 skip 대신 실패한다(CI용).

### B. CI `database` job (`.github/workflows/ci.yml`)

1. postgres:17 service를 띄운다. 설정은 `POSTGRES_DB=agentdock_test`, `POSTGRES_HOST_AUTH_METHOD=trust`, 포트 `55432:5432`, health check다. job이 끝나면 컨테이너는 자동으로 제거된다.
2. `bun run db:test:bootstrap`을 실행한다. 이 명령은 `scripts/sql/bootstrap-test-database.sql`을 돌린다. 이 파일은 배포용 bootstrap(role과 schema 2개)을 `\ir`로 불러온 뒤 `CREATE EXTENSION pg_trgm SCHEMA public`을 실행한다.
3. `bun run db:test:setup`으로 `schema.ts`에서 `agentdock_test`를 만든다.
4. `bun run db:test:migrations`로 검토된 `drizzle/`를 `agentdock`에 적용한다.
5. `REQUIRE_TEST_DATABASE=1`로 `bun run test`를 실행한다. `src/db/migrations.test.ts`가 두 schema의 column, index, constraint를 비교한다.

- 권한: workflow 최상위에 `permissions: contents: read`를 둔다. checkout은 `persist-credentials: false`로 한다.
- secret을 하나도 쓰지 않는다. URL은 비밀번호 없는 리터럴이다.
- 기존 `check` job(빌드 + `bun run ci`, DB 없음)은 그대로 둔다.

### C. Refresh 재확인 (`src/corpus/refresh.ts`, `src/db/queries/jobs.ts`, `src/ingest/persist.ts`)

| 상황 | job | `scanned_at` | `checked_at` | `check_failures` | artifact |
|---|---|---|---|---|---|
| 정상 읽기(ok, unchanged, 비어서 delist) | succeeded | 현재 시각 | = scanned_at | 0 | 갱신 |
| 404 / 비공개 (unreadable) | failed, 1회 | 유지 | 현재 시각 | +1 | 유지 |
| too_large | failed, 1회 | 유지 | 현재 시각 | +1 | 유지 |
| 5xx, quota가 남은 403, 409, 네트워크 (unavailable) | 1·2·4분 backoff 뒤 재시도, 3회 후 failed | 유지 | 3회 실패 시 현재 시각 | 3회 실패 시 +1 | 유지 |
| storage_failed | unavailable과 같음 | 유지 | 위와 같음 | 위와 같음 | 유지 |
| rate limit (primary, secondary, 429) | reset 시각(최대 1시간)으로 연기, attempt 환불, drain 정지 | 유지 | **유지** | **유지** | 유지 |

정렬과 대상 선정:
- 정렬: `coalesce(checked_at, scanned_at) asc nulls first, id`
- 대상: `coalesce(...) < now − stale × 2^min(check_failures, 4)`. 12시간 기준으로 실패 0·1·2·3·4회 이상일 때 대기는 12·24·48·96·192시간(8일)이다.
- 실패가 없는 저장소는 이전과 정확히 같은 조건(`scanned_at < cutoff`)이다.
- 0008 이전 행(`checked_at` null)은 `scanned_at`으로 fallback하므로 backfill이 필요 없다.
- 404 저장소는 delist하지 않는다. artifact는 계속 보이고, 다시 읽히면 연속 실패가 0으로 돌아간다.

### D. Sync 재시도 정책

| 대상 | 정책 |
|---|---|
| core 요청 | 429는 항상 rate limit이다. `retry-after`는 초 또는 HTTP-date로 읽는다. 헤더 없는 secondary limit(quota 남음)은 60초로 둔다. primary 소진은 헤더의 reset을 쓴다 |
| drain | job을 꺼내기 전에 core 잔량이 2 미만이거나 35분이 지났으면 멈춘다(기존). 이번에 rate_limited job이 하나라도 나오면 즉시 멈추도록 추가했다. 이 세 경우는 모두 exit 0과 `::warning`이다 |
| topic shard | 실패하면 stack에 되돌리고 연속 실패를 +1 한다. 3회째(`CORPUS_CAPS.maxShardFailures`)에는 버리고 그 query를 INCOMPLETE와 `::error`에 출력한다. rate limit은 실패로 세지 않는다. 다음 full pass에서 다시 요청한다 |
| below-floor probe | 실패해도 topic은 계속한다. "측정 못 함"을 INCOMPLETE로 출력한다. rate limit은 그대로 sweep을 멈춘다 |
| stage | registry, seeds, links, search, **fan-out, refresh, drain**이 각각 격리된다. 실패는 exit 1이고 last_success를 기록하지 않지만, 나머지 stage와 summary는 실행된다 |
| cursor 형식 | `{topic: {stack, failures}}`. 이전 형식(배열)도 그대로 읽는다 |
| 로그 | annotation은 `%`, CR, LF를 escape하고 title은 `:`와 `,`까지 escape한다. stage 오류는 message만 출력한다 |

### E. 관측성

summary에 추가한 줄:
- `of which retry next run`
- `Artifacts delisted`
- `Stored repos failing checks` (drain 전에 측정)
- `Jobs still queued`
- `Drain stopped by`

refresh 로그에는 `failing-checks=`, topic 로그에는 `consecutive-failures=`를 붙였다.

`schema_meta`의 `sync:last_attempt`(scheduled 실행마다 기록)는 JSON이다. 필드는 `startedAt`, `ok`, `failedStages`, `durationSeconds`, `processed`, `ingested`, `unchanged`, `unreadable`, `rateLimited`, `retriesScheduled`, `delisted`, `enqueued`, `failingChecks`, `queued`, `drainStoppedBy`, `coreSpent`, `authenticated`다. 메시지 텍스트는 넣지 않는다. migration은 필요 없다.

## 3. 주요 코드 변경

| 파일 | 변경 |
|---|---|
| `src/db/testDatabase.ts` (신규) | 허용 목록, `testDatabaseRejection`, `assertTestDatabaseUrl`, `isolateTestEnvironment` |
| `src/db/testPreload.ts`, `bunfig.toml` (신규) | worker와 `bun test`의 격리 진입점 |
| `vitest.config.ts` | `.env` 로드를 제거하고 격리와 `setupFiles`를 추가 |
| `src/env.ts` | `agentdock_test` schema에 허용 목록 refine 추가 |
| `scripts/migrate.mjs`, `scripts/test-reset.mjs` | `TEST_DATABASE_URL` 전용 경로 |
| `scripts/sql/bootstrap-test-database.sql` (신규), `package.json` | `db:test:bootstrap`, `db:test:migrations` |
| `.github/workflows/ci.yml` | `permissions`와 `database` job |
| `src/db/schema.ts`, `drizzle/0008_overjoyed_talos.sql`, `drizzle/meta/*` | `checked_at`, `check_failures` |
| `src/ingest/persist.ts` | 읽기에 성공하면 `checked_at = scanned_at`, `check_failures = 0` |
| `src/db/queries/jobs.ts` | `finishJob(failed)`에서 저장된 저장소의 check를 기록 |
| `src/corpus/refresh.ts`, `src/corpus/caps.ts` | backoff 정렬, `failingChecks`, `maxCheckBackoffDoublings`, `maxShardFailures` |
| `src/github/client.ts` | 429 처리와 HTTP-date 형식 `retry-after` |
| `src/corpus/search.ts` | shard 연속 실패 처리와 probe 비치명화 |
| `src/ingest/worker.ts` | `runJob`이 `{ outcome, removed, retryScheduled }`를 반환 |
| `src/db/queries/syncState.ts` | `recordSyncAttempt`, `lastSyncAttempt` |
| `scripts/corpus-sync.mjs` | stage 확장, rate limit 시 drain 정지, cursor, escape, summary, `sync:last_attempt` |

## 4. DB Migration 0008 상세

```sql
ALTER TABLE "agentdock"."repository" ADD COLUMN "checked_at" timestamp with time zone;
ALTER TABLE "agentdock"."repository" ADD COLUMN "check_failures" integer DEFAULT 0 NOT NULL;
```

- 두 문장 모두 PostgreSQL 11 이상에서 catalog만 바꾼다. 테이블을 다시 쓰지 않고 lock도 짧다.
- backfill은 필요 없다. 정렬이 `coalesce`로 fallback한다.
- index는 추가하지 않았다. 지금은 수천 행이라 순차 스캔이 몇 밀리초다. `ponytail:` 주석에 10^5행일 때 expression index를 추가하라고 적어 두었다.
- drizzle-kit이 함께 생성한 `package_fuzzy_trgm_idx`의 DROP/CREATE는 제거했다. 0007 snapshot이 오래된 표기였을 뿐이다. 이후 `generate`를 다시 돌리면 "No schema changes"가 나온다.
- 로컬 테스트 DB에서 실제 0000–0008을 적용했고, `migrations.test.ts`에서 `schema.ts`와 일치함을 확인했다.

**Rollback** (0008만 되돌릴 때, 수동):

```sql
ALTER TABLE "agentdock"."repository" DROP COLUMN "check_failures";
ALTER TABLE "agentdock"."repository" DROP COLUMN "checked_at";
DELETE FROM "agentdock"."__drizzle_migrations" WHERE created_at = <meta/_journal.json의 0008 "when">;
```

column을 남겨 둔 채 코드만 되돌려도 문제가 없다(additive). 반대로 **column을 지운 채 새 코드를 돌리면 웹과 sync가 모두 실패**한다.

## 5. 테스트 DB 준비 (로컬)

```bash
# 실행 위치: ~/workspace_auto/agentdock
docker run -d --name agentdock-testdb -e POSTGRES_DB=agentdock_test \
  -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:55432:5432 postgres:17
export TEST_DATABASE_URL=postgres://agentdock_app@127.0.0.1:55432/agentdock_test
bun run db:test:bootstrap
bun run db:test:setup
bun run db:test:migrations
bun run test                      # REQUIRE_TEST_DATABASE=1을 붙이면 CI와 같다
# 정리: docker rm -f agentdock-testdb
```

## 6. 운영 반영 절차 (순서가 중요하다)

실행용 명령과 검증 SQL, 중단 조건, 롤백 절차는 [배포 Runbook](agentdock-phase3-deployment-runbook.md)에 있다. 이 절은 요약이다.

1. **push 전에** 운영자 PC에서 Neon direct URL로 0008을 적용한다. 명령은 `DATABASE_SCHEMA=agentdock bun run db:migrate`이다(VERCEL_DEPLOY.md Step 4). 순서가 중요한 이유는 다음과 같다.
   - sync.yml은 develop에 push되는 즉시 다음 예약 실행부터 새 코드를 쓴다.
   - Vercel도 push하면 바로 배포된다.
   - 새 코드는 `checked_at`을 조회하고 기록한다.
2. 적용 결과를 읽기 전용으로 확인한다.
   - `SELECT column_name FROM information_schema.columns WHERE table_schema='agentdock' AND table_name='repository' AND column_name IN ('checked_at','check_failures')`의 결과가 2행이어야 한다.
3. push한 뒤 GitHub Actions의 CI 두 job이 green인지 확인한다. 특히 `database` job이 원격에서 처음 실행되는 것이다.
4. 첫 예약 sync에서 다음을 확인한다.
   - `::notice`와 summary의 새 줄들
   - `failing-checks=`
   - `Drain stopped by`
   - `schema_meta`의 `sync:last_attempt`
5. Vercel 배포가 끝나면 홈, 검색, 저장소 페이지가 정상인지 본다.

## 7. Rollback

| 대상 | 방법 |
|---|---|
| 코드 전체 | commit을 revert한다. 0008 column은 남아도 이전 코드에 영향이 없다 |
| 0008 | 4절의 SQL. 코드를 먼저 되돌린 뒤에만 한다 |
| topic cursor | 새 형식 `{stack, failures}`는 이전 코드가 읽지 못한다. 이전 코드의 `validResume`이 버리고 top부터 다시 시작한다(과다 수집만 생기고 누락은 없음). 필요하면 `schema_meta`의 `corpus_sweep:topic-search` 키를 수동으로 삭제한다 |
| `sync:last_attempt` | 이전 코드는 이 키를 읽지 않는다. 남아 있어도 무해하다 |
| CI `database` job | job 블록을 삭제한다 |

## 8. 검증 결과 (로컬, 2026-10-21)

| 항목 | 결과 |
|---|---|
| `check:boundaries` | OK (9 migration, 89 source, 26 UI) |
| `lint` | Checked 196 files, No fixes applied |
| `typecheck` | exit 0 |
| test (DB, `REQUIRE_TEST_DATABASE=1`) | 66 files passed, 1 skipped / **1211 passed, 3 skipped** |
| test (CI 모드, DB 없음) | 904 passed, 310 skipped |
| 회귀 확인(수정 제거 변형) | refresh 4, worker 4, persist 2, client 2, sweep 2건 FAIL → 원복 후 PASS |
| drift 테스트 | `agentdock.repository`에 column을 주입하면 FAIL, 제거하면 PASS |
| 격리 시나리오 | `bunx vitest`, `bunx --bun vitest`, `bun test`, 잘못된 포트·호스트·DB·Neon·URL 아님·REQUIRE 누락, migrate·test-reset·client import 모두 거부 또는 skip. 출력에 비밀번호 0건 |
| sync E2E(가짜 API) | run5 기준 실행, run6 저장소 404, run7 backoff와 secondary limit, run8 shard 3회 연속 실패 |
| `next build`, `VERCEL=1 next build` | 둘 다 exit 0, `next-env.d.ts` 변화 없음 |
| `docker build` | exit 0 |
| actionlint 1.7.7 | `ci.yml`, `sync.yml` 지적 0건 |

skip 3건:
- pg_trgm이 없는 런타임 케이스(기존)
- trust DB에서 비밀번호 거부(pg_hba 성질이라 비밀번호가 있는 URL일 때만 실행)
- live permalink(`CI=1`)

## 9. 잔여 이슈

- 원격 CI `database` job은 아직 실행되지 않았다(push 후 확인). ubuntu-latest에 `psql`이 있다고 가정했다.
- 운영 DB에 0008은 미적용이다. 6절의 순서를 지켜야 한다.
- 장기간 404인 저장소는 계속 listed 상태다(8일 간격으로 재확인). 일정 기간 후 delist할지는 정책 결정이 필요하다.
- 개별 raw 404로 생기는 R6 부분 읽기 반복은 그대로다(`ponytail:`).
- fan-out, refresh, drain의 stage 격리는 E2E로 DB 오류를 주입해 보지 않았다(코드 확인만 함).
- `bunx --bun vitest`가 아닌 다른 방식으로 vitest를 Bun 런타임에 올리는 경로도 setupFiles가 막는다. 하지만 vitest config를 읽지 않는 임의의 스크립트가 `src/db/client.ts`를 `agentdock`(기본) schema로 import하는 경우는 테스트 가드 대상이 아니다. 그 경우는 운영 도구와 경로가 같다.
- `scripts/dev-reset.mjs`, `scripts/corpus-reset.mjs`는 `.env`의 `agentdock`을 대상으로 하는 운영 도구다. 그대로 두었고, 각각 `--confirm`, 환경변수, `--confirm` 이중 게이트가 있다.
