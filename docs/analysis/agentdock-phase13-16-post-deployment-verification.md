# AgentDock Phase 13–16 — Post-Deployment Verification & Operational Readiness

작성 2026-10-23 12:30–13:10 KST · 기준 commit `a3efd289d73b80611269753285f2b616c786a949` (develop = origin/develop, working tree clean)

이번 작업은 검증만 했다. 코드, migration, Sync, 배포, workflow_dispatch는 실행하지 않았고 운영 DB에도 연결하지 않았다. 운영 서비스에는 약 70건의 읽기 전용 HTTP GET만 보냈고, 요청 사이에 0.5–0.7초 간격을 두었다. GitHub에는 `gh` CLI로 조회만 했다.

## 1. Executive Summary

배포·코드·화면 쪽은 기대한 상태와 일치한다.

| 확인 대상 | 결과 |
|---|---|
| Production 헤더 | `X-AgentDock-Commit: a3efd28` |
| origin/develop HEAD | `a3efd28` |
| 마지막 CI 성공 run | `a3efd28` |
| 마지막 Deploy run | `a3efd28` |
| artifact 수 | 홈, 목록, 유형별 합계, 최신 Sync 로그(`listed=7273`)가 모두 7,273으로 같다 |
| 검색·필터·정렬·페이지네이션·상세·404 | 의도한 대로 동작한다 |

운영 DB에 대한 내용은 아직 확인하지 못했다(PENDING).

- 읽기 전용 guard가 들어간 `ops:status`는 운영 DB에서 아직 한 번도 실행되지 않았다. sync.yml의 summary step을 포함해서다.
- 운영 데이터 품질 검사도 실행하지 않았다(NOT RUN).

Sync는 일하고 있지만 완전한 성공은 드물다.

- 최근 11회 중 GitHub Actions 결과는 success 8회, failure 3회다.
- failure 3회는 모두 **외부 MCP registry 장애**였고, 모두 06:00 UTC 회차였다.
- 내부 상태가 기록된 최근 3회는 `PARTIAL_CAP`, `FAILED`, `PARTIAL_CAP`이다. `COMPLETED`는 한 번도 없었다.

## 2. 최종 운영 안전성 판정

**CONDITIONAL — 서비스 운영은 정상. 운영 DB 검증은 PENDING.**

FAIL로 분류한 항목은 없다. 판정을 낮추는 이유는 확인하지 못한 항목 두 가지다(§13 E-12).

1. guard가 들어간 summary step이 운영에서 아직 실행되지 않았다.
2. Sync secret이 쓰는 DB role이 `agentdock_app`인지 직접 확인한 증거가 없다.

## 3. 검증 기준 Git SHA

| 항목 | 값 |
|---|---|
| 분석 기준 | `a3efd28` fix(ops): enforce read-only database checks and add preflight validation |
| 분석 시각 | 2026-10-23T12:30:42+09:00 |
| branch / 동기화 | develop, `origin/develop`과 동일, working tree clean |
| 직전 commit | `da0ddfb` (Phase 13–16 본체) |

## 4. Production 배포 상태

| ID | 결과 | 근거 | 관찰 |
|---|---|---|---|
| E-01 | PASS | `curl -sI https://agentdock-delta.vercel.app/` | `x-agentdock-commit: a3efd289…` — origin/develop, Deploy run 39894320046, CI run 39894195326과 같다 |
| E-03 | PASS | Deploy 39894320046 (workflow_run, 03:18:40→03:20:23Z) | `gate: DEPLOY — sha a3efd28, develop at a3efd28, production serves da0ddfb`. migration plan은 `11 applied, 0 pending, 11 on disk — UP_TO_DATE`이고 apply는 "already up to date", `--require-current`는 UP_TO_DATE. Vercel deploy에 이어 smoke 11개 경로가 모두 ok, `identity a3efd28`, `smoke: PASS` |
| E-04 | PASS | HTTP GET | 아래 표 참고 |
| E-05 | WARNING | 같은 경로 연속 측정 | `/` 첫 응답 7.5초, 2.9초, 이후 1.0초 → cold start(§13) |

E-04 상세:

