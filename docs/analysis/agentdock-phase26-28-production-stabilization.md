# AgentDock Phase 26–28 — Prepared Statement 운영 검증, Sync 확인, DB 리전·실행계획

- 작성: 2026-10-23 (운영 측정 07:38–07:44 UTC, 로컬 측정 07:45–08:10 UTC)
- 기준: 로컬 HEAD = origin/develop = 운영 배포본 = `24097f4`
- 이전 보고서: [Phase 17–19](agentdock-phase17-19-discovery-quality-search.md) · [Phase 20–22](agentdock-phase20-22-operations-performance-experience.md) · [Phase 23–25](agentdock-phase23-25-production-sync-performance.md)
- 하지 않은 것: 운영 DB 접속, 운영 DB DDL/DML·`ALTER ROLE`, 수동 Sync·workflow_dispatch, Vercel/Neon 설정 변경, migration, 배포, commit/push.
- 운영에 보낸 요청: 읽기 전용 GET 약 110회, Vercel 로그 조회 7회(개인 계정 CLI, 읽기 전용).
- 표기: **FACT**는 이번에 실측한 값, **INFERENCE**는 실측에서 끌어낸 해석, **PENDING**은 확인하지 못한 항목이다.

## 1. 핵심 결론

1. **배포는 정상이다(FACT).**
   - SHA 5곳이 `24097f4`로 일치한다.
   - 운영 smoke 30회는 모두 기대한 상태 코드였고, 배포 이후 error·warning·5xx 로그는 0건이다.
2. **prepared statement는 운영에서 동작하고, 응답이 빨라졌다(FACT).**
   - 동일 조건으로 쟀다.
   - 저장소 페이지 TTFB p50: 2,756 → 1,207ms
   - 상세: 1,258 → 1,026ms
   - 홈: 876 → 704ms
   - DB를 쓰는 404: 778 → 556ms
   - 서버 측 `node.js` 검색 시간: 약 1,133 → 686ms
   - 검색 결과 수는 고정 검색어 8개 모두 같다.
3. **P-2에 결함 하나가 남아 있었고, 이번에 고쳤다(FACT, 로컬).**
   - prepared 문장이 5회 실행 뒤 generic plan으로 바뀌면 검색의 `to_tsquery('english', $1)`가 상수로 접히지 않는다. 그래서 행마다 다시 계산된다.
   - 50k에서 `node.js` count가 29ms에서 102ms가 됐다.
   - 이전 단계에서는 이 비용을 role 설정(`plan_cache_mode`)으로 막으려 했다. 이번에는 tsquery를 스칼라 서브쿼리로 감싸 코드에서 원인을 없앴다(102 → 26ms).
   - 그래서 **운영 `ALTER ROLE`이 더 이상 필요 없다.** bootstrap SQL의 해당 줄도 지웠다.
4. **Sync 관련 항목(D-1, C-1, O-2, O-3)은 모두 PENDING이다.**
   - 배포(05f5e57 이후) 뒤 예약 Sync가 0회다. 마지막 실행은 39853119505(2026-10-22 20:56Z)다.
   - 06:00 UTC 회차는 최근 사흘 모두 10:32–10:46Z에 시작했다. 이번 작업 종료 시점(08:1x Z)까지 시작하지 않았다.
5. **Neon 리전은 PENDING이다.**
   - 확인할 수단이 없었다. Neon CLI가 없고, Actions 로그에 단서가 없으며, 연결 문자열은 열람 금지다.
   - 추정하지 않았다.

## 2. Phase별 판정

| Phase | 판정 | 근거 |
|---|---|---|
| 26 Prepared Statement 운영 검증 | **PASS** | SHA 일치, smoke 30/30, 로그 오류 0, TTFB 개선, 검색 결과 동일 |
| 27 Discovery/Sync 효과 | **PENDING** | 배포 이후 예약 Sync 0회. 상한은 NO CHANGE |
| 28 리전·실행계획 | **CONDITIONAL** | generic plan 결함을 재현·수정·검증했다(로컬 PASS). 운영 효과와 Neon 리전은 PENDING |

## 3. 기준 Git SHA

