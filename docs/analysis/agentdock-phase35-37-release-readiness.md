# AgentDock Phase 35–37 — Production Connection Isolation · Sync Release Readiness · Recovery Planning

- 작성: 2026-10-26 (KST), 기준 commit `5bf8450`(HEAD = origin/develop)
- 선행 보고서: `agentdock-phase29-31-production-final-verification.md`, `agentdock-phase32-34-sync-reliability.md`
- 표기: **FACT**는 실행·로그로 확인한 것, **INFERENCE**는 근거에서 추론한 것, **PENDING**은 운영 확인이 필요한 것, **NOT RUN**은 실행하지 못한 것이다.
- 운영 DB 접속, 운영 secret·변수 조회 및 변경, 운영 migration·수동 Sync, commit·push·deploy는 하지 않았다. 운영에 대해서는 GitHub run·secret·변수의 메타데이터(이름, 갱신 시각)와 production HTTP 헤더만 읽기 전용으로 확인했다.

## 1. 핵심 결론

1. **Phase 32–34 코드는 이미 push·배포되었지만 secret은 바뀌지 않았다 (FACT).**
   - commit `5bf8450`은 01:31Z에 push되었다. CI 40254672357과 Deploy 40254796355는 success이고, production 헤더 `X-AgentDock-Commit`도 `5bf8450`이다.
   - Actions secret `DATABASE_URL`의 마지막 갱신은 `2026-10-22T05:28:37Z`다.
   - 따라서 다음 예약 Sync는 새 사전 검사(guard)를 현재 secret으로 실행한다.
   - 그 secret이 `agentdock_app`이 아니라는 것은 같은 secret을 쓴 ops 검사가 6회 연속 `FAIL connected as agentdock_app`을 낸 것으로 확인됐다(FACT). 그러므로 그 run은 **exit 1로 멈추고, 수집과 DB 쓰기는 0건**이다(INFERENCE, §9의 시나리오 B·B′로 로컬 재현).
   - cron은 06:00/18:00 UTC다. 최근 실제 시작은 06:00 cron이 09:56–10:38Z, 18:00 cron이 19:55–20:44Z였다.
   - **secret을 교체하기 전까지 모든 예약 Sync가 FAILED가 된다.** 데이터는 손상되지 않지만 corpus 갱신은 멈춘다.
2. **운영의 FAIL 6개는 "role 불일치 + startup parameter 미전달"이 겹친 결과다. 로컬에서 같은 패턴을 그대로 재현했다 (FACT, 로컬).**
   - Neon proxy가 forward한다고 알려진 `user`, `database`, `options`, `application_name`만 남기는 로컬 proxy를 만들었다.
   - 이 proxy를 거쳐 superuser로 ops preflight를 돌리면 운영과 같은 6개가 FAIL하고 pool 10/10만 PASS한다.
3. **해결: ops 연결의 세션 설정을 `options=-c …`로 옮겼다 (구현 완료, 로컬 검증).**
   - 같은 proxy를 거친 `agentdock_app` preflight가 FAIL 3개(+쓰기 수락)에서 7/7 PASS로 바뀐다.
   - Neon이 `options`를 실제로 forward하는지는 운영자의 preflight 실행으로만 확정된다(PENDING). 다만 이 검사는 모든 연결에서 결과를 다시 확인하므로, `options`까지 버려지더라도 실패 쪽으로 닫힌다.
4. **Sync guard는 role과 search_path만 요구하며, startup parameter에 의존하지 않는다 (FACT, 로컬).**
   - `agentdock_app`은 bootstrap의 `ALTER ROLE agentdock_app SET search_path = agentdock`로 role 기본값을 갖는다.
   - 그래서 parameter가 버려져도 guard가 통과한다(시나리오 A′, C′). secret만 바르면 Sync는 재개된다.
5. **새로 발견한 배포 차단 요인 (FACT, 코드).**
   - `targetFingerprint`는 `user@host:port/db`의 hash다. secret을 `agentdock_app`으로 바꾸면 fingerprint가 달라진다.
   - `AGENTDOCK_TARGET_FINGERPRINT`를 함께 갱신하지 않으면 Deploy가 plan 단계에서 멈춘다. Phase 32–34 절차에는 이 내용이 없었다. 이번에 `VERCEL_DEPLOY.md` Step 6에 추가했다.
6. **job 771은 Phase 32–34 수정으로 고쳐지지 않았다 (FACT, 로컬 재현).**
   - 수정된 코드로 로컬 재수집을 했지만 다시 `storage_failed 22021`이 났다.
   - 원인은 YAML 큰따옴표 문자열의 escape `\0`이다(`skills/hunt-file-upload/SKILL.md` description). js-yaml이 parse 단계에서 U+0000을 새로 만든다.
   - `parseFrontmatter`와 `parseJsonManifest`에서 escape된 NUL을 U+FFFD로 바꾸도록 고쳤다.
   - 이후 두 job 모두 로컬 재수집에 성공했다(bughunter ok 99/99, codepro ok 9). 다시 실행해도 `unchanged`이고 중복은 없다.
7. **Refresh 상한은 100으로 유지한다.**
   - 로그 재생 시뮬레이션에서 150으로 올려도 p95 기준 최장 run은 1,718s로, drain 마감 2,100s까지 382s가 남는다.
   - 다만 새 운영 run이 0회이고 secret 교체 직후라서, 2회 정상 run 뒤로 미룬다.