| 대상 | 결과 |
|---|---|
| `/`, `/artifacts`, `/artifacts?q=mcp` | 200 |
| 존재하지 않는 경로, `/r/<없는 owner>/<repo>`, `/r/…/no/such/file.md`, `/jobs/abc`, `/jobs/999999999` | 404 (Next의 `NEXT_HTTP_ERROR_FALLBACK;404`, 서버 오류 아님) |
| `/r/…/%00` | 400 |
| `/skills` | 308 |
| `/_next/static/immutable/*` | 200, `public,max-age=31536000,immutable` |
| 응답 헤더 | CSP(nonce, `strict-dynamic`, `frame-ancestors 'none'`), HSTS preload, `nosniff`, Referrer-Policy, Permissions-Policy 모두 있음 |
| `robots.txt`, `sitemap.xml` | 404. 저장소에 구현이 없으므로 의도된 상태다 |

Deploy run 목록에서 `6dcd1c9`(39748196862)의 skipped는 해당 CI 39748062131이 실패했기 때문이다. 원인은 e2e job의 포트 55432 충돌이었고, `34a7561`에서 loopback 바인딩으로 고쳤다. 이 skip은 gate가 설계대로 동작한 결과다.

## 5. GitHub Actions CI 결과

CI 39894195326 (push, `a3efd28`, 03:17:16→03:18:37Z) — **PASS**, E-02.

| job | 결과 | 핵심 증거 |
|---|---|---|
| check | success | build에 이어 `bun run ci`: 1069 passed / 400 skipped (DB 없음). `readOnly.test.ts` 17개 중 8개 skip |
| database | success | `bun run test`: **1466 passed / 3 skipped** (1469). `src/db/readOnly.test.ts (17 tests) 2490ms` 전부 통과 |
| database / ops step | success | preflight 7개 항목 모두 PASS(`10 of 10 pool connections`, `expected 25006, got 25006`), `preflight passed`. status는 빈 schema라 `UNKNOWN — no scheduled sync has recorded a run`으로 설계대로 나왔다. quality는 `No rule violated · 20 checks in 28 ms` |
| e2e | success | Playwright journeys `25 passed (21.5s)`. 실패 시에만 동작하는 upload step 1개가 skipped(정상) |

최근 15회 CI 중 실패는 6dcd1c9 1회뿐이다(위 원인). 0602d99의 2회 실행은 같은 push 이벤트가 중복 기록된 것으로, ci.yml 주석에 이미 분석돼 있고 concurrency로 해소했다.

## 6. Neon DB Read-only Safety

호출 순서는 `scripts/ops.mjs` 기준이다.

1. mode 검증
2. `--production`이면 `productionTargetRejection`: loopback·`-pooler` 거부, fingerprint pin 일치 확인
3. `readOnlyTarget`: URL 형식 확인, `-pooler` 거부, startup parameter 4개 덧붙임
4. `client.ts` import (pool max 10)
5. `readOnlyChecks`

`readOnlyChecks`가 확인하는 항목:
- pool 연결 10개를 동시에 붙잡고 pid가 10개인지 확인한다.
- 각 연결에서 default/transaction read-only, `statement_timeout` 30 s, `current_user = agentdock_app`, `search_path = agentdock`을 확인한다.
- `CREATE TEMP TABLE` probe가 25006으로 거부되는지 본다.
- 하나라도 실패하면 아무것도 읽지 않고 exit 2다.
- 오류는 code만 출력한다(`ops.mjs:167-172`).

| 항목 | 결과 | 근거 |
|---|---|---|
| guard 로직, 회귀 테스트 | PASS | 로컬과 CI database job에서 17/17 |
| CI의 end-to-end wiring | PASS | CI 39894195326 ops step |
| **probe의 TEMP 권한 의존성** | PASS (직전 보고 정정) | 로컬 test DB에서 rollback되는 transaction 안에서 확인했다. `TEMPORARY` 권한이 없는 role로 쓰기 가능 상태에서는 `42501 … InitTempTableNamespace`가 나오고, read-only에서는 `25006 … PreventCommandIfReadOnly, utility.c:407`가 나온다. read-only 검사가 권한 검사보다 먼저이므로 운영 role에 TEMP 권한이 없어도 probe는 PASS다. 직전 보고의 "42501로 FAIL 가능" 우려는 근거가 없다 |
| 운영 DB에서의 preflight | **PENDING** | 미실행(§16) |

## 7. Corpus Quality Rules (`src/db/queries/quality.ts`)