| 항목 | 값 |
|---|---|
| 로컬 HEAD | `24097f4e17407927e69f0dfa95df2c096492863d` |
| origin/develop | 같음 |
| 작업 시작 시 working tree | clean |
| 마지막 성공 CI | 39917567535 (push, `24097f4`, 07:24–07:26Z) |
| 마지막 성공 Deploy | 39917703905 (workflow_run, `24097f4`, 07:26–07:28Z) |
| 운영 `X-AgentDock-Commit` | `24097f4…` (07:38Z) |
| 운영 deployment | `dpl_2h83gQqt14Hr5VRVEHetW6NCeUHE` (로그의 deploymentId) |
| 마지막 Sync | 39853119505 (schedule, `3a8a3c3`, 2026-10-22 20:56–21:20Z) |

## 4. 운영 Deploy 검증 (FACT, E-01·E-02)

5개 SHA가 모두 일치한다. 응답 헤더 `x-vercel-id: icn1::iad1::…`로 함수 리전이 iad1임을 확인했다.

10개 경로를 각 3회, 1초 간격으로 요청했다(E-02).

| 경로 | 상태 | 비고 |
|---|---|---|
| `/` | 200 ×3 | title·h1 정상 |
| `/artifacts`, `?q=node.js`, `?q=review`, `?type=hook` | 200 ×3 | |
| `/r/anthropics/skills/skills/pdf` | 200 ×3 | |
| `/r/anthropics/skills` | 200 ×3 | |
| `/r/nobody/nothing` | 404 ×3 | `Not found — AgentDock` |
| `/r/anthropics/skills/skills/no-such-artifact` | 404 ×3 | |
| `/r/Anthropics/Skills/skills/pdf` | 308 ×3 | 정규 주소로 이동 |

- 404 본문의 `digest`는 Next가 `notFound()`에 넣는 `NEXT_HTTP_ERROR_FALLBACK;404`다. 오류가 아니다.
- 본문에서 `Application error`, `Internal Server Error`, `prepared statement`, `26000` 문자열은 0건이다.

## 5. Prepared Statement 호환성 (D)

| 질문 | 결과 | 근거 |
|---|---|---|
| `unsafe()`에 `prepare:true`가 전달되는가 | 그렇다 (FACT) | `client.test.ts`의 spy 테스트, 운영 서버 측 시간 감소 |
| 명시적 `prepare:false`를 보존하는가 | 그렇다 (코드) | `{ prepare: true, ...options }`에서 호출자 값이 뒤에 온다. Drizzle 0.45.2는 options를 넘기지 않는다(`session.js:33,43,65,103,106`) |
| transaction과 연결 수명주기 | 문제 없음 (코드·테스트) | `db.transaction`은 `this.client.begin()` 콜백에 새 client를 준다. 그 client는 Proxy를 거치지 않으므로 prepare가 꺼진 기본값을 쓴다. 해당 호출부는 `jobs.ts:191,231`, `persist.ts:70,487`, `reanalyze.ts:41`이다. CI 테스트 1,489개가 통과했다 |
| Drizzle 호출 경로 | 모두 `client.unsafe(query, params)` | `node_modules/drizzle-orm/postgres-js/session.js` |
| statement 이름 충돌 | 없음 (코드) | 이름은 연결마다 무작위 id에 번호를 붙여 만들고, 재연결하면 캐시와 함께 초기화된다(`postgres/src/connection.js:87-88,241,366-370`). PgBouncer는 서버 쪽에서 자체 이름으로 바꾼다 |
| 문장이 사라졌거나 DDL로 결과 형태가 바뀐 경우 | 자동 1회 재시도 | `FetchPreparedStatement`(26000)와 `RevalidateCachedQuery`이면 1회 재시도한다(`connection.js:25-28,540`) |
| Neon pooler(transaction mode) | 운영에서 오류 0건 (FACT) | §7. 다만 운영 `DATABASE_URL`이 pooled 주소인지는 문서(README·VERCEL_DEPLOY)에 근거한 것이다. 값은 열람하지 않았다 |
| 일반 SQL과 검색 SQL의 plan | 검색만 민감했고, 이번에 수정함 | §14 |

**Sync에도 적용된다(INFERENCE).**
- `bun run sync`도 같은 `db`를 쓴다. 그래서 다음 예약 Sync가 prepare 경로를 처음 쓰는 Sync가 된다.
- `sync.yml`은 direct endpoint를 쓴다고 문서화돼 있다. pooler 호환성 문제는 해당하지 않는다.
- 행 수가 다른 다중 행 INSERT는 문장 문자열이 서로 다르다. 그래서 연결마다 prepared statement가 늘어난다.
  - 이 문장들은 transaction 안(`persistScan`)에서 실행되므로 prepare가 꺼져 있다.
  - 이 증가는 transaction 밖 문장에만 해당한다.