## 2. Phase별 판정

| Phase | 판정 | 근거 |
|---|---|---|
| 35 연결 정합성 | **CONDITIONAL** | 원인 분리와 해결(`options`)을 로컬에서 재현·검증했다. guard 계약을 로컬에서 증명했다. 운영 Neon의 `options` 전달은 PENDING이다. |
| 36 배포 준비 | **CONDITIONAL** | 절차·실패 대응·검증 계획을 완성했다. 단, 전제("secret 교체 뒤 push")가 이미 깨졌으므로 **secret 교체가 긴급**이다. |
| 37 복구·Refresh | **CONDITIONAL** | 771·978의 원인을 완전히 수정하고 로컬 복구를 재현했으며 runbook을 작성했다. 운영 재enqueue는 승인 대기다. Refresh는 실측 근거에 따라 보류한다. |

## 3. Git HEAD/Status

- 시작 시점 (FACT): HEAD = origin/develop = `5bf845050d5d…`, working tree는 clean이었다. 최근 commit은 `5bf8450` fix(sync), `efa7611` docs, `0f2cb82` perf다.
- `5bf8450`은 Phase 32–34 변경 12개 파일을 그대로 담고 있다(`git show --stat`). 보존할 미커밋 변경은 없었다.
- 운영 상태 (FACT):
  - CI 40254672357 success
  - Deploy 40254796355 success: gate, plan, migrate, verify, vercel, smoke 모두 success
  - production `X-AgentDock-Commit: 5bf8450…`
  - 마지막 Sync는 40229151309(`0f2cb82`)이며, 그 뒤 실행된 Sync는 없다.

## 4. 기존 Phase 32–34 변경 검토

| 변경 | 검토 결과 |
|---|---|
| guard (`corpus-sync.mjs`의 `assertSchemaIsolation`) | 첫 stage 전과 `recordSyncAttempt` 전에 실행된다. 이번 시나리오 10개를 다시 돌려 확인했다(§9). 중복 구현이 없다: web(`instrumentation.ts`)과 같은 함수를 쓴다. |
| `AGENTDOCK_ROLE` | 정의는 `schema.ts` 한 곳뿐이다. `client.ts`와 `ops.mjs`가 import한다. `migrate.mjs`는 role을 검사하지 않는다(의도된 것으로, migration은 fingerprint로 대상을 고정한다). |
| NUL (`fetchRawFile`) | 원문의 literal NUL만 처리한다. **parser가 escape에서 NUL을 만드는 경로가 누락되어 있었다** → §14에서 수정했다. |
| `errorCode` 로깅 | 재현 run에서 `"errorCode":"22021"`이 실제로 출력되어 원인 추적에 쓰였다(FACT). 메시지는 남지 않는다. |
| `VERCEL_DEPLOY.md` | secret 교체 시 fingerprint를 갱신해야 한다는 내용이 누락되어 있었다 → 추가했다. |

## 5. Sync/Deploy/Web DB 연결 경로

| 경로 | URL 출처 | client | search_path | read-only / timeout | role 검사 |
|---|---|---|---|---|---|
| Sync | Actions secret `DATABASE_URL` → `sync.yml` `bun run sync` | `src/db/client.ts` (`postgres`, max 10, idle 20s) | startup parameter `connection.search_path` + role 기본값 | 없음(쓰기 프로세스) | `assertSchemaIsolation(sql)` (`corpus-sync.mjs:151`) |
| Sync 사전 plan | 같은 secret → `migrate.mjs --plan --require-current` | `migrate.mjs:114` (max 1) | startup parameter | 없음 | 없음 |
| Sync health summary | 같은 secret → `ops:status` | `readOnlyTarget()`이 URL을 바꾼 뒤 `client.ts` | role 기본값(검사만 함) | **`options=-c …`**(이번 변경, 이전에는 개별 startup parameter) | `readOnlyChecks` |
| Deploy | 같은 secret → `migrate.mjs --plan/--production/--require-current` | `migrate.mjs` | startup parameter | 없음 | `productionTargetRejection`: loopback·pooled 거부, **fingerprint(`user@host:port/db`)** 일치 |
| Web | Vercel 환경변수 `DATABASE_URL`(Actions secret과 별개) | `client.ts` | startup parameter + role 기본값 | 없음 | `register()` → `assertSchemaIsolation()` (`instrumentation.ts:23`) |

- Direct와 pooled는 `-pooler` 호스트 이름으로 구분한다. `readOnlyTarget`과 `productionTargetRejection`은 pooled를 거부한다. Sync guard는 pooled 여부를 보지 않고 결과(role, search_path)만 본다.
- 연결 생성과 재사용: Sync는 process당 pool 하나다. guard는 첫 연결에서 한 번 검사한다. role과 search_path는 같은 URL로 여는 모든 연결이 같은 값을 가진다(role 기본값과 URL은 연결마다 같다).
- web이 운영에서 정상이라는 것(FACT: 200, boot 성공)은 Vercel URL이 `agentdock_app`으로 접속하고 search_path가 맞다는 뜻이다. 그러므로 운영 `agentdock_app`에는 role 기본값이 있거나 startup parameter가 전달되고 있다(INFERENCE).