20개 rule(위반 7, 관찰 13)이 `Promise.all`로 병렬 실행된다. 동시 연결은 pool max 10을 넘지 않는다.

- 각 rule은 window 함수로 전체 count를 구한 뒤 `collate "C"` 순서로 sample 5개를 뽑는다. 쿼리 하나로 처리하므로 N+1이 없다.
- 직전 측정(2026-10-22, 합성 데이터 10k): quality 전체 461 ms, status 52 ms. `statement_timeout` 30 s 대비 약 65배 여유가 있다.
- 출력에 포함되는 것은 공개 GitHub 저장소의 `owner/repo`, 파일 경로, content hash 앞 12자, 상태 문자열이다. secret이나 연결 정보는 없다.
- sync.yml의 공개 run summary에는 quality가 아니라 `ops:status --markdown`만 붙는다. 여기에는 count와 status만 있다.

### 위반(기대값 0, 하나라도 있으면 exit 1)

| Rule ID | 의미 / 데이터 영향 | 검출 기준 | 예상 원인 | 심각도 | 권장 조치 | 비용 |
|---|---|---|---|---|---|---|
| package-without-version | 목록에 나오는 artifact의 상세 페이지가 404 | live package에 version 행이 없음 | persist 도중 중단, 수동 삭제 | High | 해당 저장소 재수집 대상으로 확인 | package 전체 scan + `package_version_recent_idx` |
| parent-plugin-missing | plugin 관계 링크가 깨짐 | `parent_path`가 있는데, 전체를 읽은(tree_truncated=false) 저장소에 해당 plugin 행이 없음 | nesting 로직 회귀 | Medium | 재현 저장소 확보 후 테스트 추가 | `package_identity` index |
| source-path-shape | permalink 오류, 경로 조작 흔적 | 빈 값, 절대경로, `.`/`..`, `//`, 끝의 `/`, 역슬래시, 제어문자 | 수집 정규화 회귀 | High | 즉시 조사 | regex full scan (수천 행) |
| blank-name | 검색·링크 불가 | name 또는 slug가 공백 | frontmatter 파싱 회귀 | Medium | 파서 테스트 | full scan |
| finding-commit-mismatch | provenance 불일치("exact or absent" 위반) | finding의 commit_sha가 그 version의 것과 다름 | 분석 저장 순서 회귀 | High | 즉시 조사 | capability_finding 전체 join (가장 큰 테이블로 추정) |
| artifacts-without-read-date | read 날짜·sha 없이 노출 | live artifact가 있는 저장소에 `scanned_at` 또는 `last_ingested_sha`가 null | finishJob 경로 누락 | Medium | 해당 경로 테스트 | repository scan + EXISTS |
| listing-counts-agree | 화면마다 총수가 다름 | 홈, 빈 검색, 유형 합계가 서로 다름 | `NOT_LISTED_BECAUSE` 공유가 깨짐 | High | 즉시 조사 | count 3회 |

### 관찰(허용되는 사실, exit code에 영향 없음)

| Rule ID | 의미 | 기준 | 해석 / 후속 |
|---|---|---|---|
| parent-plugin-not-read | 부분 읽기 저장소에서 plugin manifest를 못 읽음 | tree_truncated인 저장소의 고아 parent_path | 저장소 크기 상한의 결과. 수가 늘면 상한 재검토 |
| not-listed | 보유했지만 목록에 안 나오는 행, 사유별 | `NOT_LISTED_BECAUSE` | 최신 Sync 기준 held 8,846 − listed 7,273 = 1,573. 운영 값은 미확인 |
| same-content-other-repositories | 같은 내용이 여러 저장소에 있음 | latest content hash 중복(shape-only 제외) | 중복 억제의 입력. 오류 아님 |
| same-name-other-repositories | 같은 유형·이름이 여러 저장소에 있음 | type+lower(name) | 병합하지 않는 정책 |
| read-age | 마지막 읽기 경과 구간별 분포 | scanned_at 버킷 | refresh 적체 판단에 필요(§10) |
| not-read-recently | N일(기본 14) 이상 읽지 않음 | scanned_at < now − N | 위와 같음 |
| checks-failing | 연속 확인 실패 | check_failures > 0 | backoff 대상. artifact는 계속 노출 |
| partial-reads | tree/file 상한에 걸림 | tree_truncated | 상한 정책의 결과 |
| delisted | 이후 읽기에서 사라진 artifact | delisted_at not null | 최신 Sync에서 8건 delist |
| latest-parse-status | 최신 version의 parse 상태 분포 | parse_status | failed는 목록에서 제외 |
| latest-not-analyzed | 분석되지 않은 최신 version | analyzed_at null | capability 필터에서 빠짐(관찰 범위 정책) |
| failed-jobs | 실패로 끝난 job, 마지막 outcome별 | status='failed' | Sync "Could not be read" 수와 대조 |
| retries-exhausted | 재시도 소진 | attempts ≥ MAX_ATTEMPTS | 반복되는 저장소는 denylist 후보 |