## 6. 운영 응답 성능 비교 (FACT, E-03)

측정 조건은 Phase 25와 같다.
- 스크립트: `prod-lat.py`
- 경로당 10회, 1초 간격, 순차 요청
- 위치: 같은 클라이언트 위치(icn1 edge)
- 시각: 07:40–07:42Z

| 경로 | Phase 25 TTFB p50 / p95 | 이번 p50 / p95 | 차이(p50) |
|---|---|---|---|
| 정적 404 `/zz-no-such-route` | 136 / 210 | 125 / 207 | −11 (DB 없음, 잡음 수준) |
| DB 404 `/r/nobody/nothing` | 778 / 1,018 | 556 / 674 | **−222** |
| `/artifacts` (shell, 스트리밍) | 348 / 373 | 340 / 362 | − (total 1,249 → 1,100) |
| 홈 `/` | 876 / 898 | 704 / 844 | **−172** |
| 저장소 `/r/anthropics/skills` | 2,756 / 2,842 | 1,207 / 1,217 | **−1,549** |
| 상세 `/r/anthropics/skills/skills/pdf` | 1,258 / 1,295 | 1,026 / 1,256 | **−232** |
| 검색 `?q=node.js` (total) | 1,656 / 1,712 | 1,221 / 1,428 | **−435** |

- **정상 응답률은 100%다.** 측정 70회와 smoke 30회 모두 기대한 상태 코드였고, 오류율은 0이다.
- **cold 요청을 따로 봤다.** 각 경로의 첫 요청이다.
  - 홈 2,589ms, 저장소 1,874ms, 상세 1,256ms였다.
  - 서버 측 검색 첫 요청은 4,407ms였다. 이전에는 4,560ms였다.
  - cold는 연결을 새로 여는 비용이 지배하므로 개선 대상이 아니다.

서버 측 검색 시간은 Vercel 로그의 `event:"search"`·`durationMs`에서 읽었다(FACT, E-04).

| 검색어 | 배포 전 (bb7c2ed, 07:01Z 1회) | 배포 후 (07:44Z 1회) |
|---|---|---|
| `node.js` warm 10회 p50 | 1,133 (06:57Z) | 686 (07:41–07:42Z) |
| `three js` | 1,399 | 914 |
| `next.js` | 1,192 | 673 |
| `review` | 683 | 474 |
| `pdf` | 703 | 454 |
| `playwright` | 673 | 457 |
| `p5.js` | 917 | 453 |

**결과 수는 모두 같다(FACT).**
- `node.js` 20, `three.js` 1, `three js` 81, `p5.js` 2, `next.js` 26, `review` 828, `pdf` 59, `playwright` 35
- 전체 목록 7,273, `type=hook` 109

**INFERENCE**
- 로컬(RTT 100ms 프록시)에서는 상세 페이지의 직렬 왕복이 4.3에서 2.1로 줄었다. 운영 상세의 개선(−232ms ≈ 1.1 RTT)은 그 예측(약 2.2 RTT)의 절반이다.
- 배포 직후 `node.js` 검색이 1,142 → 918 → 696ms로 단계적으로 내려갔다. 이 패턴은 prepared statement가 **연결별**로 처음 한 번은 Parse/Describe 왕복을 쓰는 것과 맞는다.
- 그래서 운영 차이는 다음 둘로 설명된다.
  - pool 10개 연결이 각각 처음 실행할 때 비용을 낸다.
  - `idle_timeout: 20`초 뒤 연결이 닫혀 prepared 캐시가 사라진다. Fluid 인스턴스가 여러 개일 가능성도 있다.
- 이 해석은 측정으로 분리하지 않았다.

## 7. 오류 로그 검증 (E-05)

| 조회 | 범위 | 결과 |
|---|---|---|
| `--level error` | 07:28Z 이후 production | 0행 |
| `--level warning` | 같음 | 0행 |
| `--status-code 5xx` | 같음 | 0행 |
| 전체 로그에서 `prepared`, `26000`, `42p05`, `cached plan`, `pgbouncer`, `econnreset`, `timeout`, `error` 검색 | 07:28–07:44Z (3구간), 06:34–07:28Z (이전 배포) | 0건 |