## 6. DB Role 검증

- 운영 (FACT): Sync 6회(10/23–10/25) 모두 같은 secret에서 `FAIL connected as agentdock_app`이었다. `current_user`는 URL의 사용자이고 startup parameter와 무관하므로, **secret role ≠ `agentdock_app`**이다.
- 로컬 (FACT): `ops-matrix.txt`

| 연결 | role | 결과 |
|---|---|---|
| direct | agentdock_app | 7/7 PASS |
| direct | postgres | role만 FAIL |
| parameter를 버리는 proxy | agentdock_app | read-only 2, timeout, 쓰기 수락 FAIL. role과 search_path는 PASS |
| parameter를 버리는 proxy | postgres | **6 FAIL, pool PASS = 운영과 동일** |

## 7. Startup Parameter 분석

- **외부 문서 (참고):**
  - neondatabase/neon#1287: proxy가 `options`, `application_name`, `replication`만 forward하도록 고쳐졌다는 오래된 기록이다.
  - Neon connection pooling 문서: transaction mode에서는 `SET`/`RESET`을 지원하지 않고 연결은 transaction마다 pool로 돌아간다. search_path는 `ALTER ROLE … SET search_path`를 권장한다.
  - Neon 공식 문서에서 direct endpoint가 `options -c`를 지원한다는 명시는 찾지 못했다.
- **로컬 재현 (FACT):** proxy 로그 `forwarded=[user,database,application_name] dropped=[client_encoding,search_path,default_transaction_read_only,statement_timeout]`이다. `options`를 쓰면 `forwarded=[…,options]`이고 설정이 서버에 적용된다(`ops-options-manual.txt`).
- **검토한 대안:**
  - 연결 직후 `SET`: postgres.js에는 연결별 init hook이 없다. 결과 검사보다 먼저 쓰기 가능한 상태가 생기고, pooled에서는 transaction이 끝나면 사라진다. **채택하지 않았다.**
  - `SET LOCAL`: transaction마다 선언해야 하고 ops 쿼리 전체를 감싸야 한다. 불필요하다.
  - role 기본값(`ALTER ROLE agentdock_app SET default_transaction_read_only`): web과 Sync는 같은 role로 써야 하므로 불가능하다. 운영 변경도 금지다.
  - **`options=-c …` (채택):** PostgreSQL 표준 startup parameter이고 연결마다 전달된다. direct PostgreSQL에서도 개별 parameter와 같은 효과를 낸다(로컬 direct 7/7 PASS). 이미 URL에 있는 `options`(예: Neon `endpoint=`)는 앞에 남기고 뒤에 덧붙인다. 개별 parameter는 `options` 뒤에 적용되어 이기므로 URL에서 제거한다.
- **안전성:**
  - 결과는 매 연결 `readOnlyChecks`가 다시 확인한다. pool을 가득 채워 연결마다 검사하므로 race는 없다.
  - Neon이 `options`도 버리면 7개 중 FAIL이 남고 exit 2로 아무것도 읽지 않는다.
  - DB role 기본값과 충돌하지 않는다: startup parameter가 role 기본값보다 우선한다(PostgreSQL 규칙).
- **판정:** 문제는 로컬에서 재현했고 해결도 검증했다. **운영 Neon에서의 효과는 PENDING**이며, §11 step 2의 preflight로 확정한다.

## 8. Direct/Pooled 연결 검증

| 항목 | 결과 |
|---|---|
| `readOnlyTarget`의 pooled 거부 | unit test PASS (`-pooler`, 대문자 포함) |
| Deploy의 pooled 거부 | `productionTargetRejection` (기존 테스트) |
| Sync guard on pooled | **NOT RUN**: 로컬에 PgBouncer가 없다. guard는 결과만 검사하므로, pooled에서 search_path parameter가 버려져도 role 기본값으로 통과하고 role이 틀리면 거부된다(INFERENCE, proxy 시나리오 A′·B′ 근거). |
| transaction pooling의 `SET` 위험 | `SET`을 쓰지 않으므로 해당 없다. |

## 9. 최종 Sync Guard 계약

**수집 시작 조건:** 연결 성공, `current_user = agentdock_app`, `search_path`가 정확히 `agentdock`(test는 `agentdock_test`). 셋 중 하나라도 어긋나면 `recordSyncAttempt`를 포함해 아무것도 하지 않고 exit 1이다.

read-only와 statement_timeout은 **Sync 조건이 아니다.** Sync는 쓰는 프로세스이고 timeout은 ops 전용이다. 이 둘은 health summary(ops) 계약이며, ops는 실패해도 `continue-on-error`라 Sync 결과를 바꾸지 않는다.

로컬 검증 (`guard-matrix.txt`). 비밀번호 `hunter2-secret-pw`, 호스트, `user@`가 들어간 출력 줄을 grep했다.