`latest()`는 package마다 correlated subquery를 쓰지만 `package_version_recent_idx (package_id, ingested_at desc)`로 한 번의 index probe가 된다. 조회 대상은 package 약 9k 행이다. 운영 규모에서 timeout이 날 경로는 확인되지 않았다.

## 8. 운영 데이터 검증 상태

**NOT RUN.** 운영 DB 승인 전이라 실행하지 않았다. 로컬 e2e seed 결과는 운영 데이터가 아니므로 여기에 옮기지 않는다.

운영 데이터에 대해 간접적으로 확인한 것은 공개 화면과 Sync 로그의 count뿐이다(§12).

## 9. Sync Health

### 9.1 sync.yml 설정

| 항목 | 값 | 평가 |
|---|---|---|
| schedule | `0 6,18 * * *` + workflow_dispatch | — |
| permissions | contents: read | PASS |
| concurrency | `sync`, cancel-in-progress=false | PASS |
| timeout | 60 min (drain deadline 35 min) | PASS. 최장 39 min |
| environment | 없음. 저장소 수준 secret `DATABASE_URL`, `AGENTDOCK_GITHUB_TOKEN` | 아래 참고 |
| schema gate | `migrate.mjs --plan --require-current` (`--production` 없음, fingerprint 미검사) | WARNING(정보): Sync는 fingerprint pin을 쓰지 않는다 |
| health summary | `ops:status --markdown`, `if: !cancelled()`, continue-on-error | PENDING(E-12) |
| 실패 알림 | GitHub 기본 알림(run 실패)만 있음 | 정보 |

**direct endpoint 근거.** Deploy job의 `migrate.mjs --plan --production`은 `productionTargetRejection`을 거치고, 이 함수는 loopback·`-pooler`를 거부하고 fingerprint 일치를 확인한다. Deploy는 Sync와 같은 저장소 수준 secret `DATABASE_URL`을 쓴다(production environment에는 `VERCEL_TOKEN`만 있다). 이 step이 run 39894320046에서 통과했으므로 **Sync가 쓰는 secret도 direct이고 pin된 대상**이다. 값은 조회하지 않았다.

### 9.2 최근 실행 전체(11회, 확인 가능한 전체 범위)

| run | event | sha | 시작(UTC) | 예약 대비 지연 | 소요 | Actions | 내부 Status | drain | 남은 queue | refresh not-reached | listed/held | deadline |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 39853119505 | schedule | 3a8a3c3 | 10-22 20:56 | +176m | 23m | success | PARTIAL_CAP | 200/200 | 1 | **43/100** | 7273/8846 | 아니오 |
| 39765655496 | schedule | 3a8a3c3 | 10-22 10:46 | +286m | 17m | failure | FAILED (registry 500) | 147/200 | 0 | 0 | 6150/7457 | 아니오 |
| 39716460966 | dispatch | 0602d99 | 10-22 03:22 | — | 21m | success | PARTIAL_CAP | 200/200 | 6 | 0 | 4793/5898 | 아니오 |
| 39706897344 | dispatch | 28730e9 | 10-22 01:38 | — | 38m | success | (기록 이전) | 107/200 | 106 | 0 | 2609/3384 | 예 |
| 39674909791 | schedule | 57c7c54 | 10-21 20:58 | +178m | 35m | success | (기록 이전) | 90/200 | 86 | 0 | 1959/2464 | 예 |
| 39586894653 | schedule | 57c7c54 | 10-21 10:45 | +285m | 39m | failure | registry unreachable | 32/200 | 76 | 0 | 1243/1473 | 예 |
| 39496498882 | schedule | 77e7184 | 10-20 20:58 | +178m | 5m | success | — | 25/25 | — | 0/25 | 108/130 | 아니오 |
| 39408723010 | schedule | 77e7184 | 10-20 10:32 | +272m | 2m | failure | registry unreachable, 전체 중단 | — | — | — | — | — |
| 39330405747 | schedule | 28639ec | 10-19 21:48 | +228m | 5m | success | — | 25/25 | — | 0/25 | 108/130 | 아니오 |
| 39245937874 | schedule | 28639ec | 10-19 11:37 | +337m | 6m | success | — | 25/25 | — | 0/25 | 108/130 | 아니오 |
| 39207068461 | dispatch | de79558 | 10-19 05:55 | — | 6m | success | — | 25/25 | — | 0/25 | 108/130 | 아니오 |

