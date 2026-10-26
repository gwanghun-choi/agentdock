# AgentDock Phase 32–34 — Actions DB 격리, Sync 상태, Refresh·Storage Failure

- 작성: 2026-10-26 (로컬 측정 10:14–10:26 KST)
- 기준: 로컬 HEAD = origin/develop = `efa7611` (변경 전 working tree clean). 운영 배포본은 `0f2cb82`이고, 그 뒤 commit은 docs 1개다.
- 이전 보고서: [Phase 23–25](agentdock-phase23-25-production-sync-performance.md) · [Phase 26–28](agentdock-phase26-28-production-stabilization.md) · [Phase 29–31](agentdock-phase29-31-production-final-verification.md)
- 하지 않은 것: 운영 DB 접속·SQL, `ALTER ROLE`·migration, Actions secret 열람·변경, 수동 Sync, 운영 설정·환경 변수 변경, 배포, commit/push.
- 운영에 보낸 요청: 없음. 예약 Sync 로그 5개를 `gh api`로 읽기만 했다(40021567316, 40083909354, 40127517179, 40184235414, 40229151309).
- GitHub 공개 API: 재현을 위해 공개 저장소 2개(`elementalsouls/claude-bughunter`, `maxritter/claude-codepro`)를 비인증 상태로 읽었다. 결과는 로컬 test DB에만 썼다.
- 표기: **FACT**는 이번에 실측하거나 재현한 값, **INFERENCE**는 실측에서 끌어낸 해석, **PENDING**은 확인하지 못한 항목이다.

## 1. 핵심 결론