| # | 상황 | exit | Sync 시작 | DB 변경 | 비밀 출력 | 메시지 |
|---|---|---|---|---|---|---|
| A | 올바른 role, direct | 0 | 예 | (정상 쓰기) | 0 | — |
| A′ | 올바른 role, parameter 버림(F) | 0 | 예 | 없음(멱등) | 0 | role 기본값으로 통과 |
| B | 잘못된 role, direct | 1 | 아니오 | 없음 | 0 | `connected as a role other than "agentdock_app"` |
| B′ | 잘못된 role, parameter 버림 | 1 | 아니오 | 없음 | 0 | 같음 (**운영 다음 run의 예상 결과**) |
| C | search_path=public, direct | 1 | 아니오 | 없음 | 0 | `search_path is "public"` |
| C′ | search_path=public, parameter 버림 | 0 | 예 | 없음 | 0 | 버려진 URL 값 대신 서버 실제 값(role 기본값)을 검사 |
| C″ | `options -c search_path=public`, proxy | 1 | 아니오 | 없음 | 0 | 전달된 값은 거부 |
| D/E | read-only·timeout 누락 | — | (Sync 조건 아님) | — | — | ops에서 FAIL (§6 표, 기존 테스트) |
| G | direct 연결 실패 | 1 | 아니오 | 없음 | 0 | `error code ECONNREFUSED` |
| H | pooled | NOT RUN | | | | §8 |
| I | 인증 실패(없는 role) | 1 | 아니오 | 없음 | 0 | `error code 28000` |
| I′ | 틀린 비밀번호(28P01) | NOT RUN | | | | 로컬 DB가 trust 인증이다. 같은 코드 분기(코드만 출력)를 탄다. |
| J | 해석 불가 호스트(비밀번호 포함) | 1 | 아니오 | 없음 | 0 | `error code ENOTFOUND` |

DB 변경 여부는 `schema_meta` 전체 md5와 `repo_seed`, `ingest_job`, `repository` 행 수를 실행 전후로 비교해 판정했다.

## 10. 배포 순서

현재 상태(코드 push 완료, secret 미교체)를 전제로 다시 정했다.

| # | 단계 | 주체 | 사전 조건 | 성공 기준 | 중단 조건 | rollback |
|---|---|---|---|---|---|---|
| 1 | `agentdock_app` direct URL 확보 | 운영자 | Neon console 접근 | host에 `-pooler` 없음, user `agentdock_app` | 그런 role이 없음 → bootstrap 필요(별도 승인) | — |
| 2 | 로컬 연결 검사 (§11) | 운영자 | 1 | preflight 7/7 PASS, 소유권 검사 `not_owned=0, no_dml=0`, `migrate --plan --production` UP_TO_DATE | role FAIL, 또는 `not_owned>0`/`no_dml>0` | 아무것도 바꾸지 않았으므로 불필요 |
| 3 | 새 fingerprint 계산 | 운영자 | 2 | 16 hex 출력 | — | — |
| 4 | secret `DATABASE_URL`과 변수 `AGENTDOCK_TARGET_FINGERPRINT`를 **같은 자리에서** 교체 | 운영자 | 2, 3. **이전 URL을 별도로 보관**(GitHub secret은 다시 읽을 수 없다) | `gh secret list`의 갱신 시각이 바뀜 | — | 이전 URL과 이전 fingerprint로 되돌린다 |
| 5 | Phase 35–37 commit push | 사용자 | 4 | CI success | CI 실패 | `git revert` |
| 6 | Deploy 확인 | 자동 | 5 | plan, migrate, verify, smoke success (**plan 성공 = 새 fingerprint와 secret이 일치한다는 확인**) | plan BLOCKED | §12 B |
| 7 | 다음 예약 Sync 확인 (§13) | 운영자 | 4 | guard 통과, ops 7/7, status ≠ FAILED | guard FAIL | §12 C |

- 4를 다음 예약 Sync(오늘 06:00 cron, 실제 시작 예상 약 10:00Z = 19:00 KST) 전에 마치면 FAILED run이 생기지 않는다.
- 5(Phase 35–37 push)는 4보다 먼저 해도 Sync에는 영향이 없다. 하지만 Deploy의 plan이 secret과 fingerprint 쌍으로 검사하므로, 4를 마친 뒤에 하는 것이 원인 분리에 유리하다.
- **role만 PASS하고 read-only 등이 FAIL이면 배포 준비가 끝난 것이 아니다.** 다만 Sync 자체는 동작한다. 이 경우 Phase 35 commit(`options`)이 반영된 뒤 다시 preflight를 돌린다. 그래도 FAIL이면 Neon이 `options`도 버린다는 뜻이므로 별도 판단이 필요하다(§20).

## 11. Secret 교체 절차

```zsh
# 실행 위치: ~/workspace_auto/agentdock (Phase 35–37 변경이 있는 working tree)
read -rs "DATABASE_URL?agentdock_app direct URL: "; echo; export DATABASE_URL DATABASE_SCHEMA=agentdock

# (a) 세션 검사: 7/7 PASS 기대. role PASS + read-only FAIL이면 §7의 PENDING이 'options도 버림'으로 확정된다.
bun --no-env-file scripts/ops.mjs preflight

# (b) 소유권·권한 (읽기 전용 transaction). 기대: {"role_ok":true,"tables":11,"not_owned":0,"no_dml":0}
bun --no-env-file -e '
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
const [r] = await sql.begin("read only", (tx) => tx`
  SELECT current_user = ${"agentdock_app"} AS role_ok,
         count(*) FILTER (WHERE c.relkind IN (${"r"},${"p"}))::int AS tables,
         count(*) FILTER (WHERE c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = current_user))::int AS not_owned,
         count(*) FILTER (WHERE c.relkind IN (${"r"},${"p"}) AND NOT has_table_privilege(c.oid, ${"SELECT,INSERT,UPDATE,DELETE"}))::int AS no_dml
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = ${"agentdock"} AND c.relkind IN (${"r"},${"p"},${"S"},${"i"})`);
console.log(JSON.stringify(r));
await sql.end();'

# (c) 새 fingerprint와 migration 상태
bun --no-env-file scripts/migrate.mjs --fingerprint
AGENTDOCK_TARGET_FINGERPRINT=<위 16 hex> bun --no-env-file scripts/migrate.mjs --plan --production --require-current
unset DATABASE_URL DATABASE_SCHEMA
```