- 한계: CLI는 호출당 50행만 돌려준다. 그래서 전체 요청 로그는 표본이다. level·status 필터 조회는 필터를 건 뒤의 결과라 이 한계의 영향이 작다.
- Vercel Hobby 로그 보존 기간은 1시간이다(VERCEL_DEPLOY.md). 그보다 이전 구간은 볼 수 없다.

## 8. D-1 효과 — PENDING

- 배포 이후 예약 Sync가 0회다.
- 비교 기준선은 39853119505다. 상태 PARTIAL_CAP, 처리 200, 신규 ingest 66건, core 사용 421/5000, 1,406초였다. backlog jobId 67–100 구간에서 생산적인 슬롯은 1개, refresh not-reached는 43이었다.
- 다음 Sync에서 같은 지표를 다시 본다.

## 9. C-1 효과 — PENDING (예상된 미갱신)

- 운영 `/artifacts?type=hook` 1쪽 25건의 경로는 `hooks.json` 21건, `settings.json` 4건이다. Phase 25 저장본과 같다(FACT, E-06).
- source_path가 바뀌지 않았으므로 identity와 URL은 유지된다. 중복도 0건이다(같은 쪽 기준).
- 아직 재수집되지 않아 생기는 예상된 상태이고, backfill은 하지 않았다.

## 10. O-2 결과 — PENDING

- `sync.yml`의 "Sync health summary" step(`continue-on-error: true`, `ops:status --markdown`)은 guard가 들어간 뒤 운영에서 한 번도 실행되지 않았다.
- 다음 Sync에서 다음을 확인한다. workflow가 초록색인 것만으로 PASS로 보지 않는다.
  - step summary에 표가 있는지, 아니면 `Not available` 한 줄인지
  - `connected as agentdock_app`이 찍히는지
  - step 자체의 outcome

## 11. O-3 결과 — PENDING

- 06:00 회차의 registry 실패 3회는 이전 코드(retry·cursor 보존 이전)에서 난 것이다.
- retry가 실제로 동작한 운영 기록은 아직 없다.
- 실패할 때 cursor를 저장하는 동작은 `sync.test.ts`의 단언으로 확인했다(Phase 25, 로컬 PASS).

## 12. Sync 병목 분석

새 실행 데이터가 없어 Phase 24의 결론을 그대로 유지한다.

| 지표 | 39853119505 (기준선) | 이후 |
|---|---|---|
| Status | PARTIAL_CAP | PENDING |
| 신규 ingest | 66 | PENDING |
| backlog 생산 슬롯 | 1/33 | PENDING |
| refresh not-reached | 43 (cap 100) | PENDING |
| 실행 시간 | 1,406초 | PENDING |
| GitHub core 사용 | 421/5000 | PENDING |
| registry 실패율(최근 06:00 회차 3회) | 3/3 | PENDING |

- 처리 상한은 **NO CHANGE**다. 증가를 뒷받침할 실측이 없다.

## 13. Neon/Vercel 리전

| 항목 | 상태 |
|---|---|
| Vercel Function Region | iad1 (FACT, 응답 헤더) |
| Neon Region | **PENDING.** Neon CLI 인증이 없고, Actions 로그에 리전 문자열이 없다. 연결 문자열은 열람 금지다. 추정하지 않음 |
| 함수–DB RTT | 약 0.215초 (Phase 25 운영 측정에서 맞춘 값, INFERENCE). 이번 DB 404 TTFB 556ms도 같은 모형과 맞는다 |

**리전이 다를 경우의 계획(승인 필요, 실행하지 않음)**

- **영향 받는 함수:** DB를 쓰는 모든 Vercel 함수다. 홈, `/artifacts`(스트리밍 부분), 상세, 저장소, DB 404가 해당한다. Sync는 Actions runner(GitHub 호스팅 리전)에서 돌므로 영향이 없다.
- **방법:** Vercel Project Settings → Functions → Region을 Neon과 같은(또는 가장 가까운) 리전으로 바꾼다.
  - 데이터 이동은 필요 없다.
  - Neon 프로젝트 리전은 생성 후 바꿀 수 없다. Neon 쪽을 옮기려면 새 프로젝트로 이전해야 하므로 권하지 않는다.