- 모든 run에서 rate limit으로 미룬 job은 0건이다. 최신 run의 GitHub core 사용량은 421/5000이다.
- 내부 Status가 기록되기 시작한 것은 `0602d99`(sync-status-semantics)부터다.
- **Actions success와 내부 상태가 다르다.** success인 run 2회는 모두 PARTIAL_CAP이고, `COMPLETED`는 0회다.
- 11회 모두 "Sync health summary" step이 없다. 이 step은 `da0ddfb`에서 추가됐는데, 그 뒤로 Sync가 실행되지 않았다.

### 9.3 오류 처리 검토

| 항목 | 결과 |
|---|---|
| registry 실패 | 10-20에는 run 전체가 중단됐다(2분). 10-21 이후는 해당 stage만 FAILED이고 나머지 stage는 계속 실행돼 exit 1. 설계(decision phase2-last-sync-copy)대로다 |
| `sync:last_success` | 홈의 "last sync without errors 2026-10-22 21:20 UTC"가 run 39853119505 종료(21:20:06Z)와 일치. PASS |
| PARTIAL/DEGRADED | `syncHealth`에 따르면 마지막 run이 FAILED이면 DEGRADED, PARTIAL_*이면 PARTIAL, COMPLETED이면 OK다. 현재 패턴이 계속되면 **OK가 나오지 않는다**(E-17) |
| queueDepth | `since the previous run +1 (was 0)`. 직전 run과의 비교가 동작한다. PASS |
| continue-on-error | summary가 실패해도 job은 green이고 step에만 경고가 남는다. 상태를 가리는 대상은 보고서뿐이고 Sync 결과는 가리지 않는다. 대신 실패가 알림 없이 묻힐 수 있다(E-13) |
| schema mismatch | `--require-current`가 Sync보다 먼저 실패한다. 최근 2회 통과 |
| DB 연결 실패 | sync는 exit 1(red)이고, summary는 exit 2로 끝나며 표를 붙이지 않는다 |

## 10. Backlog 및 Rate Limit

- **drain backlog:** 해소됐다. 남은 queue는 76 → 86 → 106 → 6 → 0 → 1이다. 0602d99의 batched persist 이후 drain deadline에 걸리지 않는다. throughput은 약 13.5–14 jobs/min이다.
- **refresh 적체 시작(E-11):** 최신 run에서 처음으로 `considered=100 … not-reached=43 (cap 100)`이 나왔다. 재확인 대상 143개 중 43개를 다음 run으로 넘긴 것이다. 보유 artifact가 하루 사이 5,898에서 8,846으로 늘면서, 하루 2회 × 100개인 refresh 용량에 처음 닿았다.
- **discovery cap:** 매 run 출력된다. registry는 page cap 40, links는 `over-list-cap=3389`다. "Every cap says what it dropped" 불변식을 지킨다. PASS.
- **rate limit:** 문제없다. deferred 0, core 사용량 8% 수준이다.
- **예약 지연:** 시작이 매번 예약보다 +176분에서 +337분 늦다. 36시간 stale 기준 안이라 판정에는 영향이 없다.

## 11. 검색 E2E 결과 (운영, 읽기 전용 GET)