- (b)가 필요한 이유: 10/22 이후 Deploy의 migration은 `agentdock_app`이 아닌 secret role로 실행되었다. 그 role이 만든 객체가 있으면 `agentdock_app`은 이후 migration(ALTER는 소유자만 가능)이나 쓰기에 실패한다.
  - 로컬 검증: `agentdock_app`은 `not_owned=0`, superuser는 `not_owned=47`이다(`owner-check.txt`).
  - 0008–0010의 DDL은 기존 테이블에 대한 ALTER와 INDEX뿐이라 소유자가 바뀌지는 않는다(INFERENCE). 운영의 실제 값은 PENDING이다.
- `not_owned>0`이면 교체하지 않는다. 소유권 이전(`ALTER … OWNER TO`)은 운영 DB 변경이므로 별도 승인 사항이다.
- (b)와 (c)가 통과하면 GitHub → Settings → Secrets and variables에서 `DATABASE_URL`(repository secret)과 `AGENTDOCK_TARGET_FINGERPRINT`(production environment 변수)를 교체한다. 값은 터미널에 출력하지 않는다.

## 12. 실패 시 Rollback

| 시나리오 | 증상 | 조치 | secret 복구 | 코드 revert |
|---|---|---|---|---|
| A. 교체 후 CI 실패 | CI red | CI는 DB secret을 쓰지 않으므로(test DB만 사용) 코드 문제다 | 불필요 | 해당 commit revert |
| B. Deploy migration 검사 실패 | plan `fingerprint … does not match` | 변수를 갱신하지 않았거나 잘못 갱신한 것. 값을 다시 계산해 갱신한다 | 불필요 | 불필요 |
| B′. plan `history: …` / 42501 | 권한·소유권 문제 | 이전 URL과 이전 fingerprint로 되돌리고 §11 (b)를 다시 본다 | **필요** | 불필요 |
| C. Sync guard 실패 | `Refusing to start: …role…` | secret이 아직 `agentdock_app`이 아니다. 교체가 반영됐는지 확인한다 | 상황별 | **revert하지 않는다**(되돌리면 잘못된 role로 다시 수집된다) |
| D. 인증 실패 | `error code 28P01/28000` | 비밀번호나 role 이름 오류. 이전 URL로 복구한 뒤 다시 확인한다 | **필요** | 불필요 |
| E. Health summary read-only 실패 | ops FAIL, Summary "Not available" | Sync에는 영향이 없다. Phase 35 commit이 반영됐는지 확인한다. 반영된 상태에서도 FAIL이면 Neon이 `options`를 버리는 것이다 → §20 | 불필요 | 불필요(실패 쪽으로 닫힘) |
| F. Registry stage 실패 | status FAILED, `failed-stages=registry` | 기존 정책대로 다음 run에서 cursor부터 이어 읽는다(Phase 32–34 FACT) | 불필요 | 불필요 |
| G. 일부 수집 후 실패 | 일부 stage 실패, 나머지 진행 | stage가 격리되어 있다. 저장은 repository 단위 transaction이라 부분 저장이 없다. 다음 run의 reap가 회수한다 | 불필요 | 불필요 |

- **secret 복구가 필요한 경우:** 연결 자체가 안 되거나 권한이 부족해 Deploy나 Sync가 진행되지 않을 때다.
- **코드 revert가 필요한 경우:** 코드로 인해 CI나 smoke가 실패할 때뿐이다. guard 실패는 revert 사유가 아니다.

## 13. 예약 Sync 검증 계획

교체 후 첫 예약 Sync에서 확인한다. 아직 실행 전이므로 모두 **PENDING**이다.

| 항목 | 확인 위치 | 기대 |
|---|---|---|
| Commit SHA | run의 `headSha` | `5bf8450` 또는 Phase 35–37 commit |
| Guard | sync step 로그 | `Refusing` 없음, 첫 stage 출력 |
| DB Role / search_path / read-only / statement_timeout | Sync health summary step | `FAIL` 줄 없음(7/7). Summary 표 렌더링 |
| Registry / Search / Backlog / Refresh stage | stage 출력과 `failed-stages=` | `none` |
| Run outcome | notice `status=` | COMPLETED 또는 PARTIAL_CAP |
| 신규 artifact | `ingested=`, ingest 줄 `new` 합계 | 직전 5회 범위(ingested 79 등)와 비교 |
| storage_failed | ingest 줄 `outcome` | 0건. 발생 시 `errorCode`로 원인 분류 |
| 실행 시간 | notice `duration=` | 1,222–1,483s 범위 |