- **예상 효과(INFERENCE):** RTT가 수 ms로 줄면 DB 페이지 TTFB가 정적 404 수준에 가까워진다. 약 0.15–0.35초로 예상한다.
- **rollback:** Region을 iad1로 되돌리고 재배포한다.
- **운영 검증:**
  - `x-vercel-id`의 두 번째 값이 새 리전인지 확인한다.
  - §6 표를 같은 스크립트로 다시 잰다.
  - §4 smoke를 반복한다.
  - Vercel 로그 error·5xx가 0건인지 확인한다.

## 14. Generic/Custom Plan 비교

### 14.1 측정 방법

- **환경:** 로컬 Docker `agentdock-testdb`(PostgreSQL 17.11). 합성 corpus는 7.3k / 20k / 50k이고, `perf/gen.sql`로 만든 뒤 `VACUUM ANALYZE`를 돌렸다.
- **도구:** `p26/bench.mjs`. 페이지 단위 쿼리 묶음을 앱 코드 그대로 호출한다.
  - 각 묶음은 warm-up 2회 뒤 30회 실행하고, p50/p95를 냈다.
  - 모드마다 2회 반복해 작은 값을 택했다.
- **3가지 모드**
  1. `prepare:false`: 같은 프로세스에서 `sql.unsafe`를 감싸 강제했다. `src/`는 바꾸지 않았다.
  2. `prepare:true` + 기본 `plan_cache_mode = auto`
  3. `prepare:true` + role 기본값 `force_custom_plan`: 로컬 DB에만 설정했고 측정 뒤 원래대로 돌렸다.
- **RTT:** 0에 가깝다. 이 표는 plan 비용만 보여준다. 왕복 비용은 Phase 25의 100ms 프록시 측정(상세 443 → 236ms 등)과 §6 운영 측정에 있다.
- **잡음:** 측정하는 동안 호스트 load average가 7–10이었다. 특히 20k·50k의 "수정 후" 표에서 홈과 Browse는 같은 코드인데도 모드 사이 차이가 크다. 이 값은 잡음으로 보고, 비교는 수정의 영향을 받는 검색 행에만 한다.

### 14.2 수정 전 (`24097f4`, ms p50, E-07)

| 규모 | 검색 | prepare:false | prepare:true (auto) | prepare:true + custom |
|---|---|---|---|---|
| 7.3k | node.js | 12.9 | **27.5** | 11.7 |
| 7.3k | code review | 8.0 | **13.1** | 7.0 |
| 20k | node.js | 29.0 | **71.8** | 24.2 |
| 20k | code review | 14.2 | **33.8** | 13.7 |
| 50k | node.js | 55.0 | **175.6** | 54.2 |
| 50k | review | 46.5 | **74.1** | 46.2 |
| 50k | code review | 31.7 | **79.0** | 31.4 |
| 50k | playwrit (fuzzy) | 159.6 | **191.6** | 161.2 |

- 홈, Browse, 상세, 저장소는 세 모드 사이에 차이가 없었다.
  - 50k 기준 홈 268 / 267 / 265, Browse 267 / 260 / 274
  - 상세와 저장소는 1–2ms이고 prepared가 약간 빠르다.

### 14.3 원인 (EXPLAIN, 50k, `node.js` count, E-08)

- custom plan과 generic plan의 **계획 모양은 같다.** 둘 다 `Hash Join` + `Seq Scan package`다.
- 차이는 Join Filter 하나다.
  - custom plan: `search_vector @@ '''node.js'':* | …'::tsquery`. 계획을 세울 때 상수로 접힌다.
  - generic plan: `search_vector @@ to_tsquery('english'::regconfig, $1)`. 5만 행마다 다시 계산된다.
- 실행 시간: custom 29.1ms, generic 101.6ms. 행 조회 문장은 33.4ms 대 115.1ms다.
- fuzzy 경로의 `numnode(to_tsquery(...)) > 0`도 같은 이유로 행마다 계산된다. 코드 주석은 "A constant, evaluated once per statement"라고 하지만, 이 주석은 generic plan에서는 거짓이었다.

### 14.4 수정과 결과

- **수정:** `tsQuery()`가 `(SELECT to_tsquery(...))`와 `(SELECT websearch_to_tsquery(...))`를 반환하게 했다. 스칼라 서브쿼리는 InitPlan으로 문장당 1회 실행된다.
- **EXPLAIN, 50k, 3회:** generic 26–41ms, custom 26–44ms다. 수정 전 generic은 102ms였다.
- **페이지 묶음, 수정 후, ms p50, E-09·E-10**