| 영역 | 결과 | 관찰 |
|---|---|---|
| 검색 | PASS | skill 215쪽, plugin 93쪽, mcp 54쪽, claude 155쪽, playwright 2쪽. 정확한 이름 `writing-hookify-rules`는 해당 skill 2개(원본과 미러)를 맨 위에 보여준다 |
| 빈 결과 | PASS | `zzqxvqqk`이면 "No artifacts matched" |
| 일부 단어만 일치 | PASS(설계) | `zzqxv-nonexistent-term`이면 "No artifact matched every word; these match at least one."과 함께 105건. 대체 결과임을 화면에 밝힌다 |
| 특수문자, 600자 | PASS | `'"<>%_\&;--`는 빈 결과, 200, 제목에 텍스트로 표시. 600자 질의는 200. `c++`는 58건 |
| 유형 필터 | PASS | skill 4,652 / plugin 632 / mcp_server 140 / command 1,003 / hook 109 / agent 737. 홈 카드와 같다 |
| 질의와 유형 조합 | PASS | `q=mcp&type=mcp_server`는 140건, 제목은 "in MCP Servers" |
| capability 필터 | PASS | no_network 5,346 / no_shell 5,096 / no_scripts 4,251. skill+no_network+no_shell은 4,024. 화면에 관찰 범위와 대상 유형이 고지된다 |
| 정렬 | PASS | recent/added/changed/name 모두 1쪽과 2쪽이 각 25건이고 겹침 0. name은 1–2쪽 순서가 정렬돼 있다 |
| 페이지네이션 | PASS | 2쪽, 291쪽(23건 = 7273 − 290×25), 292쪽은 "There is no page" |
| 잘못된 값 | PASS | `type=bogus`, `cap=bogus`, `sort=bogus`, `page=abc`, `page=999999`는 기본값으로 대체돼 200 |
| 상세 6유형 | PASS | 이름, 유형, 저장소, 경로, "Last read by AgentDock", Versions 표, commit 고정 링크(blob/commits/tree) 확인 |
| permalink | PASS | 아래 참고 |

permalink 확인 내용:
- 저장소 페이지는 `At commit 465f093`, 21:19 UTC에 읽었다고 표시한다.
- artifact 링크는 그 내용이 처음 기록된 commit을 가리킨다(`d1adba4`, `af59ee3`).
- GitHub API로 비교했다. `d1adba4`와 `465f093`에서 SKILL.md, plugin.json, hooks.json의 blob sha가 같았고, `af59ee3`과 `d1adba4`에서 agent 파일의 blob sha가 같았다.
- 따라서 링크가 가리키는 내용과 마지막으로 읽은 내용이 일치한다.

참고: `type=bogus`는 noindex 없이 `/artifacts`와 같은 화면을 보여준다. `page=999999`(maxPage 10,000 초과)는 1쪽으로, `page=292`는 "no page"로 처리된다. 둘 다 zod `.catch`의 설계 동작이고 피해가 없어 조치하지 않는다.

### 기존 자동화와 부족한 부분

CI e2e journeys 25개가 검색, 유형, capability 필터, 정렬, 페이지네이션, 상세, 잘못된 파라미터, 모바일을 이미 검증한다. 다만 대상은 fixture seed다. 운영을 대상으로 하는 자동 확인은 Deploy smoke 11개 경로의 status code와 identity뿐이다.

부족한 부분(후속 후보, 이번에는 수정하지 않았다):
1. smoke에 상세 페이지 1개(200)와 없는 artifact(404) 확인이 없다.
2. smoke가 홈 총수와 유형별 합계의 일치를 보지 않는다. quality의 listing-counts-agree가 DB 쪽에서 같은 것을 확인한다.

## 12. Artifact Count 정합성

| 출처 | 값 |
|---|---|
| 홈 총수 | 7,273 |
| 유형 카드 합계 | 4,652 + 632 + 140 + 1,003 + 109 + 737 = 7,273 |
| `/artifacts` | 7,273, 291쪽 |
| 최신 Sync 로그 | `listed=7273 of held=8846` |
| 2026-10-23 사전 관찰 | 7,273 / 291쪽 — 이후 Sync가 없어 같다 |

모두 일치한다. PASS(E-06). DB 쪽 확인(quality listing-counts-agree)은 NOT RUN이다.

## 13. 발견된 문제 목록