## 14. Job 771·978 복구 준비

**원인 재확인 (FACT, 로컬):**
- 978(`maxritter/claude-codepro`): 원문에 literal NUL이 있었다. Phase 32–34 수정으로 해결되어 로컬 재수집 시 ok 9/9였다.
  - GitHub에서 저장소 이름이 `maxritter/qualitylayer`로 바뀌어 그 이름으로 저장됐다.
- 771(`elementalsouls/claude-bughunter`): 수정된 코드로도 `storage_failed`, `errorCode 22021`이었다(`recover-2.txt`).
  - `hunt-file-upload/SKILL.md`의 description이 `"… null byte (shell.php\0.jpg) …"`다. 원문에는 NUL이 없고(literal NUL 0개), js-yaml이 escape를 U+0000으로 decode한다.
  - `hunt-auth-bypass/SKILL.md`에는 literal NUL이 1개 있다(Phase 32–34 수정이 처리).

**수정:**
- `src/detect/json.ts`의 `replaceEscapedNul`: JSON 텍스트에서 escape되지 않은 `\u0000`(앞의 backslash가 짝수 개)을 `�`로 바꾼다.
- `parseJsonManifest`는 parse 전에 적용한다.
- `parseFrontmatter`는 기존 크기 검사용 `JSON.stringify` 결과에 `\u0000`이 있을 때만 적용해 다시 parse한다.
  - YAML의 `\0`, `\x00`, `\u0000`, `\U00000000`는 모두 serialize하면 `\u0000`이 된다. key도 처리된다.
- 호출자 7개(skill, command, agent, catalog, hook, mcp, plugin)가 모두 이 두 함수를 거친다.

**재수집 조건 (FACT, 코드):**
- terminal `failed` job이 있는 저장소는 fan-out(`unenqueuedSeeds`: job이 하나라도 있으면 제외)과 refresh(`repository` 행만 대상) 어느 쪽으로도 다시 잡히지 않는다.
- 첫 수집이 transaction rollback으로 실패했으므로 repository 행이 없다.
- 로컬 확인: `unenqueuedSeeds=[]`, `repository rows=0` (`recover-1.txt`).

**로컬 복구 재현 (FACT):**
1. `enqueueJob`이 새 job(2004, 2005)을 queued로 만들었다. 기존 failed 행(2002, 2003)은 그대로 남아 실패 기록이 보존된다.
2. queued 중에 다시 enqueue하면 같은 id를 반환한다(부분 unique index).
3. 수정 후 drain 결과:
   - 2004 bughunter: ok, found 99, stored 99, summary에 U+FFFD 1건
   - 2005 codepro: ok 9
4. 다시 enqueue하고 drain한 결과:
   - bughunter: `unchanged` 99
   - codepro: `unchanged` 9
   - repository id와 `github_node_id`가 변하지 않았다. package 수는 고유 source_path 수와 같아 중복이 없다(`recover-3.txt`, `recover-4.txt`).

**운영자 runbook (승인 필요, 운영 DB 쓰기):**

전제는 §10 step 4(secret 교체)와 Phase 35–37 commit 반영이다. 반영되지 않은 상태에서 771을 enqueue하면 다시 3회 실패한다.

```zsh
# 실행 위치: ~/workspace_auto/agentdock (반영된 commit과 같은 코드)
read -rs "DATABASE_URL?agentdock_app direct URL: "; echo; export DATABASE_URL DATABASE_SCHEMA=agentdock
bun --no-env-file -e 'const { enqueueJob } = await import("./src/db/queries/jobs.ts"); const { sql, assertSchemaIsolation } = await import("./src/db/client.ts"); await assertSchemaIsolation(); for (const t of ["elementalsouls/claude-bughunter", "maxritter/claude-codepro"]) console.log(t, JSON.stringify(await enqueueJob(t))); await sql.end();'
unset DATABASE_URL DATABASE_SCHEMA
```

- guard를 내장했다. 잘못된 role이면 `Refusing to start`로 아무것도 쓰지 않는다(로컬 확인).
- 출력 `{"kind":"queued","id":N}`의 id를 기록한다. 다음 예약 Sync의 drain이 처리한다.
- **성공 판정:** 해당 jobId의 ingest 줄이 `outcome:"ok"`(또는 `unchanged`)이고, `ops:status`의 failed job 수가 줄어든다.
- **실패 시:** `storage_failed`면 `errorCode`를 확인한다. 실패한 시도는 transaction rollback이라 쓰기가 남지 않아 **rollback할 것이 없다.** 3회 뒤 다시 terminal failed가 된다.
- **중복:** repository identity는 `github_node_id`의 `ON CONFLICT`다(`persist.ts:97`). codepro가 운영에 이미 `qualitylayer`로 있다면 같은 행이 갱신된다(INFERENCE. 운영에 그 행이 있는지는 PENDING).

## 15. Refresh Backlog 분석

- 새 운영 run: **없음.** 마지막은 40229151309(10/25 20:05Z)다. 추세는 Phase 32–34의 5회와 같다.

| run | 시작(UTC) | not-reached |
|---|---|---|
| 40021567316 | 10/23 20:44 | 59 |
| 40083909354 | 10/24 09:56 | 270 |
| 40127517179 | 10/24 19:55 | 171 |
| 40184235414 | 10/25 10:18 | 382 |
| 40229151309 | 10/25 20:05 | 282 |