| 규모 | 검색 | prepare:false | auto | custom |
|---|---|---|---|---|
| 7.3k | node.js | 11.7 | 10.2 | 10.3 |
| 7.3k | code review | 7.2 | 5.4 | 6.5 |
| 20k (재측정) | node.js | 39.8 | 34.7 | 37.9 |
| 20k (재측정) | code review | 22.5 | 20.1 | 22.6 |
| 50k (1차) | node.js | 76.2 | 53.1 | 74.4 |
| 50k (재측정) | node.js | 65.4 | 74.0 | 76.0 |
| 50k (재측정) | code review | 40.1 | 45.8 | 50.7 |

- 수정 전에는 auto가 2.4–3.2배 느렸다. 수정 후에는 세 모드가 같은 범위 안에서 잡음으로 섞인다.
- 50k `pdf type+cap` 재측정의 auto 84ms는 custom(83.9ms)과 같다. 이 값은 plan 차이가 아니라 잡음이다.

### 14.5 plan_cache_mode 판단

- **이점:** 수정 전에는 검색 penalty를 없앴다. 수정 후에는 측정상 이점이 없다.
- **비용**
  - 모든 실행마다 계획을 다시 세운다(planning 0.7 → 1.9ms 수준).
  - 운영 role을 바꿔야 한다.
- **권한:** `agentdock_app` 스스로 `ALTER ROLE agentdock_app [IN DATABASE …] SET plan_cache_mode`를 실행할 수 있다. superuser가 필요 없다(로컬 FACT, E-11).
- **반영 시점:** role 기본값은 **새 세션에만** 적용된다. 이미 열린 세션은 `auto`를 유지했다(로컬 FACT, E-11).
  - pooler 뒤에서는 PgBouncer가 들고 있는 서버 연결이 다시 열릴 때까지 옛 값과 새 값이 섞인다. 반영 시점은 Neon compute가 suspend·restart되거나 서버 연결이 교체될 때다(INFERENCE, PgBouncer 동작).
- **결정:** 운영 `ALTER ROLE`은 **하지 않는다.** `bootstrap-agentdock.sql`의 해당 줄도 지웠다. 운영에 적용된 적이 없으므로 되돌릴 대상도 없다.
  - 운영에서 이미 적용했다면 남겨 둬도 무해하다. 되돌릴 때는 `ALTER ROLE agentdock_app RESET plan_cache_mode`를 쓴다.

**운영 영향(INFERENCE).** 운영 7.3k 규모에서 수정 전 generic penalty는 검색 문장 하나에 5–15ms였다. RTT 215ms에 비하면 작다. 실제로 운영 `node.js` 10회 연속 실행(§6)에서도 5회째 이후 증가가 보이지 않았다. 이번 수정은 corpus가 커질 때를 대비한 것이고, 당장의 TTFB 개선을 약속하지 않는다.

## 15. 변경 코드 (미커밋)

| 파일 | 변경 |
|---|---|
| `src/db/queries/search.ts` | `tsQuery()`의 두 반환값을 스칼라 서브쿼리로 감쌌다(2줄). 측정을 담은 주석을 추가했다 |
| `src/db/queries/search.test.ts` | `describe('the tsquery in a generic plan')`를 추가했다. 4개 입력(점 있는 단어, 두 단어, websearch 문법, 0건이라 fuzzy로 가는 경우)에 대해, 앱이 보낸 모든 문장을 `EXPLAIN (GENERIC_PLAN, VERBOSE, FORMAT JSON)`으로 확인한다. InitPlan 밖의 노드에 `to_tsquery(`가 없어야 통과한다. **수정 전 코드에서 4/4 실패를 확인했다**(`Hash Join`에서 검출) |
| `src/db/client.ts` | `ponytail:` 주석을 갱신했다. plan_cache_mode 의존을 지우고, 재검토 조건을 "새 문장이 파라미터 함수를 행 단위 위치에 두는 경우"로 바꿨다 |
| `scripts/sql/bootstrap-agentdock.sql` | `ALTER ROLE agentdock_app SET plan_cache_mode = force_custom_plan;`과 그 주석을 지웠다 |

검색의 의미(predicate, weight, 결과)는 바뀌지 않았다. search:eval 54/54의 케이스별 결과가 Phase 23과 동일하고, 운영과 같은 검색어 결과 수도 같다.