| ID | 분류 | 심각도 | 근거 | 관찰 | 기대 | 재현 | 영향 | 권장 조치 |
|---|---|---|---|---|---|---|---|---|
| E-12 | PENDING | P1 | sync run 11회의 step 목록, sync.yml:83-91, `client.ts:48`의 role 확인은 웹(`instrumentation.ts`)에서만 호출 | guard가 들어간 summary가 운영에서 한 번도 실행되지 않았다. direct secret의 role이 `agentdock_app`인지 확인한 증거가 없다. 웹은 pooled URL로 기동 시 role을 확인하지만 Sync와 migrate는 확인하지 않는다 | summary step이 표를 붙인다 | 다음 예약 Sync run 페이지 → "Sync health summary" step | role이 다르면 `ops: FAIL connected as agentdock_app`이 나와도 continue-on-error로 green에 묻히고, 수동 `--production` 실행도 거부된다 | 다음 Sync 후 step 결과와 summary 표를 확인한다(§16) |
| E-10 | WARNING | P1 | runs 39408723010, 39586894653, 39765655496 | registry 장애로 3/11이 FAILED. **세 번 모두 06:00 UTC 회차**(실제 시작 10:32–10:46 UTC) | 외부 일시 장애가 드물게 발생 | 위 run 로그의 `stage=registry FAILED` | 그 run은 red가 되고 last_success가 갱신되지 않으며 health는 DEGRADED. 같은 시간대에 반복되면 하루 걸러 DEGRADED가 되어 신호 가치가 떨어진다 | 다음 2–3회 06:00 회차를 관찰한다. 반복되면 registry stage 실패의 분류(FAILED 대 PARTIAL)를 결정 사항으로 재검토한다. 시간대가 원인이라는 것은 가설이다 |
| E-11 | WARNING | P2 | run 39853119505 `not-reached=43 (cap 100)` | refresh 대상이 처음으로 상한을 넘었다 | not-reached 0 유지 | 같은 로그 | 재확인 주기가 늘어난다. 서비스 영향은 없다 | 다음 run들의 not-reached를 추적한다. 운영 DB 승인 후 quality read-age와 not-read-recently로 규모를 확인한다 |
| E-17 | WARNING | P2 | `health.ts:96-103`, §9.2 | Status 기록 이후 COMPLETED가 0회다. drain cap 200에 매번 닿아 PARTIAL_CAP이 사실상 기본 상태다(로그 기반 추론, 운영 `ops:status` 미실행) | 성장기가 끝나면 COMPLETED | §9.2 | health가 OK를 거의 보여주지 않는다 | corpus 성장이 둔화된 뒤에도 PARTIAL_CAP이면 drain cap을 재검토한다. 지금은 조치하지 않는다 |
| E-05 | WARNING | P2 | curl 측정 | `/` 첫 요청 2.7–7.5초, warm 약 1.0초. `cache-control: private, no-store`, `x-vercel-cache: MISS` | — | `curl -w '%{time_starttransfer}'` 3회 | 첫 방문자 체감 지연 | 관찰만 한다. 동적 렌더링은 설계 선택이다 |
| E-13 | WARNING | P2 | sync.yml:89 | summary 실패는 step 경고로만 남는다 | — | — | E-12와 함께 묻힐 수 있다 | E-12 확인으로 충분하다. 알림 추가는 반복될 때 검토한다 |
| E-15 | WARNING | P3 | 모든 run의 `##[warning]Node.js 20 is deprecated … actions/checkout@v4` | 이미 Node 24로 강제 실행 중 | — | run annotation | 향후 Node 20 제거 시 영향 가능 | checkout과 cache action을 Node 24 대응 버전으로 올리는 것을 별도 작은 변경으로 진행 |
| E-18 | WARNING | P3 | VERCEL_DEPLOY.md:75 | Step 2에 "PENDING — not yet run against Neon"이 남아 있다. 운영 웹이 `agentdock_app` role 확인을 거쳐 기동하므로 bootstrap은 끝난 것으로 보인다(추론) | 문서가 현재 상태와 일치 | 문서 읽기 | 운영자 혼동 | 사용자가 확인한 뒤 문서를 갱신한다(이번 작업 범위 밖) |
| E-16 | 정정 | — | 로컬 test DB 실험(§6) | 직전 보고의 "TEMP 권한이 없으면 probe 42501" 위험은 없다 | — | §6 | — | 잔여 위험 목록에서 삭제 |

FAIL로 분류된 항목은 없다.

## 14. P0 / P1 / P2 우선순위