- 같은 시간대 기준으로 하루 +112다(오전 158→270→382, 오후 59→171→282). 매 run refresh 100건이 모두 처리되어 starvation은 없다.
- 다음 run부터 secret 교체 전까지 Sync가 FAILED(수집 0)라면, 그 사이 not-reached는 refresh가 0건이 되어 run당 증가폭이 커진다(INFERENCE).

## 16. Refresh 상한 시뮬레이션

방법: 5개 run 로그의 ingest 줄에서 refresh job(이미 저장된 저장소에 대한 job)의 실제 wall time(연속된 줄 사이 간격)을 run별로 표본 추출했다. 50건 합을 5,000회 bootstrap했다(`sim.py`, `sim.txt`). `drain = enqueue + refresh`(`budget.ts`)이므로 150으로 올리면 drain도 250이 되어, fan-out의 100 슬롯은 줄지 않는다(마감에 걸리지 않는 한).

| run | refresh job | refresh wall p50 | 실제 run | +50 p95 | 예상 run p95 | core 최저 잔량 | core/job |
|---|---|---|---|---|---|---|---|
| 40021567316 | 97 | 2.9s | 1,294s | +239s | 1,533s | 4,584 | 2.05 |
| 40083909354 | 96 | 2.5s | 1,483s | +235s | **1,718s** | 4,719 | 1.40 |
| 40127517179 | 97 | 3.0s | 1,222s | +242s | 1,464s | 4,767 | 1.16 |
| 40184235414 | 97 | 2.8s | 1,430s | +249s | 1,679s | 4,592 | 2.02 |
| 40229151309 | 96 | 3.0s | 1,222s | +206s | 1,428s | 4,594 | 2.02 |

- 실행 시간: run p50 1,294s, 최대 1,483s → 150 적용 시 p95 최대 1,718s다. drain claim 마감 2,100s(`drainDeadlineMs`, run 시작부터 측정)까지 382s, workflow timeout 3,600s까지 약 1,880s 여유가 있다. 이전 조건 "최장 + 추정 ≤ 1,900s"를 충족한다.
- GitHub API: +50 job × 약 2 core = 약 100. 최저 잔량 4,584/5,000이므로 제한을 넘지 않는다.
- 실패율: 5회 모두 storage_failed는 771·978 이외 0, FAILED 0.
- 효과: 하루 +100 refresh로 not-reached 증가폭이 하루 +112에서 약 +12로 줄어든다(INFERENCE, corpus 증가율이 일정하다고 가정).
- **판정: 변경하지 않는다.** 시뮬레이션은 안전 범위를 보이지만 근거가 5회뿐이고, 새 run이 0회이며, secret 교체와 guard 첫 운영이 겹친다. 원인 분리를 위해 **교체 후 정상 run 2회의 drain 시간이 위 범위 안이면 100→150을 별도 commit으로 제안한다.** 변경 위치는 `src/corpus/caps.ts`의 `authenticated.maxRefreshPerSync` 한 곳이다.

## 17. Registry 정책 판단

FAILED를 유지한다(Phase 32–34 결정 그대로). DB 상태 모델과 API는 바꾸지 않았다. 10/23 이후 registry 실패는 0회(5/5 정상)다. 2주 관찰 기간은 2026-11-06 전후까지다. 다만 secret 교체 전의 guard FAILED run은 registry 통계에서 제외해야 한다.

## 18. 변경 파일

| 파일 | 변경 |
|---|---|
| `src/db/readOnly.ts` | 세션 설정을 `options=-c …`로 옮겼다. 기존 `options`는 보존하고, 개별 parameter는 제거한다. 측정 주석을 달았다. |
| `src/db/readOnly.test.ts` | `options` 계약, 기존 options 뒤에 덧붙이기, postgres.js 전달을 검증한다(수정 전 3 FAIL). |
| `src/detect/json.ts` | `replaceEscapedNul`을 추가하고 `parseJsonManifest`에 적용했다. |
| `src/detect/frontmatter.ts` | serialize 결과에 escape된 NUL이 있으면 치환한 뒤 다시 parse한다. |
| `src/detect/json.test.ts`, `src/detect/frontmatter.test.ts` | NUL escape(key/value)와 escape된 backslash를 보존하는지 검증한다(수정 전 3 FAIL). |
| `src/ingest/pipeline.test.ts` | YAML `\0` frontmatter가 저장되는지 검증한다(수정 전 `ok:false`). |
| `VERCEL_DEPLOY.md` | Step 6에 secret 교체 시 fingerprint를 갱신해야 한다는 내용을 추가했다. |
| `docs/analysis/agentdock-phase35-37-release-readiness.md` | 이 보고서 |

## 19. 테스트 결과

| 항목 | 결과 |
|---|---|
| baseline `bun run test` | 80 files, 1493 passed, 2 skipped |
| check:boundaries | OK |
| lint | 230 files, 문제 없음(처음에 테스트 파일 format 1건 → `biome format` 적용 후 통과) |
| typecheck | 오류 0 |
| test (CI 모드, test DB 필수) | **80 files, 1499 passed, 2 skipped** (+6) |
| build | 성공 |
| e2e (`e2e:seed` → `test:e2e`) | **27 passed** |
| search:eval | **54/54** |
| Phase 32–34 회귀 (guard, NUL body) | 전체 suite에 포함되어 PASS. guard 시나리오는 §9에서 다시 실행 |