## 16. 테스트 결과 (이번 실행, E-12–E-15)

| 단계 | 결과 |
|---|---|
| `bun run check:boundaries` | OK |
| lint (추적 파일 229개, `biome check $(git ls-files)`) | OK |
| `bun run lint` (전체) | exit 1. 원인은 git-ignored `test-results/.last-run.json`의 끝 줄바꿈 1건이고 제품 코드와 무관하다. 이번 신규 테스트의 포맷 오류는 `biome format --write`로 고쳤다 |
| `bun run typecheck` | OK |
| `CI=1 bun run test` | 79 files passed + 1 skipped. **1,489 passed / 3 skipped** (이전 1,485 + 신규 4) |
| `bun run build` | OK |
| `bun run test:e2e` (E2E 재시드 후) | **27/27** |
| `bun run search:eval` | **54/54.** SEARCH_EVAL_CASE 52줄이 Phase 23과 동일하다. ndcg10 0.907, mrr 0.927 |
| 신규 회귀 테스트, 수정 전 코드 | 4/4 FAIL (기대대로) |

- 3 skipped는 기존과 같다.

## 17. 운영 변경 승인 필요 항목

| 항목 | 필요성 | 상태 |
|---|---|---|
| Neon 리전 확인 (콘솔 열람) | 리전 정렬 판단의 전제 | 운영자 확인 필요 |
| Vercel Function Region 변경 | 남은 지연의 최대 요인(INFERENCE) | 리전 확인 후 승인 필요 |
| `ALTER ROLE … plan_cache_mode` | **불필요.** §14.5 | 요청 철회 |
| 이번 변경 배포 | 코드 변경 | 사용자 commit/push 후 자동 배포 |

## 18. Rollback 계획

- **이번 코드:** commit을 revert한다. migration이 없으므로 DB에 남는 것이 없다. 되돌리면 검색은 `24097f4`와 같아진다. 결과는 같고, generic penalty만 다시 생긴다.
- **배포 후 확인**
  - §4 smoke
  - `?q=node.js`, `?q=three js`, `?q=xqzz`(0건이라 fuzzy 경로를 탐) 각 3회 200
  - Vercel 로그 error·5xx 0건
  - 로그 `durationMs`가 §6과 같은 범위(`node.js` warm 약 690ms 이하)인지

## 19. PENDING / NOT RUN

| 항목 | 상태 | 이유 |
|---|---|---|
| D-1, C-1, O-2, O-3 운영 효과 | PENDING | 배포 이후 예약 Sync 0회. 06:00 회차가 작업 종료 시점까지 시작하지 않음 |
| Sync 병목 재평가와 상한 | PENDING / NO CHANGE | 같은 이유 |
| Neon 리전 | PENDING | 확인 수단 없음 |
| 운영 `DATABASE_URL`이 pooled인지 | PENDING | 값 열람 금지. 문서상 pooled |
| Vercel 전체 요청 로그 | 부분 | CLI 50행 제한, 보존 1시간 |
| 운영 RTT 개선이 로컬 예측의 절반인 이유 | 미분리 | §6 INFERENCE |
| 이번 수정의 운영 효과 | PENDING | 배포 전 |
| 운영 EXPLAIN | NOT RUN | 금지 |
| 100ms 프록시 HTTP 측정(이번 수정) | NOT RUN | 수정 범위가 RTT와 무관하다(plan 비용만 바뀜) |
| 비CI 모드 테스트 | NOT RUN | CI 모드로 대체 |

## 20. Evidence

scratchpad: `/tmp/claude-1000/-home-ChoiGwanghun-workspace-auto-agentdock/5f3bf29d-8c4e-417d-a177-083dcd61f8ca/scratchpad/p26/`