1. **Actions의 DB 연결 문제는 두 가지가 겹친 것이다(FACT + INFERENCE).**
   - 6회 연속(10/23 10:38Z ~ 10/25 20:05Z) ops 검사 7개 중 6개가 FAIL했다. role, read-only 2개, statement_timeout, search_path, 쓰기 거부가 실패했고, pool 10/10만 통과했다(FACT).
   - 로컬에서 같은 검사를 superuser로 실행하면 **role 1개만 FAIL**하고, startup parameter로 거는 나머지 4개와 쓰기 거부는 PASS한다(FACT).
   - 따라서 운영에는 원인이 둘 있다(INFERENCE). ① secret이 `agentdock_app`이 아닌 role로 접속한다. ② 그 연결 경로가 startup parameter를 전달하지 않는다.
   - ②는 Neon proxy가 `options`·`application_name`·`replication`만 전달한다는 공개 기록([neondatabase/neon#1287](https://github.com/neondatabase/neon/issues/1287))과도 맞는다. 다만 운영에서 확인하지는 않았다(PENDING).
   - 결론적으로 **secret을 고쳐도 health summary는 계속 "Not available"일 수 있다.**
2. **Sync는 잘못된 role을 스스로 감지하지 못했다. 이 부분을 코드로 고쳤다(FACT).**
   - 웹은 부팅할 때 `assertSchemaIsolation()`을 실행한다. 반면 `corpus-sync`는 어떤 검사도 없이 6회 동안 정상 수집했다.
   - 이제 Sync는 첫 stage 전에 같은 함수를 실행한다. role이나 search_path가 틀리면 exit 1로 멈추고, 아무것도 읽거나 쓰지 않는다. `sync:last_attempt` 기록도 하지 않는다.
   - 로컬 시나리오 7개에서 기대대로 동작했고, 출력에 비밀정보가 나온 줄은 0이었다(§8).
3. **운영 반영 순서가 중요하다(INFERENCE).** 지금 secret으로 이 코드를 push하면 다음 예약 Sync가 사전 검사에서 멈춘다.
   - 반드시 secret을 먼저 교체하고, 그다음 push한다(§16, §17).
4. **Registry 장애로 run 전체가 FAILED가 되는 것은 현재 계약대로다. 계약은 바꾸지 않았다(FACT).**
   - 이후 5회는 모두 registry가 정상이었다(retried=0). 실패한 다음 run은 저장해 둔 cursor에서 이어 읽었다.
   - 로컬에서도 같은 결과가 재현됐다. 10초 뒤 1회 재시도하고 실패하면 stage FAILED, Status FAILED, exit 1이다.
   - stage 실패를 FAILED 아닌 상태로 바꾸려면 홈 화면의 "last sync without errors", health 판정, 결정 `phase2-last-sync-copy`를 함께 바꿔야 한다. 그래서 구현하지 않고 제안으로 남긴다(§10).
5. **Refresh 미도달은 실제로 쌓이고 있다. 회전은 정상이고, 원인은 용량이다(FACT + INFERENCE).**
   - 같은 시간대끼리 비교하면 하루 +112씩 늘었다. 오전은 158 → 270 → 382, 오후는 59 → 171 → 282다(FACT).
   - 정렬은 최근 확인이 가장 오래된 순서이고, drain이 매회 refresh 100건을 모두 소화한다. 그러므로 특정 저장소가 계속 밀리지는 않는다(FACT, 코드와 로그).
   - 대신 저장소 수는 늘고 refresh 용량은 하루 200건으로 고정이어서, 재확인 주기(read-age)가 계속 길어진다(INFERENCE).
   - 상한은 올리지 않았다. 다음 Sync 측정과 함께 수치 근거를 붙인 제안으로 남긴다(§12).
6. **storage_failed의 원인은 본문의 NUL 문자였다. 두 job 모두 로컬에서 재현했고 고쳤다(FACT).**
   - PostgreSQL이 `22021 invalid byte sequence for encoding "UTF8": 0x00`으로 쓰기를 거부했다. 한 파일의 NUL 하나가 저장소 전체 쓰기를 실패시켰고, 결정적이므로 3번 모두 실패했다.
   - `fetchRawFile`에서 NUL을 U+FFFD로 바꾸도록 고쳤다. 회귀 테스트는 수정 전 FAIL, 수정 후 PASS다.
   - storage_failed 로그 줄에는 이제 SQLSTATE `errorCode`가 남는다.

## 2. Phase별 판정

| Phase | 판정 | 근거 |
|---|---|---|
| **32** Actions DB 연결 | **CONDITIONAL** | 코드 측 재발 방지(Sync 사전 검사)는 구현·검증했다. secret 교체(운영자)와 startup parameter 전달 여부 확인(PENDING)이 남았다 |
| **33** Registry·상태 | **CONDITIONAL** | 분석과 재현을 마쳤고 현재 계약은 일관된다. 상태 계약 변경은 정책 결정 대기라 구현하지 않았다 |
| **34** Refresh·Storage | **CONDITIONAL** | storage_failed는 원인 확정·수정·회귀 테스트까지 **PASS**다. refresh는 원인을 분석했지만 상한 조정은 근거를 더 모은 뒤 승인받아야 한다 |

## 3. 기준 Git SHA/Status

| 항목 | 값 |
|---|---|
| 로컬 HEAD / origin/develop | `efa7611` / `efa7611` |
| 변경 전 `git status --short` | 빈 출력(clean) |
| 운영 Sync가 실행한 SHA | `0f2cb82` (5회 모두) |
| 변경 전 테스트 baseline | 80 files, 1490 passed, 2 skipped |

## 4. 이전 운영 문제 요약

| ID | 증상(Phase 29–31) | 이번에 확인한 사실 |
|---|---|---|
| O-2 | health summary "Not available", ops 검사 6개 FAIL | 이후 5회도 같은 6개가 FAIL해 **6회 연속**이다(FACT) |
| registry | 10/23 오전 run FAILED | 이후 5회 모두 정상이고 retried=0이다. 실패 직후 run은 저장된 cursor(`resumed-from=…`)에서 이어 읽었다(FACT) |
| refresh | not-reached 43 → 158 | 59 → 270 → 171 → 382 → 282(FACT) |
| storage_failed | job 771·978 반복 | 둘 다 attempt 3까지 같은 결과로 끝나 terminal failed가 됐다. 10/24 이후로는 없다(FACT) |

예약 Sync 7회:

| run | 시작(UTC) | status | failed-stages | ingested / unchanged | not-reached | still-pending | listed / held | 소요 |
|---|---|---|---|---|---|---|---|---|
| 39853119505 | 10-22 20:56 | PARTIAL_CAP | none | 66 / 74 | 43 | 12,549 | 7,273 / 8,846 | 1406s |
| 39940525800 | 10-23 10:38 | FAILED | registry | 84 / 67 | 158 | 12,488 | 9,781 / 11,431 | 1222s |
| 40021567316 | 10-23 20:44 | PARTIAL_CAP | none | 91 / 67 | 59 | 13,128 | 11,575 / 13,525 | 1294s |
| 40083909354 | 10-24 09:56 | PARTIAL_CAP | none | 94 / 63 | 270 | 13,823 | 14,395 / 16,615 | 1483s |
| 40127517179 | 10-24 19:55 | COMPLETED | none | 87 / 67 | 171 | 14,427 | 15,693 / 18,159 | 1222s |
| 40184235414 | 10-25 10:18 | COMPLETED | none | 100 / 58 | 382 | 15,023 | 17,561 / 20,452 | 1430s |
| 40229151309 | 10-25 20:05 | COMPLETED | none | 79 / 74 | 282 | 15,591 | 19,247 / 22,560 | 1222s |

모든 run에서 processed는 200이고, GitHub core 남은 양은 4,571–4,809/5,000이다.

## 5. Actions DATABASE_URL 흐름

| 단계 | 파일 | 사용하는 값 | 연결 방식 |
|---|---|---|---|
| schema 확인 | `sync.yml` → `migrate.mjs --plan --require-current` | `secrets.DATABASE_URL` | 읽기 전용 plan |
| 수집 | `sync.yml` → `bun run sync`(`corpus-sync.mjs`) | `secrets.DATABASE_URL` | `src/db/client.ts`의 pool(`max 10`, `connection.search_path`) |
| health summary | `sync.yml` → `ops.mjs status --markdown` | `secrets.DATABASE_URL` | `readOnlyTarget()`가 query parameter 4개를 붙인 URL(`src/db/readOnly.ts`) |
| deploy migration | `deploy.yml` plan/migrate/verify | `secrets.DATABASE_URL` (같은 이름) | `migrate.mjs --production` |
| 웹 | Vercel Production 환경 변수 | Vercel의 `DATABASE_URL`(pooled) | 별도 값 |

답변:

1. **Sync가 DATABASE_URL을 받는 곳:** repository secret `DATABASE_URL` 하나다. 세 step이 모두 같은 secret을 쓴다(FACT, `sync.yml`).
2. **Deploy와 Sync가 같은 secret을 쓰는가:** 이름이 같다(FACT). 따라서 deploy migration도 같은 role로 실행된다(INFERENCE). `migrate.mjs` 머리말은 "agentdock_app으로 migration한다"를 전제로 한다.
3. **Pooled와 Direct의 구분:** hostname의 `-pooler`로 구분한다. ops는 이를 거부한다(`readOnlyTarget`). Sync와 migrate는 hostname을 검사하지 않는다(FACT). 웹은 pooled를 쓴다.
4. **웹과 Sync의 role 검사 차이:** 웹은 `instrumentation.ts`에서 `assertSchemaIsolation()`을 실행한다. Sync에는 검사가 없었다(FACT). 이번에 추가했다.
5. **Sync가 잘못된 role을 감지하지 못한 이유:** 검사 코드가 없었기 때문이다. 잘못된 role도 쓰기 권한이 있어서 수집은 정상으로 보였다(FACT: 6회 모두 ingest 성공).
6. **Read-only Guard가 동작하는 환경:** startup parameter를 서버까지 전달하는 연결에서만 동작한다. 로컬 PostgreSQL 17 direct와 CI의 일회용 DB에서는 PASS다(FACT). 운영 Neon 경로에서는 PENDING이다(§7).
7. **Health Summary 실패가 성공에 가려지는가:** 그렇다(FACT). step이 `continue-on-error`라서 run은 초록색이고, Summary에는 "Not available" 한 줄만 남는다. 6회 동안 알림이 없었다.
8. **올바른 role이어도 Guard가 실패할 수 있는가:** **있다(INFERENCE).** §7 참고.

## 6. Role 및 DB 설정 검사

같은 `readOnlyChecks()`를 실행한 결과다(E-3, E-4, E-12).

| 검사 | 운영(6회 모두) | 로컬 `agentdock_app` | 로컬 superuser `postgres` |
|---|---|---|---|
| 10 of 10 pool connections | PASS | PASS | PASS |
| default_transaction_read_only = on | **FAIL** | PASS | PASS |
| transaction_read_only = on | **FAIL** | PASS | PASS |
| statement_timeout = 30000 ms | **FAIL** | PASS | PASS |
| connected as agentdock_app | **FAIL** | PASS | **FAIL** |
| search_path is exactly agentdock | **FAIL** | PASS | PASS |
| write refused (25006) | **FAIL**(accepted, rolled back) | PASS | PASS |

- 로컬 superuser 열에서 보듯, role이 틀려도 startup parameter는 적용된다. 운영의 4개 FAIL(read-only 2, timeout, search_path)과 쓰기 수락은 role로 설명되지 않는다(FACT에서 끌어낸 INFERENCE).
- `src/db/client.ts`의 `connection: { search_path }`도 startup parameter다. 웹이 pooled에서 이 검사를 통과하는 것은 role 기본값(`ALTER ROLE agentdock_app SET search_path = agentdock`) 덕분일 수 있다(INFERENCE).
- 그러므로 secret을 `agentdock_app`으로 바꾸면 Sync 사전 검사(role + search_path)는 웹과 같은 근거로 통과할 것으로 본다(INFERENCE).

## 7. Read-only Guard 실패 원인

- **원인 A: secret role ≠ `agentdock_app`.** 확실하다(FACT). 6회 모두 `current_user = 'agentdock_app'`이 false였다.
  - 어떤 role인지는 알 수 없다. 검사가 값을 출력하지 않도록 설계돼 있고, secret도 열람하지 않았다.
- **원인 B: startup parameter가 서버에 도달하지 않는다.** INFERENCE다.
  - 근거 1: 로컬 superuser에서는 같은 parameter가 적용된다(FACT).
  - 근거 2: Neon proxy는 startup parameter 중 `options`, `application_name`, `replication`만 전달한다는 기록이 있다(공개 issue #1287, 시점이 오래됨).
  - 반대 가능성: secret이 `-pooler`가 아닌 다른 pooler를 가리키는 경우다. 확인하지 못했다(PENDING).
- **영향:** 원인 B가 맞다면 secret을 고친 뒤에도 ops의 read-only 검사 4개가 FAIL한다. 그러면 Summary는 여전히 "Not available"이다. 이것은 fail-closed 동작이고, 보고서를 읽지 못할 뿐 쓰기 위험은 없다.
- **코드를 바꾸지 않고 확인하는 방법(운영자):** §17의 2번 절차다. 이 결과가 나와야 원인 B를 FACT로 바꿀 수 있다.
- **원인 B가 확인되면 제안할 수정(구현하지 않음):** `readOnlyTarget()`이 설정을 별도 parameter 대신 `options=-c default_transaction_read_only=on -c statement_timeout=30000`으로 보낸다.
  - vanilla PostgreSQL에서는 동작이 같다. 운영에서도 `readOnlyChecks()`가 그대로 검증하므로 실패해도 fail-closed다.
  - 운영에서 재현되지 않은 문제라 이번에는 넣지 않았다(규칙 15).

## 8. Sync 시작 전 검증 개선

**변경:** `scripts/corpus-sync.mjs`가 첫 stage보다 먼저 `assertSchemaIsolation(sql)`을 호출한다. 웹이 쓰는 검사를 그대로 재사용했다.
- 실패하면 오류를 출력하고 `::error` annotation을 남긴 뒤 `sql.end` → exit 1로 끝난다.
- `recordSyncAttempt`보다 앞에서 끝나므로, 잘못된 연결로 기록 한 줄도 쓰지 않는다.
- driver 오류는 `errorCode()`로 SQLSTATE나 시스템 코드만 출력한다. 메시지에는 host·user가 들어갈 수 있기 때문이다.

**role 이름 단일화:** `AGENTDOCK_ROLE`을 `src/db/schema.ts`에 정의했다. `assertSchemaIsolation`과 `ops.mjs`가 이 값을 읽는다. 하드코딩은 2곳에서 1곳으로 줄었다.

**메시지 변경:** `assertSchemaIsolation`이 실제 접속 role 이름을 더 이상 인용하지 않는다. URL의 user가 공개 Actions 로그에 남기 때문이다.
- 문구도 `.env` 전제를 지워 "Check the DATABASE_URL this process was given."으로 바꿨다.

**로컬 검증:** `bun --no-env-file scripts/corpus-sync.mjs --source=seeds --no-enqueue --drain=0 --refresh=0`로 실행했다(E-5, E-6).
- 비밀정보 검사는 출력 전체에서 sentinel 비밀번호, `127.0.0.1`, `:9`, `nosuchuser`, `postgres@`를 grep한 결과다.

| 사례 | 입력 | 기대 | 결과 |
|---|---|---|---|
| A 올바른 role + 설정 (direct) | `agentdock_app@…:55432/agentdock_test` | 검사 통과, 수집 진행, exit 0 | exit 0, seeds stage 실행. 비밀정보 0줄 |
| B 잘못된 role | `postgres@…` (superuser) | 수집 전 거부, exit 1 | `Refusing to start: connected as a role other than "agentdock_app"`, exit 1. 0줄 |
| C 잘못된 search_path | `…?search_path=public` | 수집 전 거부, exit 1 | `search_path is "public"`, exit 1. 0줄 |
| D Pooled URL | — | 같은 검사가 적용됨(hostname으로 거부하지 않음) | **NOT RUN**: 로컬 pooler가 없다. 웹이 pooled에서 같은 함수를 통과하는 것이 간접 근거다 |
| E Direct URL | A와 같다 | A | A |
| F DB 연결 실패 | 비밀번호가 든 URL, 포트 9 | 코드만 출력, exit 1 | `error code ECONNREFUSED`, exit 1. 0줄 |
| G 설정 누락 | `DATABASE_URL` 없음 | env 오류(변수 이름만), exit 1 | `parseEnv`의 기존 오류, exit 1. 값 출력 없음(기존 동작) |
| H 민감정보가 든 예외 | 없는 role과 비밀번호 | 메시지 대신 코드만 | `error code 28000`, exit 1. role 이름과 비밀번호 0줄 |

`bun run ops:preflight`도 로컬에서 다시 실행했다. `agentdock_app`은 7/7 PASS였고, superuser는 role 1개 FAIL에 exit 2였다(E-12).

## 9. Registry 장애 분석

- **운영(FACT):** 39940525800에서 `could not reach the MCP registry. Retried once after 10 s; 0 page(s) were read`가 나왔다. 나머지 stage는 모두 실행됐다.
  - 다음 run 40021567316은 `resumed-from=io.github.AceDataCloud/mcp-openai:…`로 cursor를 이어받았다. pages=40, seeds=778, retried=0이다.
- **이후 5회(FACT):** 모두 pages=40, retried=0, stopped=page_cap이다. 오전 회차 2회(10/24, 10/25)도 정상이었다.
  - 10/20–10/23 오전에 4회 연속 실패한 패턴은 이어지지 않았다.
- **로컬 재현(FACT, E-7):** `HTTPS_PROXY`를 닫힌 포트로 두고 `--source=registry`를 실행했다.
  - 11초 걸렸다(재시도 대기 10초). 로그 문구, `::error`, `Status FAILED`, `failed-stages=registry`, exit 1이 운영과 같았다.
- **재시도 정책:** 늘리지 않았다. 운영에서 회복을 확인한 시점은 22분 뒤였다. 초 단위 재시도를 몇 번 더 했다면 성공했을지 판단할 근거가 없다.

## 10. 전체 Sync 상태 계약

| 소비자 | 읽는 것 | stage 하나가 실패하면 |
|---|---|---|
| Actions conclusion | process exit code | exit 1 → failure(빨강) |
| `::notice` | `currentStatus()` | `status=FAILED … failed-stages=<이름>` |
| `schema_meta` `sync:last_attempt` | `ok`, `status`, `failedStages`, 처리 수 | `ok=false`, `status=FAILED`, stage 이름 |
| `schema_meta` `sync:last_success` | 모든 stage 성공 시에만 기록 | 기록하지 않음 |
| 홈 화면 | `lastSyncSucceededAt()` → "last sync without errors" | 직전 성공 시각 유지 |
| `ops:status` / health | `syncHealth()` | DEGRADED(`the last run failed (stages: …)`) |

질문별 답변:

1. **일부 stage 실패를 전체 FAILED로 처리하는 것이 맞는가:** 현재 결정(`sync-status-semantics`, `phase2-last-sync-copy`)과 모든 소비자가 일관된다.
   - 이를 바꾸면 홈 화면 문구가 거짓이 된다. stage 오류가 있었는데 "without errors"라고 표시하게 된다. 그래서 바꾸지 않았다.
2. **Registry 장애가 수집 결과에 미치는 영향:** 그 run의 registry seed 0개다. registry는 backlog로 들어가므로 같은 run의 drain에는 영향이 없다.
   - 39940525800의 drain은 200/200을 처리했고 ingested는 84로, 직전 66보다 많았다(FACT).
3. **검색·Backlog·Refresh는 정상 완료됐는가:** 39940525800에서 search, fan-out(backlog 포함), refresh, drain stage가 모두 성공했다(FACT, `failed-stages=registry` 하나).
4. **PARTIAL_CAP의 의미:** drain이 상한을 다 쓰고도 due job이 남은 상태다. exit 0이고, 오류가 아니라 상한에 걸린 것이다(`src/corpus/budget.ts`).
5. **PARTIAL_CAP과 부분 장애를 구분해야 하는가:** 이미 구분된다. 상한은 PARTIAL_*로 exit 0, 장애는 FAILED로 exit 1이다.
   - 다만 FAILED가 drain 결과(PARTIAL_CAP/COMPLETED)를 가린다. 그 정보는 같은 summary의 `Jobs still queued`와 처리 수에서 읽을 수 있다.
6. **운영 모니터링의 기대:** 빨간 run은 무언가 깨졌다는 뜻이다. 외부 registry 장애도 seed 수집이 깨진 것이므로 계약상 맞다.
   - 다만 주 2–4회 빨간 run이 나오면 알림 피로가 생긴다(INFERENCE, 10/20–23 실적).
7. **CI 실패 알림과 실제 수집 실패가 구분되는가:** conclusion만 보면 구분되지 않는다. `::notice`의 `failed-stages`와 health의 stage 이름으로 구분된다(FACT).

**제안(구현하지 않음, 정책 결정 필요):** 외부 discovery 소스(registry, links)의 일시 장애를 `PARTIAL_SOURCE`로 분리하는 안이다.
- 영향 범위: `SyncStatus` 타입, `syncStatus()`, `syncHealth()`의 PARTIAL 분기, `recordSyncSucceeded` 조건, 홈 화면 문구("last sync without errors" → 의미 재정의), `budget.test.ts`·`health.test.ts`, 결정 문서 2건.
- 계약 변경 폭이 커서 별도 Phase로 둔다. 결정 기준은 다음 2주 동안 registry로 인한 FAILED 비율이다.

## 11. Stage별 실패 시나리오

| 사례 | 근거 | DB(`sync:last_attempt`) | exit | conclusion | Summary/notice |
|---|---|---|---|---|---|
| A 모든 stage 성공 | 운영 40127517179 | ok=true, COMPLETED, last_success 갱신 | 0 | success | `status=COMPLETED failed-stages=none` |
| B registry만 실패 | 운영 39940525800 + 로컬 재현(E-7) | ok=false, FAILED, [registry] | 1 | failure | `status=FAILED failed-stages=registry` |
| C search만 실패 | 로컬 재현(E-8, 5개 topic 모두 실패) | (scheduled에서) ok=false, FAILED | 1 | failure | `failed-stages=search(claude-code,…)` |
| D backlog만 실패 | 코드: backlog는 별도 stage가 아니라 `fan-out` stage 안에 있다 | fan-out FAILED | 1 | failure | `failed-stages=fan-out` |
| E refresh만 실패 | 코드: `stage('refresh')` | refresh FAILED | 1 | failure | `failed-stages=refresh` |
| F registry 재시도 후 성공 | 단위 테스트 `src/registry/sync.test.ts` "is asked for once more…" | 실패 아님 | 0 | success | `retried=1` |
| G registry 재시도 후 실패 | 단위 테스트 "fails the stage on a second miss…" + E-7 | B와 같음 | 1 | failure | B와 같음 |
| H 처리 상한 도달 | 운영 40083909354 + `budget.test.ts` | ok=true, PARTIAL_CAP | 0 | success | `status=PARTIAL_CAP` |
| I 여러 stage 동시 실패 | 코드: `stageFailures` 배열 | FAILED, [a, b] | 1 | failure | `failed-stages=a,b` |

- C, D, E, I는 같은 `stage()` 함수를 거친다. C는 로컬에서 실제로 재현했다.
- D와 E는 DB 오류를 일부러 일으켜야 해서 로컬에서도 실행하지 않았다(NOT RUN). 코드 경로가 같다는 것까지가 근거다.
- 부수 발견: stage 이름이 열 너비보다 길면 summary 줄에서 공백이 사라진다(`search(…)FAILED, see above`). 보기만 불편하므로 수정하지 않았다.

## 12. Refresh backlog 분석

**알고리즘(FACT, `src/corpus/refresh.ts`):**
- 대상은 fork·archived가 아닌 저장소 중 `coalesce(checked_at, scanned_at)`가 `12h × (2^min(check_failures,4) − 1)`만큼 지난 것이다.
- 정렬은 최근 확인이 가장 오래된 순서(nulls first)이고, `limit = maxRefreshPerSync(100)`이다.
- `enqueueJob`으로 넣는다(denylist와 queue 상한). drain 상한은 enqueue + refresh = 200이다.
- `notReached`는 stale 전체에서 이번 run이 고려한 수를 뺀 값이다. cursor는 따로 없고, 정렬 자체가 이월 순서다.

**질문별 답변:**

1. **158건이 실제 누적인가:** 그렇다(FACT). 같은 시간대끼리 하루 +112씩 늘었다(오전 158 → 270 → 382, 오후 59 → 171 → 282).
   - 오전 값이 오후보다 약 100 높다. 오전 run은 직전 run과 14시간, 오후 run은 10시간 간격이어서 12시간 기준을 넘는 수가 다르기 때문이다(INFERENCE).
2. **같은 저장소가 계속 밀리는가:** 아니다(FACT + INFERENCE).
   - 매회 enqueued=100이고, drain은 200을 처리했다. 남은 queue는 0–3이다. 그러므로 refresh job은 그 run 안에서 실행되고 `checked_at`이 갱신된다.
   - 정렬상 다음 run은 그다음으로 오래된 저장소를 고른다.
3. **순환하는가:** 그렇다. 최근 확인이 가장 오래된 순서로 FIFO처럼 돈다.
4. **신규 발견이 기존 대상을 밀어내는가:** 슬롯은 분리돼 있다(fan-out 100, refresh 100). 다만 신규 수집이 저장소 수를 늘려 stale 집합이 커진다. 밀어내는 것이 아니라 회전 주기를 늘리는 것이다(INFERENCE).
5. **read-age가 증가하는가:** 그렇다(INFERENCE).
   - 회전 주기는 (not-reached + 100) / 100 run이다. 10/25 오전 기준 약 4.8 run, 약 2.4일이다.
   - 하루 +112가 계속되면 주기도 하루 약 0.56일씩 늘어난다.
   - 운영 DB를 직접 볼 수 없어 실제 `checked_at` 분포는 확인하지 못했다(PENDING).
6. **cap 조정이 해결책인가:** 부분적으로만 그렇다.
   - GitHub quota는 병목이 아니다. 7회 동안 남은 양이 4,571–4,809/5,000이었다(FACT).
   - 묶는 것은 drain 소요 시간이다(FACT, E-9). 직렬 처리이고, unchanged 중앙값은 2.2–3.0s, ok 중앙값은 4.6–5.5s다. drain stage는 911–1081s, run 전체는 1222–1483s다. drain claim 마감은 35분(2100s)이다.
   - refresh를 +100 늘리면 약 +340s로 추정된다(100건 × 평균 약 3.4s, refresh 결과 비율을 unchanged 2/3, ok 1/3으로 가정, INFERENCE). 가장 긴 run이 약 1820s가 돼 마감까지 여유가 약 280s뿐이다.
   - 1회 측정 근거로 상한을 바꾸지 않았다. 제안은 §17의 5번에 있다.

## 13. Storage Failure 원인

**재현(FACT, E-1, E-2):** 로컬 test DB(`agentdock_test`)에 두 저장소를 비인증으로 ingest했다. scratch 사본에서 catch 블록에 예외 출력만 추가했고, 저장소 원본은 수정하지 않았다.

| job | 저장소 | 실패한 INSERT | SQLSTATE | NUL 위치 |
|---|---|---|---|---|
| 771 | `elementalsouls/claude-bughunter` | `package` | 22021 | `skills/hunt-file-upload/SKILL.md`의 summary·frontmatter(1개), `skills/hunt-auth-bypass/SKILL.md`의 body(1개) |
| 978 | `maxritter/claude-codepro` | `package_version` | 22021 | `qualitylayer/src/skills/*/SKILL.md` 3개의 body(12·19·43개), `plugin.json`·`hooks.json`의 body와 parseErrors |

- **유형:** 데이터 형식이다. NUL은 올바른 UTF-8이지만 PostgreSQL text/jsonb에는 저장할 수 없다.
  - 외부 API, validation, 제약 조건, 중복, transaction, timeout 문제는 아니다. 한 transaction 안에서 첫 INSERT가 거부되고 전체가 rollback된다.
- **반복된 이유:** `storage_failed`는 `retryable`이라 3번 시도했고, 입력이 같으니 결과도 같았다.
  - 두 job은 이제 terminal failed다. fan-out은 job row가 있는 저장소를 다시 제안하지 않고, repository row가 없으니 refresh 대상도 아니다. 수정을 배포해도 **자동으로 재수집되지 않는다.**
- **로그에 원인이 없던 이유:** pipeline의 catch가 outcome만 기록했다(`emit({ outcome })`). 예외는 의도적으로 경계를 넘지 않는다.

**수정:**
- `src/github/raw.ts`의 `fetchRawFile()`가 반환하는 본문에서 `\u0000`을 `�`로 바꾼다. 저장소 파일 본문이 들어오는 유일한 경로다(호출처는 `scan.ts`와 `links.ts`).
  - TextDecoder가 해석할 수 없는 바이트에 이미 쓰는 문자와 같다. provenance는 `blob_sha`가 정확한 바이트를 가리키므로 유지된다.
- `src/ingest/errors.ts`에 `errorCode()`를 추가했다. storage_failed 로그 줄에 `errorCode`(예: `22021`)가 남는다.
  - 메시지는 남기지 않는다. 실패한 문장에는 값이 들어 있기 때문이다. 다른 줄에서는 키 자체가 없다(`detectorErrors`와 같은 방식).

## 14. 변경 코드 및 테스트

| 파일 | 변경 |
|---|---|
| `scripts/corpus-sync.mjs` | 첫 stage 전 `assertSchemaIsolation`, 실패 시 코드나 메시지를 출력하고 exit 1(+23) |
| `src/db/schema.ts` | `AGENTDOCK_ROLE` 상수(+7) |
| `src/db/client.ts` | 상수 사용, 실제 role을 인용하지 않는 메시지 |
| `scripts/ops.mjs` | `role: AGENTDOCK_ROLE` |
| `src/github/raw.ts` | NUL → U+FFFD |
| `src/ingest/errors.ts` | `errorCode()` |
| `src/ingest/pipeline.ts` | storage_failed에 `errorCode` |
| `src/log.ts` | `IngestLog.errorCode?` |
| `src/ingest/pipeline.test.ts` | NUL이 든 body와 frontmatter가 저장되는지 확인(회귀) |
| `src/ingest/errors.test.ts` | `errorCode` 2건 |
| `VERCEL_DEPLOY.md` | Sync 사전 검사 설명. "adds no table"을 실제 동작("Not available" 한 줄)으로 정정 |

**회귀 테스트 전후(E-10):**
- `raw.ts`에서 치환만 손으로 되돌리면 새 테스트가 `expected { ok: false … } to match object { ok: true … }`로 **FAIL**한다.
- 수정을 다시 넣으면 **PASS**한다.

**전체 검증(로컬, `TEST_DATABASE_URL` = loopback 55432):**

| 명령 | 결과 |
|---|---|
| `bun run check:boundaries` | OK (migration 11, source 100, UI 32) |
| `bun run lint` | Checked 230 files, no fixes |
| `bun run typecheck` | 오류 0 |
| `bun run test` | **80 files, 1493 passed, 2 skipped** (baseline 1490 + 신규 3) |
| `bun run build` | 성공 (`DATABASE_URL` placeholder) |
| `bun run test:e2e` | **27 passed** |
| `bun run search:eval` | **54/54** |

- skip 2건은 baseline과 같다.
  - `client.test.ts`의 잘못된 비밀번호 거부 테스트: test DB가 trust 인증이라 비밀번호가 없다.
  - `search.test.ts`의 pg_trgm 부재 runtime 경로: 의도적으로 skip된 테스트다.
- e2e 실행이 만든 `test-results/.last-run.json` 때문에 lint가 한 번 실패했다. 이 파일을 지운 뒤 다시 실행한 결과가 위 표다.

## 15. 변경 전후 비교

| 항목 | 변경 전 | 변경 후 |
|---|---|---|
| Sync가 잘못된 role로 시작 | 6회 정상 수집(검사 없음) | 첫 stage 전에 exit 1, 쓰기 0 (로컬 B) |
| Sync가 잘못된 search_path로 시작 | 검사 없음 | exit 1 (로컬 C) |
| 연결 실패 메시지 | stage에서 message 출력(host가 들어갈 수 있음) | 사전 검사에서는 코드만 출력 (로컬 F, H) |
| NUL이 든 저장소 | storage_failed × 3, 저장 0 | 정상 저장, NUL은 U+FFFD (회귀 테스트) |
| storage_failed 로그 | outcome만 | `errorCode` 포함 |
| role 이름 정의 | 2곳(client.ts, ops.mjs) | 1곳(schema.ts) |
| 정상 연결의 Sync 동작 | — | 같다. SELECT 1회가 추가된다 (로컬 A) |
| 정상 파일의 contentHash | — | 같다(NUL이 없으면 문자열이 그대로다) |

## 16. 운영 영향 및 Rollback

- **반영 순서(필수):** ① 운영자가 secret을 교체하고 검증한다(§17의 1번). ② 그다음 push한다.
  - 순서를 거꾸로 하면 첫 예약 Sync가 `Refusing to start`로 멈추고 수집이 0이 된다. 데이터 손상은 없다.
- **secret 교체의 부수 효과:** `deploy.yml`의 migration도 같은 secret을 쓴다. 따라서 migration이 `agentdock_app`으로 실행된다. 이것은 `migrate.mjs`가 전제하는 원래 설계다.
  - 다만 기존 테이블 소유자가 다른 role이면 `agentdock_app`의 권한이 부족할 수 있다(PENDING). §17의 1번 절차의 `migrate --plan`과 preflight로 사전에 확인한다.
- **NUL 치환의 영향:**
  - 지금까지 NUL이 든 파일은 저장 자체가 실패했다. 그러므로 기존 artifact의 version identity(contentHash)는 변하지 않는다.
  - 해당 저장소가 다음에 읽힐 때 새로 저장된다. 단, terminal failed인 job 2건은 수동으로 다시 넣어야 한다(§17의 4번).
- **로그 형식:** storage_failed 줄에만 키 하나가 추가된다. 다른 줄은 바이트 단위로 같다.
- **Rollback:** 이번 commit 하나를 revert하면 된다. migration, schema, 환경 변수 변경이 없다.
  - 사전 검사만 끄고 싶다면 revert가 유일한 방법이다. 플래그를 두지 않은 것은 의도다. 우회 수단을 남기면 검사를 둔 의미가 없다.

## 17. 운영 승인 필요 사항

1. **Actions secret `DATABASE_URL` 교체(최우선, 보안).** `agentdock_app`의 **direct** 연결 문자열로 바꾼다. 로컬 터미널에서 값을 출력하지 않고 확인한다.

   ```bash
   # 실행 위치: 로컬 ~/workspace_auto/agentdock (값은 화면에 표시되지 않는다)
   read -rs DATABASE_URL && export DATABASE_URL
   bun --no-env-file scripts/ops.mjs preflight          # "PASS  connected as agentdock_app" 확인
   DATABASE_SCHEMA=agentdock bun --no-env-file scripts/migrate.mjs --plan --require-current
   unset DATABASE_URL
   # 확인 후: GitHub → Settings → Secrets and variables → Actions → DATABASE_URL 갱신
   ```

2. **원인 B 확인(위와 같은 터미널, 같은 URL).**
   - preflight에서 role은 PASS인데 read-only·timeout·search_path가 FAIL이면, Neon 경로가 startup parameter를 버린다는 뜻이다. 이때 원인 B가 FACT가 된다. 그러면 §7의 `options=-c …` 수정을 별도로 진행한다.
   - 모두 PASS면 원인 A 하나였던 것이다. 다음 예약 run의 Summary에 표가 나와야 한다.
3. **push 승인.** 1번이 끝난 뒤에 한다(§16). 다음 예약 run에서 사전 검사가 통과하는지 확인한다.
4. **job 771·978 재수집 여부.** 수정이 배포된 뒤 두 저장소를 다시 enqueue하려면 운영 DB에 써야 한다(denylist·queue 경로 사용). 운영자가 결정할 일이고, 수행하지 않았다.
5. **refresh 상한(보류, 측정 후).** 후보는 `maxRefreshPerSync` 100 → 150이다(drain 250, 추정 +170s).
   - 조건: 다음 4회 run의 drain 시간과 not-reached 기울기를 다시 잰 뒤, 가장 긴 run + 추정치가 1,900s 이하일 때.
6. **registry 일시 장애 정책(§10 제안).** `PARTIAL_SOURCE`를 도입할지는 2주 실적을 보고 결정한다.

## 18. PENDING/NOT RUN

| 항목 | 상태 | 이유 |
|---|---|---|
| Actions secret의 실제 role | PENDING | secret 열람 금지 |
| Neon 경로의 startup parameter 전달 여부(원인 B) | PENDING | 운영 DB 접속 금지. §17의 2번으로 확인 |
| 기존 테이블 소유자 / `agentdock_app` 권한 | PENDING | 운영 SQL 금지 |
| 운영 `checked_at` 분포(read-age 실측) | PENDING | 운영 SQL 금지 |
| 사례 D(pooled URL) 사전 검사 | NOT RUN | 로컬 pooler 없음 |
| 사례 D·E(fan-out·refresh stage 실패) 실제 실행 | NOT RUN | DB 오류를 주입해야 함. 코드 경로로만 판단 |
| 변경 코드의 운영 동작 | NOT RUN | 배포 금지 |
| Neon 리전 / R-1 (Phase 31) | PENDING | 이번 범위 밖, 승인 대기 그대로 |

## 19. Evidence ID

scratch 경로: `/tmp/claude-1000/-home-ChoiGwanghun-workspace-auto-agentdock/5f3bf29d-8c4e-417d-a177-083dcd61f8ca/scratchpad`

| ID | 내용 | 위치 |
|---|---|---|
| E-1 | storage_failed 재현: 22021, 실패한 INSERT | `p32/repro/out.txt`, `p32/repro/` |
| E-2 | NUL이 든 필드 목록 | 위 재현 출력(NUL_FIELD 줄) |
| E-3 | 운영 ops FAIL 6개 × 6회 | `p29/sync-39940525800.log`, `p32/sync-4*.log` |
| E-4 | 로컬 preflight: agentdock_app 7/7, superuser는 role만 FAIL | 이 보고서 §6, §8 |
| E-5 | Sync 사전 검사 A–H | `p32/precheck.txt` |
| E-6 | `errorCode` 재사용 뒤 F/B/A 재확인 | `p32/precheck2.txt` |
| E-7 | registry 실패 로컬 재현 | `p32/registry-fail.txt` |
| E-8 | search 실패 로컬 재현 | `p32/search-fail.txt` |
| E-9 | outcome별 job 소요 시간 | `p32/dur.py` 출력 (§12) |
| E-10 | 회귀 테스트 전 FAIL / 후 PASS | 이 보고서 §14 |
| E-11 | ci·build·e2e·eval 출력 | `p32/ci.txt`, `p32/build2.txt`, `p32/e2e.txt`, `p32/eval.txt` |
| E-12 | Neon proxy 전달 parameter 기록 | https://github.com/neondatabase/neon/issues/1287 |

## 20. Git Status

```
 M VERCEL_DEPLOY.md
 M scripts/corpus-sync.mjs
 M scripts/ops.mjs
 M src/db/client.ts
 M src/db/schema.ts
 M src/github/raw.ts
 M src/ingest/errors.test.ts
 M src/ingest/errors.ts
 M src/ingest/pipeline.test.ts
 M src/ingest/pipeline.ts
 M src/log.ts
?? docs/analysis/agentdock-phase32-34-sync-reliability.md
```

## 21. 권장 Commit 메시지

```
git commit -m "fix(sync): refuse a non-agentdock_app connection and store bodies with NUL

- corpus-sync runs assertSchemaIsolation before its first stage; a wrong
  role or search_path exits 1 with nothing read or written (six scheduled
  runs ingested while ops found the connection not agentdock_app)
- fetchRawFile replaces U+0000 with U+FFFD: PostgreSQL refused it (22021)
  and failed jobs 771/978 as storage_failed on every attempt
- storage_failed log lines carry the SQLSTATE (errorCode), never the message
- AGENTDOCK_ROLE defined once in schema.ts
- docs: Phase 32-34 report; VERCEL_DEPLOY.md sync pre-check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**push 전에 §17의 1번(secret 교체)을 먼저 끝내야 한다.**

## 22. 다음 작업 목록

1. secret 교체와 원인 B 확인(§17의 1·2번). 그 결과에 따라 `options=-c` 수정 여부를 정한다.
2. commit과 push. 다음 예약 Sync에서 사전 검사 통과, Summary 표시, `errorCode` 부재(정상)를 확인한다.
3. job 771·978을 다시 넣을지 결정한다(§17의 4번).
4. 4회 run 동안 refresh not-reached 기울기와 drain 시간을 다시 재고, 상한 제안 조건을 판정한다.
5. registry FAILED 비율을 2주 관찰한 뒤 `PARTIAL_SOURCE` 제안을 판단한다.
6. (Phase 31에서 이어짐) Neon 리전 확인 → R-1.