- 수정 전 FAIL → 수정 후 PASS:
  - readOnly 3건
  - frontmatter·json 3건(escape된 backslash 보존 케이스 1건은 원래 PASS)
  - pipeline 1건
- skip 2건은 baseline과 같다. trust 인증 test DB에서는 돌 수 없는 비밀번호 테스트와, 의도적으로 skip된 pg_trgm runtime 테스트다.

## 20. 운영 승인 필요 항목

1. **긴급:** Actions secret `DATABASE_URL`을 `agentdock_app` direct URL로 교체하고, `AGENTDOCK_TARGET_FINGERPRINT`를 함께 갱신한다(§11 검사 통과 후).
2. Phase 35–37 commit push.
3. job 771·978 재enqueue(§14 runbook, 운영 DB 쓰기).
4. (조건부) §11 (b)에서 `not_owned>0`이면 소유권 이전 여부를 결정한다(운영 DB 변경).
5. (조건부) `options` 반영 후에도 preflight read-only가 FAIL이면, health summary를 포기할지 다른 방법을 찾을지 결정한다(예: 별도 read-only role. 운영 DB 변경).
6. (선택) 교체 직후 `workflow_dispatch`로 Sync를 1회 실행할지 결정한다(운영자 판단. 이 작업에서는 실행하지 않았다).

## 21. PENDING/NOT RUN

| 항목 | 상태 |
|---|---|
| 운영 Neon의 `options` forward 여부 | PENDING (§11 a) |
| 운영 `agentdock_app` 객체 소유권·권한 | PENDING (§11 b) |
| 교체 후 예약 Sync 결과(§13 전 항목) | PENDING |
| 다음 예약 Sync가 현재 secret으로 guard FAIL | PENDING. 예상(INFERENCE) |
| 운영 job 771·978 재수집 | PENDING (승인) |
| codepro(`qualitylayer`)가 운영에 이미 있는지 | PENDING |
| pooled 실제 PgBouncer에서의 guard | NOT RUN (로컬 pooler 없음) |
| 틀린 비밀번호(28P01) | NOT RUN (trust 인증) |
| Refresh 150 실제 운영 측정 | NOT RUN (보류 결정) |

## 22. Evidence ID

- GitHub runs: CI 40254672357, Deploy 40254796355(`5bf8450`), Deploy 40252398619(`efa7611`), Sync 40021567316 · 40083909354 · 40127517179 · 40184235414 · 40229151309, Sync 실패 39940525800
- 메타데이터: secret `DATABASE_URL` 갱신 `2026-10-22T05:28:37Z`, 변수 `AGENTDOCK_TARGET_FINGERPRINT` 갱신 `2026-10-22T05:18:58Z`
- production 헤더: `X-AgentDock-Commit: 5bf845050d5dfcd58c6ee25c713126ec578b21c9` (2026-10-26 01:4xZ)
- 로컬 산출물(scratchpad `p35/`):
  - `dropproxy.mjs`, `proxy-neon.log`
  - `ops-matrix.txt`, `ops-options-manual.txt`, `ops-matrix-after.txt`
  - `guard-matrix.sh`, `guard-matrix.txt`
  - `owner-check.txt`
  - `readonly-before.txt`, `readonly-after.txt`, `nul-escape-before.txt`, `nul-escape-after.txt`
  - `recover-1.txt` ~ `recover-4.txt`, `dl/`(원문 2개, commit `7c368cb7`)
  - `sim.py`, `sim.txt`
  - `baseline-test.txt`, `ci-static.txt`, `test.txt`, `build.txt`, `e2e.txt`, `eval.txt`
- 외부 문서: neondatabase/neon#1287, Neon docs *Connection pooling*

## 23. 최종 Git Status

HEAD = origin/develop = `5bf8450`이다. 아래는 미커밋 상태다(commit·push 없음).

```
 M VERCEL_DEPLOY.md
 M src/db/readOnly.test.ts
 M src/db/readOnly.ts
 M src/detect/frontmatter.test.ts
 M src/detect/frontmatter.ts
 M src/detect/json.test.ts
 M src/detect/json.ts
 M src/ingest/pipeline.test.ts
?? docs/analysis/agentdock-phase35-37-release-readiness.md
```

## 24. 권장 Commit 메시지

```
git commit -m "fix(ops,ingest): carry read-only settings in options and store YAML/JSON NUL escapes

- readOnlyTarget sends default_transaction_read_only and statement_timeout as
  options=-c flags: a proxy that forwards only user/database/options/
  application_name reproduced the six scheduled runs' FAIL lines exactly, and
  the same settings in options pass through it; checks still fail closed
- parseFrontmatter and parseJsonManifest write escaped U+0000 (YAML \\0, JSON
  \\u0000) as U+FFFD: job 771 still failed 22021 after the raw-NUL fix, from
  a description holding YAML's \\0
- VERCEL_DEPLOY.md: replacing DATABASE_URL changes the deploy fingerprint
- docs: Phase 35-37 release readiness report

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