- **P0:** 없음.
- **P1:**
  - E-12: 다음 예약 Sync의 summary step을 확인한다. role 확인을 겸한다.
  - E-10: 06:00 회차 registry 실패가 반복되는지 관찰한다.
- **P2:** E-11 refresh 적체 추적, E-17 PARTIAL 상시화, E-05 cold start, E-13 summary 실패 가시성.
- **P3:** E-15 action 버전, E-18 문서 상태.

## 15. 미검증 항목

| 항목 | 상태 |
|---|---|
| 운영 `ops:preflight --production` / `ops:status` / `quality:check` | PENDING (승인 필요) |
| guard가 들어간 sync summary의 운영 실행 | PENDING (다음 예약 Sync) |
| direct secret의 role이 `agentdock_app`인지 | UNKNOWN → PENDING |
| 운영 quality rule 결과(violation 0 여부, read-age 분포) | NOT RUN |
| 운영 대상 브라우저 E2E(Playwright) | NOT RUN. HTTP GET과 HTML 파싱으로 대체했다. 클라이언트 동작(단축키, 복사 버튼)은 CI journeys로만 확인됨 |
| 06:00 회차 registry 실패의 원인 | UNKNOWN (가설: 시간대) |

## 16. 운영 DB 승인 필요 사항

**권장 순서:** 먼저 다음 예약 Sync의 "Sync health summary" step을 확인한다. Actions secret으로 같은 guard를 실행하므로 로컬에서 secret을 다룰 필요가 없다.

- step이 success이고 표가 붙었으면, 운영 DB에서 7개 항목이 모두 통과한 것이다.
- `ops: FAIL …`이 나오면 그 줄이 원인이다. 예를 들어 role이 다르다는 줄이면 E-12가 확정된다.

수동 실행이 필요할 때의 내용:

| 항목 | 내용 |
|---|---|
| 대상 | Neon 운영 DB, direct endpoint(§9.1의 근거). schema `agentdock` |
| fingerprint | production environment 변수 `AGENTDOCK_TARGET_FINGERPRINT` 설정됨(16자). 값은 보고서에 옮기지 않는다 |
| 명령(저장소 루트, zsh) | 아래 코드 블록 |
| 출력 | preflight: PASS/FAIL 7줄. status: count와 상태(저장소 이름 없음). quality: 공개 저장소 `owner/repo`·경로 sample, 규칙별 count. URL, host, 비밀번호는 출력되지 않는다(오류도 code만) |
| 부하 | 연결 10개를 약 0.1초 동안 사용. status는 약 50 ms, quality는 쿼리 20개로 약 0.5초(10k 측정). 모두 read-only이고 statement당 30 s 상한 |
| 중단 조건 | 연결 전 거부(exit 2), preflight에 FAIL이 하나라도 있음, `could not read`(exit 2). 어느 경우든 이후 명령을 실행하지 않는다. quality exit 1은 보고만 하고 수정하지 않는다 |

```zsh
cd ~/workspace_auto/agentdock
read -rs "DATABASE_URL?Neon direct URL: "; echo; export DATABASE_URL DATABASE_SCHEMA=agentdock
export AGENTDOCK_TARGET_FINGERPRINT=<production environment 변수 값>
bun --no-env-file scripts/ops.mjs preflight --production && \
bun --no-env-file scripts/ops.mjs status --production && \
bun --no-env-file scripts/ops.mjs quality --production
unset DATABASE_URL DATABASE_SCHEMA AGENTDOCK_TARGET_FINGERPRINT
```

## 17. 다음 2차 고도화 권장 범위

실제 관찰에 근거한 것만 적는다.

1. **(관찰 후 결정)** registry stage 실패의 분류. E-10이 반복될 때만 진행한다.
2. **(관찰 후 결정)** refresh cap(100)과 drain cap(200). E-11·E-17 추세와 운영 read-age를 확인한 뒤에 정한다.
3. **(작은 변경)** Deploy smoke에 상세 페이지 200과 없는 artifact 404를 추가한다(§11).
4. **(작은 변경)** GitHub Actions의 Node 24 대응 버전(E-15), VERCEL_DEPLOY.md Step 2 상태 갱신(E-18).

## 18. 최종 Git Status

이번 작업에서 저장소에 생긴 변경은 이 보고서 파일 하나다(untracked). 코드, workflow, 테스트는 변경하지 않았다.