| ID | 내용 | 위치 |
|---|---|---|
| E-01 | SHA·Actions 목록, 운영 헤더 | 세션 출력 (`gh run list`, `curl -D -`) |
| E-02 | 운영 smoke 30회 | `p26/smoke.py`, `p26/smoke.txt` |
| E-03 | 운영 TTFB 10회×7경로 | `p26/prod-lat.py`, `p26/prod-lat.txt` · 비교 `p23/prod-lat.txt` |
| E-04 | 서버 측 검색 시간과 결과 수 | `p26/logs-before.jsonl`, `logs-gap.jsonl`, `logs-all.jsonl`, `logs-s1.jsonl` |
| E-05 | 오류·경고·5xx 로그 조회 | `p26/logs-err.jsonl`, `logs-warn.jsonl`, `logs-5xx.jsonl` (0행) |
| E-06 | hook 경로 분포 | `p26/hooks.html` · 비교 `p23/hooks.html` |
| E-07 | 3모드 벤치, 수정 전 | `p26/before/b{7300,20000,50000}-{off,on,custom}-{1,2}.json`, `p26/bench-summary.md` |
| E-08 | EXPLAIN custom vs generic, 수정 전·후 | `p26/explain.sql`, `explain-50k.txt`, `explain2.sql`, `capture.mjs`, `capture-node.json` |
| E-09 | 3모드 벤치, 수정 후 | `p26/after/…`, `p26/bench-summary-after.md` |
| E-10 | 3모드 벤치, 수정 후 재측정 (20k·50k) | `p26/after2/…`, `p26/bench-summary-after2.md` |
| E-11 | role 기본값 반영 시점과 self-ALTER 권한 | `p26/roletiming.mjs`, `roletiming.txt` |
| E-12 | CI 모드 테스트 | `p26/test.log` |
| E-13 | build·E2E | `p26/build.log`, `e2e.log`, `e2e-seed.log` |
| E-14 | search:eval | `p26/eval.txt` vs `p23/eval.txt` |
| E-15 | lint | `p26/ci.log`(전체, `.last-run.json` 포함), `p26/lint-tracked.log` |
| E-16 | postgres.js·Drizzle 동작 | `node_modules/postgres/src/connection.js:25-28,87-88,200-245,366-370,540` · `node_modules/drizzle-orm/postgres-js/session.js:33-131` |

로컬 정리 상태:
- `agentdock` schema는 E2E 데이터로 다시 시드했다(package 177).
- role 설정은 `{search_path=agentdock}`로 원복했다.

## 21. 최종 Git Status

```
 M scripts/sql/bootstrap-agentdock.sql
 M src/db/client.ts
 M src/db/queries/search.test.ts
 M src/db/queries/search.ts
?? docs/analysis/agentdock-phase26-28-production-stabilization.md
```

## 22. 권장 Commit 메시지

```
git add scripts/sql/bootstrap-agentdock.sql src/db/client.ts src/db/queries/search.ts src/db/queries/search.test.ts docs/analysis/agentdock-phase26-28-production-stabilization.md
git commit -m "perf(search): compute the tsquery once per statement in a generic plan" -m "Drizzle statements are prepared since 24097f4, and PostgreSQL moves a prepared statement to a generic plan after five runs. There to_tsquery('english', \$1) is no longer folded at plan time and re-ran on every row: measured at 50k rows, the node.js count went from 29 ms to 102 ms, and the search page sets ran 2.4-3.2x slower than unprepared. Each tsquery form is now a scalar subquery, evaluated once as an InitPlan (26 ms), and the page sets measure within noise of prepare:false at 7.3k-50k. That makes the plan_cache_mode role default unnecessary, so the bootstrap no longer sets it. A test asserts on EXPLAIN (GENERIC_PLAN) that no tsquery call sits outside an InitPlan; it fails against the previous code. Search results are unchanged (search:eval 54/54, case-identical)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## 23. 다음 작업 우선순위

1. 이번 변경을 commit하고 배포한다. 배포 후 §18의 확인을 한다.
2. **06:00 회차 Sync(예상 시작 10:30–10:47Z) 후 확인할 항목**
   - D-1: jobId 67–100 구간 outcome, 신규 ingest, 생산 슬롯 수
   - registry `retried=` 값과 cursor
   - "Sync health summary" step의 표·role·outcome
   - C-1 hook 이름 분포
   - refresh not-reached 추이
   - 이 Sync가 prepare 경로를 쓰는 첫 Sync이므로, 오류 유무와 실행 시간 변화
3. 운영자가 Neon 리전을 확인한다. iad1과 다르면 §13 계획으로 Vercel Function Region 변경을 승인받는다.
4. (선택, 측정 후) `idle_timeout: 20`초와 prepared 캐시 손실의 관계를 본다. 트래픽이 드문 사이트에서는 요청 대부분이 새 연결에 도달할 수 있다(§6 INFERENCE). Neon CU-hour 비용과 함께 측정한 뒤에만 다룬다.
